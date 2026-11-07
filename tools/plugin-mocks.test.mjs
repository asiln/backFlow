// Runs the mock-based self-tests of the three Figma plugins (the mocks are not Figma: they guard logic and API misuse, see each file's header).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [name, file, ok] of [['components plugin', 'plugin-components/_mock.mjs', /ALL \d+ CHECKS PASSED/], ['tokens plugin', 'plugin-tokens/_mock.mjs', /PASS|passed|ok/i]]) {
  test(name + ' mock checks pass', () => {
    const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout || '').slice(-1500) + (r.stderr || ''));
    assert.match(r.stdout, ok);
  });
}
