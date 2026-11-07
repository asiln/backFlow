// usage: node pipeline.mjs <batches-dir> [--from <batch>] [--only <batch>] [--dry-run] [--out <dir>]
// Runs <batches-dir>/_pipeline.json: preflight checks, then each step (shell hooks around one extraction), then the finally hooks.
// Writes <out>/<dir>/<batch>.figma.json, <out>/<dir>/reports/<batch>.report.json, summary.json and SUMMARY.md.
// <out> defaults to out/final. See README.md ("Pipeline").
// Exit code: 0 all good, 1 a step / preflight / finally command failed, 2 everything ran but some screens look broken.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPipeline, validateManifest } from './pipeline-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const active = new Set();
const ctl = { stop: false };

function killTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch {}
}

function run(file, args, { timeoutMs, env, shell = false, onOut } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: here, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    active.add(child);
    let out = ''; let timedOut = false;
    const take = (b) => { out += b; if (out.length > 200000) out = out.slice(-100000); if (onOut) onOut(String(b)); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    child.on('error', (e) => { clearTimeout(timer); active.delete(child); resolve({ code: 127, output: String(e.message) }); });
    child.on('close', (code) => { clearTimeout(timer); active.delete(child); resolve({ code: timedOut ? 124 : (code ?? 1), output: timedOut ? out + '\n[timed out]' : out }); });
  });
}

function findShell() {
  if (process.env.PIPELINE_SHELL) return process.env.PIPELINE_SHELL;
  if (process.platform !== 'win32') return '/bin/sh';
  for (const p of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) if (fs.existsSync(p)) return p;
  return 'bash';
}

// Shell hooks run with sh/bash -c, cwd = this folder, and PIPELINE_* variables describing the step.
export const realExec = (cmd, { timeoutMs, env }) => run(findShell(), ['-c', cmd], { timeoutMs, env: { MSYS_NO_PATHCONV: '1', ...env } });

// One extraction = one child process, so a stuck page can be killed on timeout without taking the pipeline down.
export const realExtract = async ({ batchFile, outFile, reportFile, timeoutMs }) => {
  const r = await run(process.execPath, [path.join(here, 'extract.mjs'), batchFile, outFile, '--report', reportFile], { timeoutMs });
  if (r.code !== 0) {
    const tail = r.output.trim().split('\n').slice(-4).join(' | ').slice(0, 400);
    throw new Error(`extractor exited ${r.code}${r.code === 124 ? ' (step timeout)' : ''}: ${tail}`);
  }
  return {};
};

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const bool = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const from = flag('--from'); const only = flag('--only'); const out = flag('--out'); const dryRun = bool('--dry-run');
  const dir = args[0];
  if (!dir) { console.error('usage: node pipeline.mjs <batches-dir> [--from <batch>] [--only <batch>] [--dry-run] [--out <dir>]'); process.exit(1); }
  const batchDir = path.resolve(dir);
  const manifestFile = path.join(batchDir, '_pipeline.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (e) { console.error(`cannot read ${manifestFile}: ${e.message}`); process.exit(1); }
  const errs = validateManifest(manifest);
  if (errs.length) { console.error('invalid manifest:\n  ' + errs.join('\n  ')); process.exit(1); }

  const stop = () => { if (ctl.stop) return; ctl.stop = true; console.log('\ninterrupted: stopping, finally hooks will still run'); for (const c of active) killTree(c); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);

  const summary = await runPipeline({ batchDir, manifest, toolDir: here, outRoot: out ? path.resolve(out) : undefined, extract: realExtract, exec: realExec, from, only, dryRun, ctl, log: (m) => console.log(m) });
  if (dryRun) {
    console.log(`dry run: ${summary.steps.length} step(s) in ${batchDir}`);
    console.log('preflight:'); for (const c of summary.preflight) console.log('  ' + c);
    for (const s of summary.steps) {
      console.log(`- ${s.batch}: ${s.screens ?? '?'} screens -> ${s.output}${s.phone ? ' (account ' + s.phone + ')' : ''}${s.onlyIfMissing ? ' [only if missing]' : ''}${s.retries ? ' [retries ' + s.retries + ']' : ''}`);
      for (const c of s.before) console.log('    before: ' + c);
      for (const c of s.after) console.log('    after:  ' + c);
      if (s.deleteState.length) console.log('    delete state: ' + s.deleteState.join(', '));
      if (s.error) console.log('    PROBLEM: ' + s.error);
    }
    console.log('finally:'); for (const c of summary.finally) console.log('  ' + c);
    process.exit(summary.problems.length ? 1 : 0);
  }
  const done = summary.steps.filter((s) => s.status === 'ok').length;
  console.log(`\n${done}/${summary.steps.length} steps ok, ${summary.failedSteps.length} failed, ${summary.brokenScreens} broken screen(s), ${summary.elapsedSeconds}s. Summary: ${path.join(out ? path.resolve(out) : path.join(here, 'out', 'final'), summary.dir, 'SUMMARY.md')}`);
  process.exit(!summary.ok ? 1 : summary.brokenScreens ? 2 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
