#!/usr/bin/env node
// componentize.mjs: detect repeated structures across ALL screens of ALL export files and write
//   <out>/<file>.figma.json  enriched copies (originals are never touched) with `cmp` on member nodes
//   <out>/_library.json      components + icons (docs/ds-schema/library.schema.json)
//   <out>/components-report.{md,json}   with --report
// Usage: node componentize.mjs --in "out/final/**/*.figma.json" [--config ds.config.json] [--out out/enriched] [--report]
//        [--exclude <glob> ...] [--no-hooks] [--pretty] [--dry]
// Spec: docs/COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md section 1 / 7; decisions in docs/ds-schema/CONTRACT-NOTES.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validate, formatErrors } from './tools/ds/common/validate.mjs';
import { buildScreens, fileLabel } from './tools/ds/components/view.mjs';
import { resolveParams, locatorOf } from './tools/ds/components/cluster.mjs';
import { runPasses } from './tools/ds/components/nest.mjs';
import { libComponent, inferVariants as noVariants } from './tools/ds/components/library.mjs';

import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ args / glob
function parseArgs(argv) {
  const a = { in: [], exclude: [], out: 'out/enriched', report: false, hooks: true, pretty: false, dry: false, config: null, skip: '(^|/)(_|probe|test|shot-test|overlay-check)[^/]*$' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--in') a.in.push(argv[++i]);
    else if (k === '--config') a.config = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--exclude') a.exclude.push(argv[++i]);
    else if (k === '--skip') a.skip = argv[++i];
    else if (k === '--report') a.report = true;
    else if (k === '--no-hooks') a.hooks = false;
    else if (k === '--pretty') a.pretty = true;
    else if (k === '--dry') a.dry = true;
    else { console.error('unknown argument ' + k); process.exit(2); }
  }
  return a;
}

function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
export function expand(pattern, cwd = process.cwd()) {
  const p = pattern.replace(/\\/g, '/');
  if (!/[*?]/.test(p)) {
    const abs = path.resolve(cwd, p);
    if (!fs.existsSync(abs)) return [];
    return fs.statSync(abs).isDirectory() ? walk(abs).filter((f) => /\.figma\.json$/.test(f)).sort() : [abs];
  }
  const parts = p.split('/');
  const k = parts.findIndex((s) => /[*?]/.test(s));
  const baseAbs = path.resolve(cwd, parts.slice(0, k).join('/') || '.');
  if (!fs.existsSync(baseAbs)) return [];
  const re = globRe(parts.slice(k).join('/'));
  return walk(baseAbs).filter((f) => re.test(path.relative(baseAbs, f).replace(/\\/g, '/'))).sort();
}

async function tryImport(rel) {
  try {
    const f = path.join(HERE, rel);
    if (!fs.existsSync(f)) return null;
    return await import(pathToFileURL(f).href);
  } catch (e) {
    console.warn(`notice: ${rel} failed to load (${e.message}); step skipped`);
    return null;
  }
}

const round2 = (x) => Math.round(x * 100) / 100;
const pct = (a, b) => (b ? round2((100 * a) / b) : 0);

