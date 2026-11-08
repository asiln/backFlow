// Validates every fixture in fixtures/ds against its schema and checks the cross-file consistency of the contracts.
// Usage: node scripts/validate-ds.mjs [file.json schemaName]...   (exit code 1 on any failure)
//   with arguments: validate only the given pairs, e.g.  node scripts/validate-ds.mjs out/enriched/a.figma.json screen-file out/enriched/_library.json library
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, formatErrors } from '../tools/ds/common/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(root, 'fixtures/ds');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL ' + msg); };
const pass = (msg) => console.log('ok   ' + msg);

function schemaCheck(file, schema) {
  const r = validate(schema, read(file));
  if (r.ok) pass(`${path.relative(root, file)} -> ${schema}`);
  else fail(`${path.relative(root, file)} -> ${schema} (${r.total} error(s))\n${formatErrors(r)}`);
  return r.ok;
}

const args = process.argv.slice(2);
if (args.length) {
  if (args.length % 2) { console.error('arguments must be pairs: <file> <schema>'); process.exit(2); }
  for (let i = 0; i < args.length; i += 2) schemaCheck(path.resolve(args[i]), args[i + 1]);
  process.exit(failures ? 1 : 0);
}

const PAIRS = [
  ['plain-sample.figma.json', 'screen-file'], ['enriched-sample.figma.json', 'screen-file'], ['_library.json', 'library'],
  ['tokens.json', 'tokens'], ['ds.config.json', 'config'], ['ds-inventory.json', 'inventory'], ['component-decisions.json', 'decisions'],
];
for (const [f, s] of PAIRS) schemaCheck(path.join(FX, f), s);

// ---------------------------------------------------------------- cross-file consistency
const plain = read(path.join(FX, 'plain-sample.figma.json'));
const enriched = read(path.join(FX, 'enriched-sample.figma.json'));
const lib = read(path.join(FX, '_library.json'));
const tokens = read(path.join(FX, 'tokens.json'));
const inv = read(path.join(FX, 'ds-inventory.json'));
const cfg = read(path.join(FX, 'ds.config.json'));
const dec = read(path.join(FX, 'component-decisions.json'));

