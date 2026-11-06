// usage: node run-all.mjs <batch-dir> [--only <name-substring>]
// Runs every *.json batch in the directory (files starting with "_" are skipped) one after another and writes
//   out/<dir>/<batch>.figma.json   one import file per batch
//   out/<dir>/summary.json         per screen: name, finalUrl, size, nodes, images, warnings, broken
// Exit code 1 if any screen looks broken (404, redirect to login, '???', error toast, empty, capture failure, ...).
// --only matches batch file names and screen names (case-insensitive substring).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { runBatch } from './extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf('--only'); let only = null;
if (oi >= 0) { only = (args[oi + 1] || '').toLowerCase(); args.splice(oi, 2); }
const dirArg = args[0];
if (!dirArg) { console.error('usage: node run-all.mjs <batch-dir> [--only <substring>]'); process.exit(1); }
const dir = path.resolve(dirArg);
if (!fs.existsSync(dir)) { console.error('no such directory: ' + dir); process.exit(1); }
const outDir = path.join(here, 'out', path.basename(dir));
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
const summary = { dir, startedAt: new Date().toISOString(), screens: [], batches: [] };
let anyBroken = false;

for (const f of files) {
  const file = path.join(dir, f), name = path.basename(f, '.json');
  let batch;
  try { batch = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { summary.batches.push({ batch: name, error: 'invalid JSON: ' + e.message }); anyBroken = true; console.log(`[${name}] invalid JSON`); continue; }
  if (only && !name.toLowerCase().includes(only) && !(batch.screens || []).some((s) => String(s.name || s.path).toLowerCase().includes(only))) continue;
  console.log(`== ${name} (${(batch.screens || []).length} screens)`);
  const t0 = Date.now();
  try {
    const res = await runBatch(file, path.join(outDir, name + '.figma.json'), { only, log: () => {} });
    for (const r of res.report) {
      summary.screens.push({ batch: name, name: r.name, finalUrl: r.finalUrl, size: r.size, nodes: r.nodes, images: r.images, warnings: r.warnings, broken: r.broken });
      console.log(`  ${r.broken ? 'BROKEN' : r.warnings.length ? 'warn  ' : 'ok    '} ${r.name}  ${r.size || ''}  ${r.nodes} nodes`);
      for (const w of r.warnings) console.log('         ' + w);
      if (r.broken) anyBroken = true;
    }
    summary.batches.push({ batch: name, file: path.relative(here, res.outFile), screens: res.report.length, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    anyBroken = true;
    summary.batches.push({ batch: name, error: String(e && e.message || e) });
    console.log(`  batch failed: ${e && e.message || e}`);
  }
}
summary.total = summary.screens.length;
summary.broken = summary.screens.filter((s) => s.broken).length;
summary.warned = summary.screens.filter((s) => !s.broken && s.warnings.length).length;
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`\n${summary.total} screens, ${summary.broken} broken, ${summary.warned} with warnings. Summary: ${path.join(outDir, 'summary.json')}`);
process.exit(anyBroken ? 1 : 0);
