// Token harvest (spec 4.1-4.4): walk every node of every screen once, count uses per key, snap measurement noise,
// map to Tailwind names, match the existing design system (ds-inventory.json) and assign a status.
//
//   harvest(files, config)          -> tokens.json object (tokens.schema.json)
//   harvestDetailed(files, config)  -> { tokens, stats }   (stats are for the CLI report only)
//   createHarvester(config)         -> { addFile(file), finish() }   (one file at a time, keeps memory flat)
//
// files   array of parsed export files ({ frames: [...] }; any marker such as figmaLift is accepted)
// config  ds.config.json content plus optional extras:
//           tailwind    path string (relative to config.basedir || cwd) or a model from tailwind.mjs
//           inventory   parsed ds-inventory.json
//           cssVars     { '--x': 'value' } passed to the Tailwind reader (extension hook)
//           generated   ISO timestamp (default: now); fixed by tests for reproducible output
//           x-collections {color,layout}, x-sizeNames { 'sz:h44': 'size/control' }, x-effectNames { 'e:...': 'Shadow/Dialog' }
//
// Rules worth knowing (see CONTRACT-NOTES 8-12):
//  * colour entries are unique per (key, role); everything else per key.
//  * snapping merges only measurement noise: colours within dE76 <= colorDeltaE and |dAlpha| <= alphaTol of a more frequent
//    colour of the same role (never two colours that are different Tailwind tokens); text styles with equal family/size/weight,
//    line height within 1px and letter spacing within 0.02em. Radius/spacing are never snapped: off-scale values are reported
//    with the nearest token and marked "snap candidate" when within 0.5px.
//  * status: bound (exists in the inventory) | review (several/uncertain matches) | create (above minUses and minScreens)
//    | off-scale (not on the scale, above thresholds) | skip (below thresholds).
import path from 'node:path';
import { parseColourKey, deltaE76, rgbaToHex, hex6 } from '../common/colour.mjs';
import { parseTextStyleKey, effectKey } from '../common/keys.mjs';
import { nodeUses, r2 } from './extract.mjs';
import { loadTailwind } from './tailwind.mjs';

const DEFAULTS = { colorDeltaE: 1.5, alphaTol: 0.02, minUses: 3, minScreens: 2 };
const FILL = ['FRAME_FILL', 'SHAPE_FILL'];
const SCOPES = {
  fill: FILL, text: ['TEXT_FILL'], stroke: ['STROKE_COLOR'], icon: ['SHAPE_FILL', 'STROKE_COLOR'],
  shadow: ['EFFECT_COLOR'], 'gradient-stop': FILL,
};
const PREFIX = { fill: 'bg', text: 'text', stroke: 'border', icon: 'icon', shadow: 'effect', 'gradient-stop': 'gradient' };
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const WEIGHT_CLASS = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byCount = (a, b) => b.count - a.count || cmpKey(a.key, b.key) || cmpKey(a.role || '', b.role || '');