const walk = (n, fn, p = []) => { fn(n, p); (n.children || []).forEach((c, i) => walk(c, fn, p.concat(i))); };
const stripAdd = (n) => { const o = { ...n }; delete o.cmp; delete o.tok; if (n.children) o.children = n.children.map(stripAdd); return o; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. enriched = plain + cmp/tok only
const strippedFrames = enriched.frames.map(stripAdd);
if (eq(strippedFrames, plain.frames)) pass('enriched minus cmp/tok equals plain (legacy consumers see the same tree)');
else fail('enriched minus cmp/tok differs from plain');

// 2. every cmp id is in the library; variants exist; slot ids exist
const comps = new Map(lib.components.map((c) => [c.id, c]));
const icons = new Map(lib.icons.map((c) => [c.id, c]));
const slotIds = (c) => new Set(c.slots.map((s) => s.s));
let nInst = 0;
const checkCmp = (cmp, where) => {
  nInst++;
  const isIcon = cmp.id.startsWith('ic_');
  const entry = isIcon ? icons.get(cmp.id) : comps.get(cmp.id);
  if (!entry) return fail(`${where}: cmp.id ${cmp.id} not in library`);
  if (isIcon) { if (cmp.kind !== 'icon') fail(`${where}: icon ref without kind:'icon'`); return; }
  if (entry.variants) {
    if (!cmp.v) return fail(`${where}: variant set member without cmp.v`);
    const ok = entry.variants.members.some((m) => eq(m.v, cmp.v)) || Object.entries(cmp.v).every(([k, v]) => (entry.variants.props[k] || []).includes(v));
    if (!ok) fail(`${where}: variant ${JSON.stringify(cmp.v)} not in library props`);
  }
  const ids = slotIds(entry);
  for (const o of cmp.ov || []) {
    const [head, ...rest] = o.s.split('.');
    if (!ids.has(head)) { fail(`${where}: override slot ${o.s} not in ${entry.name} slots`); continue; }
    if (rest.length) {
      const outer = entry.slots.find((s) => s.s === head);
      if (outer.kind !== 'inst') fail(`${where}: dotted slot ${o.s} but slot ${head} is not 'inst'`);
    }
  }
};
enriched.frames.forEach((f, si) => walk(f, (n, p) => { if (n.cmp) checkCmp(n.cmp, `frame ${si} /${p.join('/')}`); }));
if (nInst) pass(`${nInst} cmp refs resolve against _library.json`);

// 3. library: slot paths exist in the root, defaults of text slots match root text, member variants are unique
for (const c of lib.components) {
  const at = (path2) => path2.reduce((n, i) => n && n.children && n.children[i], c.root);
  for (const s of c.slots) {
    const node = at(s.path);
    if (!node) { fail(`library ${c.name}: slot ${s.s} path ${JSON.stringify(s.path)} missing in root`); continue; }
    if (s.kind === 'text' && node.text !== s.default) fail(`library ${c.name}: slot ${s.s} default "${s.default}" != root text "${node.text}"`);
    if (s.kind === 'swap' && !(node.cmp && node.cmp.id === s.default)) fail(`library ${c.name}: slot ${s.s} swap default ${s.default} != root cmp`);
    if (s.kind === 'inst' && !(node.cmp && comps.has(node.cmp.id))) fail(`library ${c.name}: slot ${s.s} is not a nested instance in root`);
  }
  if (c.band !== (c.conf >= 80 ? 'auto' : 'review')) fail(`library ${c.name}: band ${c.band} does not match conf ${c.conf}`);
  if (c.variants) {
    const keys = c.variants.members.map((m) => JSON.stringify(m.v));
    if (new Set(keys).size !== keys.length) fail(`library ${c.name}: duplicate variant members`);
    const n = c.variants.members.reduce((a, m) => a + m.n, 0);
    if (n !== c.stats.occ) fail(`library ${c.name}: sum of member n (${n}) != stats.occ (${c.stats.occ})`);
  }
}
pass('library slots, defaults, bands and variant members are consistent');

// 4. every tok key in the enriched tree and library exists in tokens.json with a live status
const live = new Set(['bound', 'create', 'review']);
const colourEntries = new Map(tokens.colors.map((e) => [`${e.key}|${e.role}`, e]));
const plainEntries = new Map([...tokens.textStyles, ...tokens.radii, ...tokens.spacing, ...tokens.effects, ...(tokens.sizes || [])].map((e) => [e.key, e]));
const ROLE = { f: 'fill', s: 'stroke', tx: 'text', ic: 'icon' };
let nTok = 0;
const checkTok = (tok, where) => {
  for (const [k, v] of Object.entries(tok)) {
    const keys = k === 'p' ? v.filter(Boolean) : [v];
    for (const key of keys) {
      nTok++;
      const e = ROLE[k] ? colourEntries.get(`${key}|${ROLE[k]}`) : plainEntries.get(key);
      if (!e) fail(`${where}: tok.${k}=${key} not in tokens.json`);
      else if (!live.has(e.status)) fail(`${where}: tok.${k}=${key} has status ${e.status} (only bound/create/review may be referenced)`);
    }
  }
};
const trees = [...enriched.frames, ...lib.components.flatMap((c) => [c.root, ...(c.variants ? c.variants.members.map((m) => m.root) : [])])];
trees.forEach((t, i) => walk(t, (n, p) => { if (n.tok) checkTok(n.tok, `tree ${i} /${p.join('/')}`); }));
pass(`${nTok} tok keys resolve against tokens.json`);

// 5. tokens: bound entries exist in the inventory, create entries do not, counts add up
const invVar = new Set(inv.variables.map((v) => v.id));
const invStyle = new Set(inv.textStyles.map((s) => s.id));
for (const e of [...tokens.colors, ...tokens.radii, ...tokens.spacing, ...tokens.textStyles]) {
  if (e.status === 'bound' && !(e.existing && (invVar.has(e.existing.id) || invStyle.has(e.existing.id)))) fail(`tokens ${e.key}: bound but existing not in ds-inventory.json`);
  if (e.status === 'create' && e.existing) fail(`tokens ${e.key}: create but has existing`);
  if (e.status === 'review' && e.existing) fail(`tokens ${e.key}: review should leave existing null`);
  if (e.status === 'create' && (e.count < cfg.thresholds.minUses || e.screens < cfg.thresholds.minScreens)) fail(`tokens ${e.key}: create below thresholds`);
}
let nodes = 0; plain.frames.forEach((f) => walk(f, () => { nodes++; }));
if (tokens.source.nodes !== nodes || tokens.source.screens !== plain.frames.length) fail(`tokens.source (${JSON.stringify(tokens.source)}) != plain sample (${plain.frames.length} screens, ${nodes} nodes)`);
else pass('tokens statuses match the inventory and the thresholds; source counts match the plain sample');

// 6. decisions refer to library ids
for (const d of dec.decisions) if (d.id && !comps.has(d.id)) fail(`decisions: unknown component ${d.id}`);
for (const d of dec.decisions) if (d.into && !comps.has(d.into)) fail(`decisions: unknown target ${d.into}`);

// 7. ds pointer
if (enriched.ds.library !== '_library.json' || enriched.ds.tokens !== 'tokens.json') fail('enriched.ds does not point at _library.json / tokens.json');

console.log(failures ? `\n${failures} failure(s)` : '\nall design-system fixtures valid');
process.exit(failures ? 1 : 0);
