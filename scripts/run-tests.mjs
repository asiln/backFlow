// Portable `node --test tools`: Node 18/20 accept a directory, Node 22+ only globs/files, so collect the *.test.mjs files ourselves.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.test\.(mjs|js)$/.test(e.name)) files.push(p);
  }
})(path.join(root, process.argv[2] || 'tools'));

if (!files.length) { console.error('no test files found'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