export function normaliseConfig(config = {}) {
  const th = { ...DEFAULTS, ...(config.thresholds || {}) };
  for (const k of Object.keys(DEFAULTS)) if (config[k] != null && typeof config[k] === 'number') th[k] = config[k];
  let tw = config.tailwind ?? null;
  if (typeof tw === 'string') tw = loadTailwind(path.resolve(config.basedir || process.cwd(), tw), { cssVars: config.cssVars, resolveVar: config.resolveVar, defaults: config.tailwindDefaults });
  return {
    th, tw,
    tokenMap: config.tokenMap || {},
    textStyleNames: config.textStyleNames || {},
    inventory: config.inventory || null,
    collections: { color: 'Color', layout: 'Layout', ...(config['x-collections'] || {}) },
    sizeNames: config['x-sizeNames'] || {},
    effectNames: config['x-effectNames'] || {},
    generated: config.generated || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- inventory index
function indexInventory(inv) {
  const idx = { collByName: new Map(), collById: new Map(), vars: [], varByName: new Map(), varById: new Map(), textStyles: [], effectStyles: [], paintStyles: [] };
  if (!inv) return idx;
  for (const c of inv.collections || []) { idx.collByName.set(c.name, c); idx.collById.set(c.id, c); }
  for (const v of inv.variables || []) {
    idx.vars.push(v); idx.varById.set(v.id, v);
    const c = idx.collById.get(v.collection);
    idx.varByName.set(`${c ? c.name : v.collection}|${v.name}`, v);
  }
  idx.textStyles = inv.textStyles || [];
  idx.effectStyles = inv.effectStyles || [];
  idx.paintStyles = inv.paintStyles || [];
  return idx;
}
function resolveVarValue(idx, v, depth = 0) {
  const coll = idx.collById.get(v.collection);
  const modeId = coll && coll.modes && coll.modes[0] ? coll.modes[0].id : Object.keys(v.valuesByMode || {})[0];
  let val = (v.valuesByMode || {})[modeId];
  if (val === undefined) val = Object.values(v.valuesByMode || {})[0];
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const t = idx.varById.get(val.id);
    return t && depth < 6 ? resolveVarValue(idx, t, depth + 1) : undefined;
  }
  return val;
}
const scopeOk = (v, wanted) => !v.scopes || v.scopes.length === 0 ? null : v.scopes.includes('ALL_SCOPES') || v.scopes.some((s) => wanted.includes(s));

// ---------------------------------------------------------------- harvester
export function createHarvester(rawConfig = {}) {
  const cfg = normaliseConfig(rawConfig);
  const { th, tw } = cfg;
  const inv = indexInventory(cfg.inventory);
  const uses = new Map();
  const stats = { files: 0, screens: 0, nodes: 0, blur: 0, bblur: 0, strokeWeights: new Map(), twUnresolved: tw ? tw.unresolved.length : 0, snapped: { colors: 0, text: 0 }, textRuns: 0 };
  let screenNo = 0;

  const add = (u, sc, n) => {
    const id = u.family === 'c' ? `c|${u.key}|${u.role}` : `${u.family}|${u.key}`;
    let a = uses.get(id);
    if (!a) { a = { family: u.family, key: u.key, role: u.family === 'c' ? u.role : '', count: 0, screens: new Set(), roles: {} }; uses.set(id, a); }
    a.count++; a.screens.add(sc);
    if (u.family !== 'c') a.roles[u.role] = (a.roles[u.role] || 0) + 1;
    void n;
  };

  function addFile(file) {
    stats.files++;
    const frames = file && Array.isArray(file.frames) ? file.frames : [];
    for (const root of frames) {
      const sc = screenNo++;
      stats.screens++;
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        stats.nodes++;
        for (const u of nodeUses(n)) add(u, sc, n);
        if (n.blur > 0) stats.blur++;
        if (n.bblur > 0) stats.bblur++;
        if (n.stroke && Array.isArray(n.stroke.w) && n.stroke.w[0] > 0) {
          const w = r2(n.stroke.w[0]);
          stats.strokeWeights.set(w, (stats.strokeWeights.get(w) || 0) + 1);
        }
        if (n.children) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
      }
    }
  }

  // -------------------------------------------------------------- tailwind lookups
  const twColours = tw ? tw.colors : [];
  function twColourMatch(rgba, role) {
    if (!twColours.length) return null;
    const bytes = (c) => [c.r, c.g, c.b].map((x) => Math.round(x * 255));
    const want = bytes(rgba);
    const hits = [];
    twColours.forEach((c, order) => {
      const b = bytes(c.rgba);
      if (!b.every((x, i) => Math.abs(x - want[i]) <= 1)) return;
      const ca = c.rgba.a == null ? 1 : c.rgba.a;
      if (ca < 0.999 && Math.abs(ca - rgba.a) > 0.01) return; // config colour carries its own alpha: only an equal alpha matches
      hits.push({ name: c.name, order, ownAlpha: ca < 0.999, mapped: !!(cfg.tokenMap[c.name] && cfg.tokenMap[c.name][role]), shade: /-\d+$/.test(c.name) });
    });
    if (!hits.length) return null;
    hits.sort((a, b) => Number(b.mapped) - Number(a.mapped) || Number(a.shade) - Number(b.shade) || a.order - b.order);
    return hits[0];
  }
  const twBaseName = (rgba) => { const h = twColourMatch({ ...rgba, a: 1 }, ''); return h && !h.ownAlpha ? h.name : null; };

  function numTable(kind) { return tw && Object.keys(tw[kind]).length ? tw[kind] : null; }

  // -------------------------------------------------------------- finish
  function finish() {
    const accs = [...uses.values()];
    const meetsThresholds = (e) => e.count >= th.minUses && e.screens >= th.minScreens;
    const thresholdStatus = (e) => (meetsThresholds(e) ? 'create' : 'skip');
    const findings = [];
    const takenNames = new Map();
    const uniqueName = (scope, name, key) => {
      const k = `${scope}|${name}`;
      if (!takenNames.has(k) || takenNames.get(k) === key) { takenNames.set(k, key); return name; }
      let i = 2;
      while (takenNames.has(`${scope}|${name}-${i}`) && takenNames.get(`${scope}|${name}-${i}`) !== key) i++;
      takenNames.set(`${scope}|${name}-${i}`, key);
      findings.push(`name collision: ${key} wanted ${name}, using ${name}-${i}`);
      return `${name}-${i}`;
    };

    // ---- colours: snap per role (leader clustering, spec 4.2)
    const colourAccs = accs.filter((a) => a.family === 'c').map((a) => {
      const p = parseColourKey(a.key);
      return { ...a, rgba: p.rgba, hex: p.hex, a: p.a, pct: p.pct, members: [], twBase: twBaseName(p.rgba) };
    }).sort(byCount);
    const leaders = [];
    for (const e of colourAccs) {
      let hit = null;
      for (const l of leaders) {
        if (l.role !== e.role || Math.abs(l.a - e.a) > th.alphaTol + 1e-9) continue;
        if (l.twBase && e.twBase && l.twBase !== e.twBase) continue;
        const d = deltaE76(l.rgba, e.rgba);
        if (d <= th.colorDeltaE + 1e-9) { hit = { l, d }; break; }
      }
      if (hit) {
        const { l, d } = hit;
        l.members.push({ key: e.key, count: e.count, dev: Math.round(d * 100) / 100 });
        l.count += e.count; for (const s of e.screens) l.screens.add(s);
        l.roles[e.role] = (l.roles[e.role] || 0) + e.count;
        stats.snapped.colors++;
      } else { e.roles = { [e.role]: e.count }; leaders.push(e); }
    }

    const colors = leaders.sort(byCount).map((u) => {
      const e = { key: u.key, role: u.role, hex: u.hex, a: u.a, count: u.count, screens: u.screens.size, roles: u.roles };
      const m = twColourMatch(u.rgba, u.role);
      let name;
      if (m) {
        e.tailwind = m.ownAlpha || u.pct === 100 ? m.name : `${m.name}/${u.pct}`;
        const mapped = cfg.tokenMap[m.name] && cfg.tokenMap[m.name][u.role];
        const base = mapped || `${PREFIX[u.role]}/${m.name}`;
        name = m.ownAlpha || u.pct === 100 ? base : `${base}-${u.pct}`;
      } else name = `${PREFIX[u.role]}/${hex6(u.rgba)}${u.pct === 100 ? '' : '-' + u.pct}`;
      const scopes = SCOPES[u.role];
      let existingVar = inv.varByName.get(`${cfg.collections.color}|${name}`);
      if (existingVar && existingVar.type !== 'COLOR') existingVar = null;
      if (existingVar) {
        e.target = { collection: cfg.collections.color, name, type: 'COLOR', scopes };
        e.existing = { id: existingVar.id, name: `${cfg.collections.color}/${existingVar.name}` };
        e.status = 'bound';
        const val = resolveVarValue(inv, existingVar);
        if (val && typeof val === 'object' && 'r' in val && rgbaToHex(val) !== u.hex) findings.push(`${u.key} (${u.role}): existing variable ${e.existing.name} has value ${rgbaToHex(val)}, the design uses ${u.hex}`);
      } else {
        name = uniqueName('c', name, `${u.key}|${u.role}`);
        e.target = { collection: cfg.collections.color, name, type: 'COLOR', scopes };
        e.existing = null;
        const semantic = [], primitive = [];
        for (const v of inv.vars) {
          if (v.type !== 'COLOR') continue;
          const val = resolveVarValue(inv, v);
          if (!val || typeof val !== 'object' || !('r' in val) || rgbaToHex(val) !== u.hex || Math.abs((val.a ?? 1) - u.a) >= 0.005) continue;
          const ok = scopeOk(v, scopes);
          if (ok === true) semantic.push(v); else if (ok === null) primitive.push(v);
        }
        const nm = (v) => ({ id: v.id, name: `${(inv.collById.get(v.collection) || { name: v.collection }).name}/${v.name}` });
        if (semantic.length) { e.status = 'review'; e.candidates = semantic.map(nm); }
        else if (primitive.length === 1) {
          e.status = 'bound'; e.existing = nm(primitive[0]);
          findings.push(`${u.key} (${u.role}) uses primitive ${e.existing.name}: no semantic variable has this value`);
        } else if (primitive.length) { e.status = 'review'; e.candidates = primitive.map(nm); }
        else e.status = thresholdStatus(e);
      }
      if (u.members.length) e.members = u.members;
      if (e.status === 'skip') { delete e.target; delete e.existing; }
      return e;
    });

    // ---- text styles: snap (equal family/size/weight, lh within 1px, ls within 0.02em)
    const textAccs = accs.filter((a) => a.family === 't').map((a) => ({ ...a, p: parseTextStyleKey(a.key), members: [] })).sort(byCount);
    const tl = [];
    for (const e of textAccs) {
      const l = tl.find((x) => x.p.family === e.p.family && x.p.size === e.p.size && x.p.weight === e.p.weight && Math.abs(x.p.lh - e.p.lh) <= 1 && Math.abs(x.p.lsEm - e.p.lsEm) <= 0.02);
      if (l) {
        l.members.push({ key: e.key, count: e.count, dev: Math.round(Math.abs(l.p.lh - e.p.lh) * 100) / 100 });
        l.count += e.count; for (const s of e.screens) l.screens.add(s);
        stats.snapped.text++;
      } else tl.push(e);
    }
    const domFamily = (() => { const c = {}; for (const e of tl) c[e.p.family] = (c[e.p.family] || 0) + e.count; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; })();
    const twText = tw ? tw.fontSize : [];
    const textStyles = tl.sort(byCount).map((u) => {
      const e = { key: u.key, count: u.count, screens: u.screens.size };
      const hint = twText.find((f) => f.size === u.p.size && (f.lh == null || Math.abs(f.lh - u.p.lh) <= 0.5));
      if (hint) e.tailwind = `text-${hint.name} font-${WEIGHT_CLASS[u.p.weight] || u.p.weight}`;
      const w = WEIGHT_NAMES[u.p.weight] || String(u.p.weight);
      const size = u.p.size;
      let name = cfg.textStyleNames[u.key] || `Text/${u.p.family === domFamily ? '' : u.p.family + ' '}${size} ${w}`;
      let ex = inv.textStyles.find((s) => s.name === name);
      if (!ex) {
        ex = inv.textStyles.find((s) => {
          const lh = s.lineHeight && s.lineHeight.unit === 'PIXELS' ? s.lineHeight.value : null;
          const ls = s.letterSpacing ? (s.letterSpacing.unit === 'PERCENT' ? s.letterSpacing.value / 100 : s.letterSpacing.unit === 'PIXELS' && s.fontSize ? s.letterSpacing.value / s.fontSize : 0) : 0;
          const sw = Object.entries(WEIGHT_NAMES).find(([, n]) => n.toLowerCase() === String(s.fontName.style).replace(/\s+/g, '').toLowerCase());
          return s.fontName.family === u.p.family && s.fontSize === size && (lh == null || Math.abs(lh - u.p.lh) < 0.01) && Math.abs(ls - u.p.lsEm) < 0.006 && sw && Number(sw[0]) === u.p.weight;
        });
        if (ex) name = ex.name;
      }
      if (ex) { e.target = { name }; e.existing = { id: ex.id, name: ex.name }; e.status = 'bound'; }
      else { name = uniqueName('t', name, u.key); e.target = { name }; e.existing = null; e.status = thresholdStatus(e); }
      if (u.members.length) e.members = u.members;
      if (e.status === 'skip') { delete e.target; delete e.existing; }
      return e;
    });

    // ---- numeric families (radius, spacing)
    const numeric = (family, kind, { collection, scopes, nameOf, classOf, label, unit, parse }) => {
      const table = numTable(kind);
      return accs.filter((a) => a.family === family).sort(byCount).map((u) => {
        const e = { key: u.key, count: u.count, screens: u.screens.size };
        const px = parse(u.key);
        let nameTw = null;
        if (table && Number.isFinite(px)) for (const [k, v] of Object.entries(table)) if (Math.abs(v - px) < 1e-6) { nameTw = k; break; }
        if (nameTw != null) e.tailwind = classOf(nameTw);
        const mk = (name) => ({ collection, name, type: 'FLOAT', scopes });
        let named = nameTw != null ? inv.varByName.get(`${collection}|${nameOf(nameTw)}`) : null;
        if (named && named.type !== 'FLOAT') named = null;
        if (named) { e.target = mk(nameOf(nameTw)); e.existing = { id: named.id, name: `${collection}/${named.name}` }; e.status = 'bound'; }
        else {
          const cands = Number.isFinite(px) ? inv.vars.filter((v) => v.type === 'FLOAT' && scopeOk(v, scopes) === true && Number(resolveVarValue(inv, v)) === px) : [];
          if (cands.length === 1) {
            const c = cands[0];
            e.target = mk(c.name); e.existing = { id: c.id, name: `${(inv.collById.get(c.collection) || { name: collection }).name}/${c.name}` }; e.status = 'bound';
          } else if (cands.length > 1) {
            e.target = mk(nameTw != null ? nameOf(nameTw) : nameOf(String(px))); e.existing = null; e.status = 'review';
            e.candidates = cands.map((c) => ({ id: c.id, name: `${(inv.collById.get(c.collection) || { name: collection }).name}/${c.name}` }));
          } else if (nameTw != null) { e.target = mk(nameOf(nameTw)); e.existing = null; e.status = thresholdStatus(e); }
          else if (!table) { e.target = mk(nameOf(String(px))); e.existing = null; e.status = Number.isFinite(px) ? thresholdStatus(e) : (meetsThresholds(e) ? 'off-scale' : 'skip'); }
          else {
            e.status = meetsThresholds(e) ? 'off-scale' : 'skip';
            if (e.status === 'off-scale' && Number.isFinite(px)) {
              let best = null;
              for (const [k, v] of Object.entries(table)) if (best === null || Math.abs(v - px) < Math.abs(best[1] - px)) best = [k, v];
              if (best) e.nearest = `${label}/${best[0]}(${best[1]})`;
              if (best && Math.abs(best[1] - px) <= 0.5) e.nearest += ' snap candidate';
            }
          }
        }
        if (e.status === 'skip') { delete e.target; delete e.existing; }
        void unit;
        return e;
      });
    };
    const radii = numeric('r', 'radius', {
      collection: cfg.collections.layout, scopes: ['CORNER_RADIUS'], nameOf: (k) => `radius/${k === 'DEFAULT' ? 'default' : k}`,
      classOf: (k) => (k === 'DEFAULT' ? 'rounded' : `rounded-${k}`), label: 'radius', parse: (key) => (/^r:[\d.]+$/.test(key) ? Number(key.slice(2)) : NaN),
    });
    const spacing = numeric('sp', 'spacing', {
      collection: cfg.collections.layout, scopes: ['GAP'], nameOf: (k) => `spacing/${k}`, classOf: (k) => `p-${k}`, label: 'spacing', parse: (key) => Number(key.slice(3)),
    });

    // ---- effects
    const effects = accs.filter((a) => a.family === 'e').sort(byCount).map((u) => {
      const e = { key: u.key, count: u.count, screens: u.screens.size, status: thresholdStatus({ count: u.count, screens: u.screens.size }) };
      const twS = tw ? tw.shadows.find((s) => s.key === u.key) : null;
      if (twS) e.tailwind = `shadow${twS.name === 'DEFAULT' ? '' : '-' + twS.name}`;
      const ex = inv.effectStyles.find((s) => keyOfEffects(s.effects) === u.key);
      if (ex) { e.target = { style: ex.name }; e.existing = { id: ex.id, name: ex.name }; e.status = 'bound'; return e; }
      if (e.status === 'create') {
        const name = cfg.effectNames[u.key] || effectName(u.key, twS);
        e.target = { style: uniqueName('e', name, u.key) };
      }
      return e;
    });

    // ---- gradients
    const gradients = accs.filter((a) => a.family === 'g').sort(byCount).map((u) => {
      const e = { key: u.key, count: u.count, screens: u.screens.size, status: thresholdStatus({ count: u.count, screens: u.screens.size }) };
      const name = gradientName(u.key, twColourMatch, parseColourKey);
      const ex = inv.paintStyles.find((s) => s.name === name);
      if (ex) { e.target = { style: name }; e.existing = { id: ex.id, name: ex.name }; e.status = 'bound'; }
      else if (e.status === 'create') e.target = { style: uniqueName('g', name, u.key) };
      return e;
    });

    // ---- sizes
    const sizes = [];
    {
      let first = true;
      for (const u of accs.filter((a) => a.family === 'sz').sort(byCount)) {
        const e = { key: u.key, count: u.count, screens: u.screens.size, status: thresholdStatus({ count: u.count, screens: u.screens.size }) };
        if (e.status === 'create') {
          const name = cfg.sizeNames[u.key] || (first ? 'size/control' : `size/control-${u.key.slice(4)}`);
          first = false;
          e.target = { collection: cfg.collections.layout, name: uniqueName('sz', name, u.key), type: 'FLOAT', scopes: ['WIDTH_HEIGHT'] };
        }
        sizes.push(e);
      }
    }

    for (const r of radii) if (r.status === 'off-scale') findings.push(`radius ${r.key.slice(2)} used ${r.count}x: off-scale (nearest ${r.nearest || 'none'})`);
    for (const s of spacing) if (s.status === 'off-scale') findings.push(`spacing ${s.key.slice(3)} used ${s.count}x: off-scale (nearest ${s.nearest || 'none'})`);
    for (const s of spacing) if (s.status === 'skip') findings.push(`spacing ${s.key.slice(3)} used ${s.count}x on ${s.screens} screen(s): below thresholds, stays literal`);
    for (const c of colors) if (c.status === 'review') findings.push(`${c.key} (${c.role}) matches ${c.candidates.length} existing variables (${c.candidates.map((x) => x.name).join(', ')}): decide manually`);
    for (const r of [...radii, ...spacing, ...effects]) if (r.status === 'review') findings.push(`${r.key} matches several existing variables: decide manually`);
    if (stats.snapped.colors) findings.push(`${stats.snapped.colors} near-equal colour value(s) merged into a more frequent one (see members)`);
    if (stats.snapped.text) findings.push(`${stats.snapped.text} near-equal text style(s) merged into a more frequent one (see members)`);
    if (tw && tw.unresolved.length) findings.push(`${tw.unresolved.length} Tailwind colour(s) could not be resolved (CSS variables?): not used for naming`);

    return {
      version: 1, generated: cfg.generated,
      source: { files: stats.files, screens: stats.screens, nodes: stats.nodes },
      config: { colorDeltaE: th.colorDeltaE, alphaTol: th.alphaTol, minUses: th.minUses, minScreens: th.minScreens },
      colors, gradients, textStyles, radii, spacing, effects, sizes, findings,
    };
  }

  return { addFile, finish, stats };
}