// ------------------------------------------------------------------ main
export async function componentize(opts) {
  const t0 = performance.now();
  const log = opts.log || ((m) => console.log(m));
  const cfg = opts.config || {};
  const P = resolveParams(cfg);
  P.exclude.push(...(opts.exclude || []));
  P.excludeRes = P.exclude.map((g) => globRe(g));
  const notices = [];

  // ---- load
  const skipRe = opts.skip ? new RegExp(opts.skip) : null;
  let paths = [];
  for (const g of opts.in) paths.push(...expand(g));
  paths = [...new Set(paths)].filter((p) => !(skipRe && skipRe.test(p.replace(/\\/g, '/'))));
  const files = [];
  for (const p of paths) {
    let data;
    try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { notices.push(`skip ${p}: ${e.message}`); continue; }
    if (!data || !Array.isArray(data.frames)) { notices.push(`skip ${path.basename(p)}: no frames[]`); continue; }
    files.push({ path: p, data });
  }
  if (!files.length) throw new Error('no export files found for --in ' + opts.in.join(' '));
  const datas = files.map((f) => f.data);
  log(`loaded ${files.length} files, ${datas.reduce((a, d) => a + d.frames.length, 0)} screens`);

  // ---- hooks (T2 tokens, T5 icons)
  const hooks = { tokens: false, icons: false };
  let tokens = null, iconLib = [];
  if (opts.hooks) {
    const tk = await tryImport('tools/ds/tokens/index.mjs');
    if (tk && tk.harvest && tk.annotate) {
      try {
        tokens = tk.harvest(datas, { ...cfg, basedir: opts.configDir || process.cwd() });
        tk.annotate(datas, tokens);
        hooks.tokens = true;
      } catch (e) { notices.push('tokens hook failed: ' + e.message); }
    } else notices.push('tokens hook (tools/ds/tokens/index.mjs harvest+annotate) not available: paints compared by quantised RGBA');
    const ic = await tryImport('tools/ds/icons/index.mjs');
    if (ic && ic.collectIcons) {
      try { const r = ic.collectIcons(datas, { tokens: tokens || undefined }); iconLib = r.icons || []; hooks.icons = true; } catch (e) { notices.push('icons hook failed: ' + e.message); }
    } else notices.push('icons hook (tools/ds/icons/index.mjs collectIcons) not available: svg differences are not expressed as swaps');
  }
  const variantsMod = await tryImport('tools/ds/components/variants.mjs');
  const inferVariants = (variantsMod && variantsMod.inferVariants) || noVariants;
  for (const n of notices) log('notice: ' + n);

  // ---- passes
  const screens = buildScreens(files);
  const totalNodes = screens.reduce((a, s) => a + s.nodes, 0);
  const res = runPasses(screens, P, cfg, log);
  const { comps, assigns } = res;

  // ---- cmp objects on raw nodes
  const compById = new Map(comps.map((c) => [c.id, c]));
  for (const [raw, rec] of assigns) {
    const comp = rec.comp;
    const cmp = { id: rec.id };
    if (rec.ov && rec.ov.length) cmp.ov = rec.ov;
    const lead = comp.core.leader;
    const sz = [null, null];
    if (rec.view.s[0] === 'F' && Math.abs((rec.view.w || 0) - (lead.w || 0)) > 0.5) sz[0] = rec.view.w;
    if (rec.view.s[1] === 'F' && Math.abs((rec.view.h || 0) - (lead.h || 0)) > 0.5) sz[1] = rec.view.h;
    if (sz[0] != null || sz[1] != null) cmp.sz = sz;
    cmp.dev = rec.dev;
    cmp.conf = rec.conf;
    rec.cmp = cmp;
  }
  // variants hook (no-op until T9)
  for (const comp of comps) {
    const vi = inferVariants({ id: comp.id, name: comp.name, leader: comp.core.leader, members: comp.an.members, slots: comp.an.slots, pm: comp.an.pm, paletteGroups: comp.paletteGroups });
    comp.variants = vi && vi.props ? { props: vi.props, members: vi.members } : null;
    comp.dropSlots = vi && vi.dropSlots ? vi.dropSlots : null;
    if (vi && vi.memberV) for (const [raw, v] of vi.memberV) { const r = assigns.get(raw); if (r) { const c = { id: r.cmp.id, v, ...r.cmp }; r.cmp = c; } }
    if (vi && vi.prune) for (const raw of vi.prune) { // the variant carries these paints: drop the now redundant overrides
      const r = assigns.get(raw); if (!r || !r.cmp.ov) continue;
      const ov = r.cmp.ov.filter((o) => !vi.dropSlots.has(String(o.s)));
      if (ov.length) r.cmp.ov = ov; else delete r.cmp.ov;
    }
  }
  for (const [raw, rec] of assigns) raw.cmp = rec.cmp;

  // ---- library
  const compNameOf = (id) => res.nameOf.get(id);
  const library = {
    version: 1, generated: new Date().toISOString(),
    params: { thresholds: { occ: P.occ, occTiny: P.occTiny, tinyNodes: P.tinyNodes, screens: P.screens, minConf: P.minConf }, tolerance: { gap: 1, size: 'max(2px,2%)', font: 0, lh: 1, ls: 0.02, colorDeltaE: P.colorDeltaE, alphaTol: P.alphaTol }, files: files.length, screens: screens.length, hooks },
    components: comps.map((c) => libComponent(c.core, c.an, { id: c.id, name: c.name, group: c.group, conf: c.conf, band: c.band, nameSource: c.nameSource, sig: c.sig, notes: c.notes, compNameOf })),
    icons: iconLib,
  };
  comps.forEach((c, i) => {
    if (!c.variants) return;
    library.components[i].variants = c.variants;
  });
  const lv = validate('library', library);
  if (!lv.ok) { log('WARNING: _library.json does not validate:\n' + formatErrors(lv)); notices.push('library schema validation failed'); }

  // ---- stats
  let instNodes = 0, coveredNodes = 0;
  for (const [raw, rec] of assigns) { instNodes++; coveredNodes += rec.view.dg ? 0 : 0; void raw; }
  const memberRoots = new Set([...assigns.keys()]);
  // nodes inside outermost instances (original tree sizes)
  const countRaw = (n) => 1 + (n.children ? n.children.reduce((a, c) => a + countRaw(c), 0) : 0);
  const outer = new Set();
  const markOuter = (n, inside) => {
    if (inside) return;
    if (memberRoots.has(n)) { outer.add(n); return; }
    (n.children || []).forEach((c) => markOuter(c, false));
  };
  for (const d of datas) d.frames.forEach((f) => markOuter(f, false));
  let outerNodes = 0;
  for (const n of outer) outerNodes += countRaw(n);
  void coveredNodes;

  const stats = {
    files: files.length, screens: screens.length, nodes: totalNodes,
    passes: res.passes, candidatesPass1: res.passes[0] ? res.passes[0].candidates : 0,
    components: comps.length, auto: comps.filter((c) => c.band === 'auto').length, review: comps.filter((c) => c.band === 'review').length,
    instances: instNodes, outerInstances: outer.size, nodesInInstances: outerNodes, coveragePct: pct(outerNodes, totalNodes),
    icons: iconLib.length, absorbed: res.absorbed,
  };

  // ---- write
  if (!opts.dry) {
    const outDir = path.resolve(opts.out);
    fs.mkdirSync(outDir, { recursive: true });
    const used = new Set();
    for (const f of files) {
      let name = path.basename(f.path);
      if (used.has(name)) name = fileLabel(path.basename(path.dirname(f.path))) + '__' + name;
      used.add(name);
      const d = f.data;
      const out = { ...d, ds: { library: '_library.json', ...(tokens ? { tokens: 'tokens.json' } : {}), ver: 1 } };
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(out, null, opts.pretty ? 1 : 0));
    }
    fs.writeFileSync(path.join(outDir, '_library.json'), JSON.stringify(library, null, opts.pretty ? 1 : 0));
    if (tokens) fs.writeFileSync(path.join(outDir, 'tokens.json'), JSON.stringify(tokens, null, opts.pretty ? 1 : 0));
    if (opts.report) writeReport(outDir, comps, res, stats, P, notices, screens);
  }
  stats.seconds = round2((performance.now() - t0) / 1000);
  stats.peakRssMB = Math.round((process.resourceUsage().maxRSS || 0) / 1024);
  return { library, stats, res, comps, notices, tokens };
}

