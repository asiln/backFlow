#!/usr/bin/env node
// Design-token harvest (spec section 4). Usage:
//   node tokens.mjs --in "out/**/*.figma.json" [--tailwind tailwind.config.js] [--config ds.config.json]
//                   [--inventory ds-inventory.json] [--css-vars globals.css] [--out dir] [--report] [--strict]
// Writes <out>/tokens.json (default: ./tokens.json when --out is absent). With --out it also writes <out>/<file>.figma.json
// copies carrying `tok` annotations plus <out>/tokens-report.txt. Inputs are never overwritten.
// Exit codes: 0 ok | 1 runtime or validation failure | 2 usage error | 3 --strict and review/off-scale items exist.
import fs from 'node:fs';
import path from 'node:path';
import { createHarvester } from './tools/ds/tokens/harvest.mjs';
import { buildTokIndex, annotateTree } from './tools/ds/tokens/annotate.mjs';
import { renderReport } from './tools/ds/tokens/report.mjs';
import { expandGlob } from './tools/ds/tokens/glob.mjs';
import { parseCssVariables } from './tools/ds/tokens/tailwind.mjs';
import { validate, formatErrors } from './tools/ds/common/validate.mjs';

const USAGE = 'usage: node tokens.mjs --in "<glob>" [--in "<glob>"...] [--tailwind path] [--config ds.config.json] [--inventory ds-inventory.json]\n'
  + '                      [--css-vars file.css] [--out dir] [--report] [--strict] [--no-tailwind-defaults]';
const OPTS = { in: [], tailwind: null, config: null, inventory: null, 'css-vars': null, out: null, report: false, strict: false, 'no-tailwind-defaults': false };

function parseArgs(argv) {
  const o = { ...OPTS, in: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (!(name in OPTS)) throw new Error(`unknown option --${name}`);
    if (typeof OPTS[name] === 'boolean') { o[name] = true; continue; }
    const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (v == null) throw new Error(`--${name} needs a value`);
    if (name === 'in') o.in.push(v); else o[name] = v;
  }
  return o;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const SKIP = /^(_|tokens\.json$|ds-inventory|ds\.config|component-decisions)/;

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message + '\n' + USAGE); return 2; }
  if (!o.in.length) { console.error('--in is required\n' + USAGE); return 2; }

  const inputs = [...new Set(o.in.flatMap((g) => expandGlob(g)))].filter((f) => f.endsWith('.json') && !SKIP.test(path.basename(f)));
  if (!inputs.length) { console.error(`no input files match ${o.in.join(', ')}`); return 1; }

  let config = {};
  let basedir = process.cwd();
  try {
    if (o.config) { config = readJson(o.config); basedir = path.dirname(path.resolve(o.config)); }
    if (o.tailwind) config.tailwind = path.resolve(o.tailwind);
    config.basedir = basedir;
    if (o.inventory) config.inventory = readJson(o.inventory);
    if (o['css-vars']) config.cssVars = parseCssVariables(fs.readFileSync(o['css-vars'], 'utf8'));
    if (o['no-tailwind-defaults']) config.tailwindDefaults = false;
  } catch (e) { console.error(`cannot read configuration: ${e.message}`); return 1; }

  let h;
  try { h = createHarvester(config); } catch (e) { console.error(e.message); return 1; }
  let used = 0;
  for (const f of inputs) {
    let data;
    try { data = readJson(f); } catch (e) { console.error(`skip ${f}: ${e.message}`); continue; }
    if (!data || !Array.isArray(data.frames)) { console.error(`skip ${f}: no "frames" array`); continue; }
    h.addFile(data); used++;
  }
  if (!used) { console.error('no readable export files'); return 1; }
  const tokens = h.finish();
  const chk = validate('tokens', tokens);
  if (!chk.ok) { console.error('tokens.json does not match the schema:\n' + formatErrors(chk)); return 1; }

  const outDir = o.out ? path.resolve(o.out) : null;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const tokensPath = path.join(outDir || process.cwd(), 'tokens.json');
  if (inputs.map((f) => path.resolve(f)).includes(tokensPath)) { console.error('refusing to overwrite an input file'); return 1; }
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 1) + '\n');

  const report = renderReport(tokens, h.stats);
  if (o.report) process.stdout.write(report);
  else console.log(`tokens.json: ${tokens.colors.length} colours, ${tokens.textStyles.length} text styles, ${tokens.radii.length} radii, ${tokens.spacing.length} spacing, ${tokens.effects.length} effects, ${tokens.gradients.length} gradients (${tokens.findings.length} findings) -> ${tokensPath}`);

  if (outDir) {
    fs.writeFileSync(path.join(outDir, 'tokens-report.txt'), report);
    const index = buildTokIndex(tokens);
    const names = new Set();
    for (const f of inputs) {
      const dest = path.join(outDir, path.basename(f));
      if (path.resolve(dest) === path.resolve(f)) { console.error(`refusing to overwrite input ${f}`); return 1; }
      if (names.has(dest)) { console.error(`two inputs share the name ${path.basename(f)}; skipping the second`); continue; }
      names.add(dest);
      let data;
      try { data = readJson(f); } catch { continue; }
      if (!Array.isArray(data.frames)) continue;
      for (const root of data.frames) annotateTree(root, index);
      fs.writeFileSync(dest, JSON.stringify(data));
    }
  }
  if (o.strict && tokens.findings.some((x) => /decide manually|off-scale/.test(x))) return 3;
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error((e && e.stack) || e); process.exit(1); });
