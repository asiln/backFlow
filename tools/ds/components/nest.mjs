// The nesting fixpoint (spec 1.7): passes of {digest, candidates, cluster, merge optional parts, thresholds, accept innermost}.
// Accepted members are collapsed to leaf instances in place so that ancestors re-hash with `C:<id>` leaves in the next pass.
import { componentId, hashStr } from '../common/hash.mjs';
import { digestTree } from './digest.mjs';
import { preorder, collapseView } from './view.mjs';
import { candidateReject, clusterCandidates, mergeOptional, thresholdReason, locatorOf } from './cluster.mjs';
import { analyseCore } from './library.mjs';
import { confidence, bandOf } from './confidence.mjs';
import { nameCore } from './name.mjs';

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'component';

export function runPasses(screens, P, cfg, log = () => {}) {
  const absorbed = new Set();
  const taken = new Set();
  const ids = new Set();
  const assigns = new Map();          // raw member node -> { id, values, ov, dev, conf, comp }
  const comps = [];                   // accepted components in acceptance order
  const nameOf = new Map();           // id -> name
  const passes = [];
  let candReject = {};
  let finalEvals = [];

  for (let pass = 1; pass <= P.maxPasses; pass++) {
    const t0 = Date.now();
    for (const s of screens) digestTree(s.root);
    const cands = [];
    const rej = {};
    for (const s of screens) for (const v of preorder(s.root)) {
      const r = candidateReject(v, P, absorbed);
      if (r) { if (v.t === 'frame' && !v.inst) rej[r] = (rej[r] || 0) + 1; } else cands.push(v);
    }
    if (pass === 1) candReject = rej;
    let cores = clusterCandidates(cands, P);
    const nCores0 = cores.length;
    cores = mergeOptional(cores, P);

    // ---- evaluate
    const evals = [];
    for (const core of cores) {
      const ev = { core, status: 'rejected', reason: null };
      evals.push(ev);
      let r = thresholdReason(core, P);
      if (r) { ev.reason = r; continue; }
      const an = analyseCore(core, P, assigns);
      ev.an = an;
      if (!an.ok) { ev.reason = 'align'; continue; }
      core.occ = an.occ; core.screens = an.screens; core.files = an.files;
      r = thresholdReason(core, P);
      if (r) { ev.reason = r + '-after-tolerance'; continue; }
      if (an.dataShaped) { ev.reason = 'data-shaped'; continue; }
      const nm = nameCore(core, cfg, new Set(taken));
      const conf = confidence({ occ: an.occ, screens: an.screens, files: an.files, nodes: an.nodes, meanDev: an.devMean, nameSource: nm.nameSource, styled: an.styled, hasAbsKids: an.hasAbsKids, dataShaped: an.dataShaped, textOverflowRisk: an.textOverflowRisk });
      ev.conf = conf;
      if (bandOf(conf, P.minConf) == null) { ev.reason = 'low-confidence'; continue; }
      ev.status = 'passing';
    }
    let passing = evals.filter((e) => e.status === 'passing');

    // ---- absorption of single-use nested clusters (1.7)
    const owner = new Map();
    passing.forEach((e, i) => { for (const m of e.an.members) owner.set(m.v, i); });
    const nearest = (v) => { for (let x = v.parent; x; x = x.parent) if (owner.has(x)) return owner.get(x); return -1; };
    for (const [i, e] of passing.entries()) {
      const hosts = new Set(e.an.members.map((m) => nearest(m.v)));
      if (hosts.size === 1 && !hosts.has(-1)) {
        const y = passing[[...hosts][0]];
        if (y !== e && y.an.occ === e.an.occ && e.an.screens < 2 && e.an.nodes < P.tinyNodes) {
          e.status = 'absorbed'; e.reason = 'absorbed';
          for (const m of e.an.members) absorbed.add(m.v.n);
        }
      }
      void i;
    }
    passing = passing.filter((e) => e.status === 'passing');
    owner.clear();
    passing.forEach((e, i) => { for (const m of e.an.members) owner.set(m.v, i); });

    // ---- innermost only
    const accepted = [];
    passing.forEach((e, i) => {
      let contains = false;
      for (const m of e.an.members) {
        for (const d of preorder(m.v)) if (d !== m.v && owner.has(d) && owner.get(d) !== i) { contains = true; break; }
        if (contains) break;
      }
      if (contains) { e.status = 'deferred'; e.reason = 'contains-component'; } else accepted.push(e);
    });
    log(`pass ${pass}: candidates ${cands.length}, cores ${nCores0} (${cores.length} after optional merge), passing ${passing.length}, accepted ${accepted.length}, ${Date.now() - t0} ms`);
    passes.push({ pass, candidates: cands.length, cores: nCores0, coresMerged: cores.length, passing: passing.length, accepted: accepted.length });
    finalEvals = evals;
    if (!accepted.length) break;

    // ---- accept
    for (const e of accepted) {
      const { core, an } = e;
      const nm = nameCore(core, cfg, taken);
      let id = componentId(slug(nm.name), core.leader.dg.S);
      if (ids.has(id)) id = componentId(slug(nm.name), core.leader.dg.S + '|' + core.leader.dg.P);
      for (let k = 2; ids.has(id); k++) id = componentId(slug(nm.name), core.leader.dg.S + '|' + k);
      ids.add(id);
      nameOf.set(id, nm.name);
      const conf = e.conf;
      const comp = {
        id, name: nm.name, group: nm.group, nameSource: nm.nameSource, conf, band: bandOf(conf, P.minConf), core, an,
        sig: hashStr(core.leader.dg.S + core.leader.dg.M), notes: [...nm.notes], pass,
        rejectedMembers: an.rejected.reduce((a, r) => { a[r.reason] = (a[r.reason] || 0) + 1; return a; }, {}),
        paletteGroups: core.paletteGroups, merged: core.mergedFrom || 0,
      };
      if (core.optional) comp.notes.push(`merged ${core.mergedFrom} shape clusters as optional parts`);
      if (an.slots.some((s) => s.kind === 'bool')) comp.notes.push('optional parts: master is the superset exemplar');
      if (core.paletteGroups > 1) comp.notes.push(`${core.paletteGroups} palette groups (variants are not inferred yet)`);
      comps.push(comp);
      for (const m of an.members) assigns.set(m.v.n, { id, values: m.values, ov: m.ov, dev: m.dev, conf, comp, view: m.v });
      for (const m of an.members) collapseView(m.v, id);
    }
  }
  return { comps, assigns, passes, candReject, finalEvals, absorbed: absorbed.size, nameOf };
}