// ---------------------------------------------------------------- helpers
function keyOfEffects(effects) {
  const sh = (effects || []).filter((x) => x && (x.type === 'DROP_SHADOW' || x.type === 'INNER_SHADOW') && x.visible !== false)
    .map((x) => ({ c: x.color, x: x.offset ? x.offset.x : 0, y: x.offset ? x.offset.y : 0, blur: x.radius || 0, spread: x.spread || 0, inset: x.type === 'INNER_SHADOW' }));
  return sh.length && sh.every((s) => s.c) ? effectKey(sh) : null;
}
function effectName(key, twS) {
  if (twS) return `Shadow/${twS.name === 'DEFAULT' ? 'default' : twS.name}`;
  const first = key.slice(2).split('|')[0];
  const inset = first.startsWith('i');
  const [x, y, blur] = first.replace(/^i/, '').split(',').map(Number);
  const n = key.split('|').length;
  const tail = n > 1 ? `+${n - 1}` : '';
  if (x === 0 && y === 0) return `${inset ? 'Inner' : 'Glow'}/blur${blur}${tail}`;
  return `${inset ? 'Inner' : 'Shadow'}/y${y}-blur${blur}${tail}`;
}
function gradientName(key, twColourMatch, parse) {
  const [, type, , stops] = /^g:([^:]+):([^:]+):(.*)$/.exec(key) || [];
  const names = (stops || '').split(',').map((s) => {
    const ck = 'c:' + s.split('~')[0];
    const p = parse(ck);
    const m = twColourMatch(p.rgba, 'fill');
    return m ? m.name + (p.pct < 100 && !m.ownAlpha ? `-${p.pct}` : '') : ck.slice(2, 8) + (p.pct < 100 ? `-${p.pct}` : '');
  });
  const uniq = names.length > 2 ? [names[0], names[names.length - 1]] : names;
  return `Gradient/${type === 'radial' ? 'radial-' : ''}${uniq.join('-to-')}`;
}

export function harvestDetailed(files, config = {}) {
  const h = createHarvester(config);
  for (const f of files) h.addFile(f);
  return { tokens: h.finish(), stats: h.stats };
}
export function harvest(files, config = {}) { return harvestDetailed(files, config).tokens; }

