// Syntax-checks every script and the plugin code. Run with: npm run check
import { spawnSync } from 'child_process';
import fs from 'fs'; import path from 'path';

const skip = new Set(['node_modules', 'out', 'batches', 'private', '.git']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js)$/.test(e.name)) files.push(p);
  }
})('.');

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error('FAIL', f, '\n' + r.stderr); }
}
for (const f of ['plugin/manifest.json', 'plugin/verify/manifest.json', 'package.json', 'figma-lift.config.example.json', 'batches.example/example.json']) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { bad++; console.error('BAD JSON', f, e.message); }
}
console.log(`${files.length} scripts checked, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