// ------------------------------------------------------------------ report
function writeReport(outDir, comps, res, stats, P, notices) {
  const examples = (c) => c.an.members.slice(0, 3).map((m) => locatorOf(m.v));
  const rejected = {};
  for (const e of res.finalEvals) {
    if (e.status === 'accepted') continue;
    const r = e.reason || e.status;
    const o = (rejected[r] = rejected[r] || { clusters: 0, occurrences: 0 });
    o.clusters++; o.occurrences += e.core.members.length;
  }
  const topRejected = res.finalEvals
    .filter((e) => e.status !== 'passing' && e.core.members.length >= 2)
    .sort((a, b) => b.core.members.length - a.core.members.length)
    .slice(0, 40)
    .map((e) => ({ reason: e.reason || e.status, occ: e.core.members.length, screens: e.core.screens, nodes: e.core.nodes, role: e.core.leader.role, conf: e.conf ?? null }));
  const json = {
    generated: new Date().toISOString(), params: { thresholds: { occ: P.occ, occTiny: P.occTiny, tinyNodes: P.tinyNodes, screens: P.screens, minConf: P.minConf } }, stats, notices,
    candidateRejects: res.candReject,
    clusters: comps.map((c) => ({
      id: c.id, name: c.name, group: c.group, conf: c.conf, band: c.band, occ: c.an.occ, screens: c.an.screens, files: c.an.files, nodes: c.an.nodes,
      nameSource: c.nameSource, dev: { mean: c.an.devMean, max: c.an.devMax }, slots: c.an.slots.map((s) => s.kind), paletteGroups: c.paletteGroups, pass: c.pass,
      examples: examples(c), notes: c.notes, rejectedMembers: c.rejectedMembers,
    })),
    rejected, topRejected,
  };
  fs.writeFileSync(path.join(outDir, 'components-report.json'), JSON.stringify(json, null, 1));
  const L = [];
  L.push('# Components report', '', `Files ${stats.files}, screens ${stats.screens}, nodes ${stats.nodes}. Components ${stats.components} (auto ${stats.auto}, review ${stats.review}); instances ${stats.instances}; nodes inside instances ${stats.coveragePct}%.`, '');
  L.push('| id | name | conf | band | occ | screens | files | nodes | slots | palettes |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const c of [...json.clusters].sort((a, b) => (a.band === b.band ? b.occ - a.occ : a.band === 'review' ? -1 : 1))) {
    L.push(`| ${c.id} | ${c.name} | ${c.conf} | ${c.band} | ${c.occ} | ${c.screens} | ${c.files} | ${c.nodes} | ${c.slots.length} | ${c.paletteGroups} |`);
  }
  L.push('', '## Rejected clusters by reason', '', '| reason | clusters | occurrences |', '|---|---|---|');
  for (const [r, o] of Object.entries(rejected)) L.push(`| ${r} | ${o.clusters} | ${o.occurrences} |`);
  L.push('', '## Candidate rejections (pass 1, frames)', '', Object.entries(res.candReject).map(([k, v]) => `${k}: ${v}`).join(', '));
  fs.writeFileSync(path.join(outDir, 'components-report.md'), L.join('\n') + '\n');
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.in.length) { console.error('usage: node componentize.mjs --in "<glob>" [--config ds.config.json] [--out out/enriched] [--report]'); process.exit(2); }
  let config = {};
  if (a.config) {
    config = JSON.parse(fs.readFileSync(a.config, 'utf8'));
    const v = validate('config', config);
    if (!v.ok) console.warn('notice: config does not validate:\n' + formatErrors(v));
  }
  try {
    const r = await componentize({ ...a, config, configDir: a.config ? path.dirname(path.resolve(a.config)) : process.cwd() });
    const s = r.stats;
    console.log(`components ${s.components} (auto ${s.auto}, review ${s.review}), instances ${s.instances}, nodes in instances ${s.coveragePct}% of ${s.nodes}, ${s.seconds}s, peak ${s.peakRssMB} MB`);
  } catch (e) {
    console.error('componentize failed: ' + (e && e.stack || e));
    process.exit(1);
  }
}
