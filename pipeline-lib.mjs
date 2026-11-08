// Pipeline logic: run a manifest of extraction steps, with shell hooks around each step.
// Pure of any browser code: the extractor and the shell runner are injected (see pipeline.mjs for the real ones),
// so everything here can be tested with fakes.
//
// Manifest: <batches dir>/_pipeline.json
//   { "preflight": [cmd...],                     every command must exit 0 or nothing runs (finally still runs)
//     "steps": [ { "batch": "file.json",          path relative to the batches dir
//                  "before": [cmd...], "after": [cmd...],
//                  "retries": 0,                  extra attempts (whole step: before, extract, after)
//                  "deleteState": ["phone"],      saved sessions to delete afterwards ("phone" = the batch's phone field)
//                  "onlyIfMissing": false } ],    skip when a complete output already exists
//     "finally": [cmd...],                        always runs, every command, failures are recorded
//     "commandTimeoutSec": 180, "stepTimeoutMin": 45 }
import fs from 'node:fs';
import path from 'node:path';

export const CONTEXT_DESTROYED = /Execution context was destroyed/i;
export const F0_THRESHOLD = 90;

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const stepName = (batch) => path.basename(String(batch), '.json');

// ---------- manifest ----------
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest must be a JSON object'];
  for (const k of ['preflight', 'finally']) if (m[k] != null && !(Array.isArray(m[k]) && m[k].every((c) => typeof c === 'string' && c.trim()))) errors.push(`${k} must be an array of non-empty strings`);
  if (!Array.isArray(m.steps) || !m.steps.length) errors.push('steps must be a non-empty array');
  const seen = new Set();
  (Array.isArray(m.steps) ? m.steps : []).forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!s || typeof s.batch !== 'string' || !s.batch.endsWith('.json')) { errors.push(`${at}.batch must be a .json file name`); return; }
    const n = stepName(s.batch);
    if (seen.has(n)) errors.push(`${at}: duplicate batch name "${n}"`);
    seen.add(n);
    for (const k of ['before', 'after', 'deleteState']) if (s[k] != null && !(Array.isArray(s[k]) && s[k].every((c) => typeof c === 'string' && c.trim()))) errors.push(`${at}.${k} must be an array of non-empty strings`);
    if (s.retries != null && !(Number.isInteger(s.retries) && s.retries >= 0 && s.retries <= 10)) errors.push(`${at}.retries must be an integer 0-10`);
    if (s.onlyIfMissing != null && typeof s.onlyIfMissing !== 'boolean') errors.push(`${at}.onlyIfMissing must be a boolean`);
  });
  return errors;
}

// exact name match wins; otherwise case-insensitive substring
function matchSteps(steps, needle) {
  const q = String(needle).toLowerCase().replace(/\.json$/, '');
  const exact = steps.filter((s) => stepName(s.batch).toLowerCase() === q);
  return exact.length ? exact : steps.filter((s) => stepName(s.batch).toLowerCase().includes(q));
}

export function selectSteps(steps, { from, only } = {}) {
  let out = steps.slice();
  if (from) {
    const hit = matchSteps(steps, from)[0];
    if (!hit) throw new Error(`--from: no step matches "${from}"`);
    out = out.slice(steps.indexOf(hit));
  }
  if (only) {
    const hits = new Set(matchSteps(steps, only));
    if (!hits.size) throw new Error(`--only: no step matches "${only}"`);
    out = out.filter((s) => hits.has(s));
  }
  return out;
}

// ---------- report maths ----------
const isInfo = (w) => /^info:/.test(w);
export function summarizeReport(report) {
  const rows = Array.isArray(report) ? report : [];
  const f0s = [];
  let min = null; const lowF0 = []; const broken = []; const warned = [];
  for (const r of rows) {
    const f0 = r && r.layout && typeof r.layout.F0 === 'number' ? r.layout.F0 : null;
    if (f0 != null) {
      f0s.push(f0);
      if (!min || f0 < min.F0) min = { name: r.name, F0: f0 };
      if (f0 < F0_THRESHOLD) lowF0.push({ name: r.name, F0: f0 });
    } else if (r && r.layout && r.layout.failed) lowF0.push({ name: r.name, F0: 0 });
    const warns = (r.warnings || []).filter((w) => !isInfo(w));
    if (r.broken) broken.push({ name: r.name, issues: warns.filter((w) => w.startsWith('ERROR')) });
    else if (warns.length) warned.push({ name: r.name, issues: warns });
  }
  const avg = f0s.length ? Math.round((f0s.reduce((a, b) => a + b, 0) / f0s.length) * 10) / 10 : null;
  return { f0Avg: avg, f0Min: min ? min.F0 : null, f0MinScreen: min ? min.name : null, lowF0, broken, warned };
}

export function readFrameCount(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j.frames) ? j.frames.length : 0;
}

// ---------- the run ----------
/**
 * @param {object} o
 * @param {string} o.batchDir     directory holding _pipeline.json and the batch files
 * @param {object} o.manifest     parsed manifest
 * @param {string} o.toolDir      where saved sessions (state-<id>.json) live; cwd for shell commands
 * @param {string} o.outRoot      output root (default <toolDir>/out/final)
 * @param {Function} o.extract    async ({batchFile, outFile, reportFile, timeoutMs, step}) => { report?: [] }   throws on failure
 * @param {Function} o.exec       async (cmd, {timeoutMs, env}) => { code, output }
 */
export async function runPipeline(o) {
  const { batchDir, manifest, toolDir, extract, exec } = o;
  const log = o.log || (() => {});
  const outRoot = o.outRoot || path.join(toolDir, 'out', 'final');
  const ctl = o.ctl || { stop: false };
  const cmdTimeoutMs = (manifest.commandTimeoutSec || 180) * 1000;
  const stepTimeoutMs = (manifest.stepTimeoutMin || 45) * 60 * 1000;
  const now = o.now || (() => Date.now());
  const dirName = path.basename(path.resolve(batchDir));
  const summaryDir = path.join(outRoot, dirName);
  const t0 = now();

  const errs = validateManifest(manifest);
  if (errs.length) throw new Error('invalid manifest:\n  ' + errs.join('\n  '));
  const selected = selectSteps(manifest.steps, { from: o.from, only: o.only });

  // layout of one step's files
  const layoutOf = (step) => {
    const batchFile = path.resolve(batchDir, step.batch);
    const name = stepName(step.batch);
    const dir = path.join(outRoot, path.basename(path.dirname(batchFile)));
    return { batchFile, name, dir, outFile: path.join(dir, name + '.figma.json'), reportFile: path.join(dir, 'reports', name + '.report.json') };
  };
  const readBatch = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { error: e.code === 'ENOENT' ? 'batch file not found' : 'invalid JSON: ' + e.message }; } };

  if (o.dryRun) {
    const plan = { dryRun: true, dir: dirName, preflight: asList(manifest.preflight), finally: asList(manifest.finally), steps: [], problems: [] };
    for (const step of selected) {
      const L = layoutOf(step); const b = readBatch(L.batchFile);
      const entry = { batch: L.name, outDir: path.basename(L.dir), screens: b.error ? null : (b.screens || []).length, phone: b.phone || null, before: asList(step.before), after: asList(step.after), retries: step.retries || 0, deleteState: asList(step.deleteState), onlyIfMissing: !!step.onlyIfMissing, output: L.outFile };
      if (b.error) { entry.error = b.error; plan.problems.push(`${L.name}: ${b.error}`); }
      plan.steps.push(entry);
    }
    return plan;
  }

  const env = { PIPELINE_TOOL_DIR: toolDir, PIPELINE_BATCH_DIR: path.resolve(batchDir), PIPELINE_OUT_DIR: outRoot };
  const runCmds = async (cmds, label, stepEnv = {}) => {
    const results = [];
    for (const cmd of asList(cmds)) {
      log(`  ${label}: ${cmd.length > 140 ? cmd.slice(0, 137) + '...' : cmd}`);
      let r;
      try { r = await exec(cmd, { timeoutMs: cmdTimeoutMs, env: { ...env, ...stepEnv } }); } catch (e) { r = { code: 1, output: String(e && e.message || e) }; }
      results.push({ cmd, code: r.code, output: String(r.output || '').slice(-1500) });
      if (r.code !== 0) { log(`    exit ${r.code}: ${String(r.output || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`); }
    }
    return results;
  };

  // previous summary (so --only / --from keep the other rows)
  const summaryFile = path.join(summaryDir, 'summary.json');
  const prevByName = new Map();
  try { for (const s of JSON.parse(fs.readFileSync(summaryFile, 'utf8')).steps || []) prevByName.set(s.batch, s); } catch {}

  const summary = { dir: dirName, startedAt: new Date(t0).toISOString(), finishedAt: null, elapsedSeconds: 0, selection: { from: o.from || null, only: o.only || null }, preflight: [], preflightOk: true, steps: [], finally: [], finallyOk: true, ok: true };
  const results = new Map();
  const writeSummary = () => {
    summary.steps = manifest.steps.map((s) => { const n = stepName(s.batch); return results.get(n) || (prevByName.has(n) ? { ...prevByName.get(n), carried: true } : { batch: n, status: 'not-run' }); });
    summary.elapsedSeconds = Math.round((now() - t0) / 1000);
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 1));
    fs.writeFileSync(path.join(summaryDir, 'SUMMARY.md'), renderSummaryMd(summary));
  };

  try {
    // preflight
    log('== preflight');
    summary.preflight = await runCmds(manifest.preflight, 'preflight');
    summary.preflightOk = summary.preflight.every((r) => r.code === 0);
    if (!summary.preflightOk) log('preflight failed: no step will run');

    for (const step of summary.preflightOk ? selected : []) {
      if (ctl.stop) break;
      const L = layoutOf(step);
      const batch = readBatch(L.batchFile);
      const row = { batch: L.name, outDir: path.basename(L.dir), file: L.outFile, status: 'failed', expected: Array.isArray(batch.screens) ? batch.screens.length : null, got: 0, sizeBytes: null, f0Avg: null, f0Min: null, f0MinScreen: null, lowF0: [], broken: [], warned: [], attempts: [], errors: [], keptPrevious: false, seconds: 0 };
      results.set(L.name, row);
      const stepStart = now();
      log(`== ${L.name} (${row.expected ?? '?'} screens)`);
      try {
        if (batch.error || !Array.isArray(batch.screens) || !batch.screens.length) { row.errors.push(batch.error || 'batch has no screens'); continue; }

        if (step.onlyIfMissing && fs.existsSync(L.outFile)) {
          let have = 0; try { have = readFrameCount(L.outFile); } catch {}
          if (have >= row.expected) {
            row.status = 'skipped-existing'; row.got = have; row.sizeBytes = fs.statSync(L.outFile).size;
            try { Object.assign(row, summarizeReport(JSON.parse(fs.readFileSync(L.reportFile, 'utf8')))); } catch {}
            log('  output already complete, skipped');
            continue;
          }
        }

        const stepEnv = { PIPELINE_STEP: L.name, PIPELINE_PHONE: batch.phone || '' };
        const tmpOut = path.join(L.dir, `.tmp-${L.name}.figma.json`);
        const tmpReport = path.join(L.dir, `.tmp-${L.name}.report.json`);
        const maxAttempts = 1 + (step.retries || 0);
        for (let attempt = 1; attempt <= maxAttempts && !ctl.stop; attempt++) {
          const at = { n: attempt, error: null, contextDestroyed: false, frames: 0 };
          row.attempts.push(at);
          if (attempt > 1) log(`  retry ${attempt - 1}/${maxAttempts - 1}`);
          let good = false; let report = null;
          fs.mkdirSync(path.join(L.dir, 'reports'), { recursive: true });
          try {
            const before = await runCmds(step.before, 'before', stepEnv);
            const badBefore = before.find((r) => r.code !== 0);
            if (badBefore) throw new Error(`before command failed (exit ${badBefore.code}): ${badBefore.cmd.slice(0, 100)}`);
            fs.rmSync(tmpOut, { force: true }); fs.rmSync(tmpReport, { force: true });
            const res = await extract({ batchFile: L.batchFile, outFile: tmpOut, reportFile: tmpReport, timeoutMs: stepTimeoutMs, step });
            report = res && Array.isArray(res.report) ? res.report : null;
            if (!report && fs.existsSync(tmpReport)) report = JSON.parse(fs.readFileSync(tmpReport, 'utf8'));
            if (!fs.existsSync(tmpOut)) throw new Error('extractor produced no output file');
            at.frames = readFrameCount(tmpOut);
            const ctxHit = (report || []).some((r) => (r.warnings || []).some((w) => CONTEXT_DESTROYED.test(w)));
            if (ctxHit) at.contextDestroyed = true;
            if (at.frames < row.expected) throw new Error(`only ${at.frames} of ${row.expected} screens captured${ctxHit ? ' (Execution context was destroyed)' : ''}`);
            good = true;
          } catch (e) {
            at.error = String(e && e.message || e).slice(0, 400);
            if (CONTEXT_DESTROYED.test(at.error)) at.contextDestroyed = true;
          }
          // after-hooks always run, so a failed attempt still restores what the before-hooks changed
          const after = await runCmds(step.after, 'after', stepEnv);
          const badAfter = after.find((r) => r.code !== 0);
          if (badAfter) row.errors.push(`after command failed (exit ${badAfter.code}): ${badAfter.cmd.slice(0, 100)}`);
          if (good) {
            fs.mkdirSync(L.dir, { recursive: true });
            fs.renameSync(tmpOut, L.outFile);
            const rep = report || [];
            fs.writeFileSync(L.reportFile, JSON.stringify(rep, null, 1));
            row.status = 'ok'; row.got = at.frames; row.sizeBytes = fs.statSync(L.outFile).size;
            Object.assign(row, summarizeReport(rep));
            break;
          }
          fs.rmSync(tmpOut, { force: true }); fs.rmSync(tmpReport, { force: true });
          log(`  attempt ${attempt} failed: ${at.error}`);
        }
        if (row.status !== 'ok') {
          const last = row.attempts[row.attempts.length - 1];
          row.errors.unshift(ctl.stop && !last?.error ? 'interrupted' : (last && last.error) || 'failed');
          if (fs.existsSync(L.outFile)) {
            // refused: keep the earlier good file, but say it is stale
            row.keptPrevious = true; row.sizeBytes = fs.statSync(L.outFile).size;
            try { row.got = readFrameCount(L.outFile); } catch {}
            try { Object.assign(row, summarizeReport(JSON.parse(fs.readFileSync(L.reportFile, 'utf8')))); } catch {}
          }
        }
      } finally {
        // saved sessions: one refresh token per user, so one-shot steps must not reuse a stale file
        for (const id of asList(step.deleteState)) {
          const real = id === 'phone' ? (batch.phone || '') : id;
          if (real) fs.rmSync(path.join(toolDir, `state-${real}.json`), { force: true });
        }
        row.seconds = Math.round((now() - stepStart) / 1000);
        const tag = row.status === 'ok' ? `ok ${row.got}/${row.expected}` : row.status;
        log(`  -> ${tag}${row.errors.length ? ' | ' + row.errors[0] : ''} (${row.seconds}s)`);
        writeSummary();
      }
    }
  } finally {
    log('== finally');
    summary.finally = await runCmds(manifest.finally, 'finally');
    summary.finallyOk = summary.finally.every((r) => r.code === 0);
    summary.finishedAt = new Date(now()).toISOString();
    writeSummary();
  }
  const mine = selected.map((s) => results.get(stepName(s.batch))).filter(Boolean);
  const failed = mine.filter((r) => r.status === 'failed' || r.errors.some((e) => /^after command failed/.test(e)));
  summary.failedSteps = failed.map((r) => r.batch);
  summary.brokenScreens = mine.reduce((n, r) => n + r.broken.length, 0);
  summary.ok = summary.preflightOk && summary.finallyOk && !failed.length && !ctl.stop;
  summary.finishedAt = new Date(now()).toISOString();
  writeSummary();
  return summary;
}

// ---------- SUMMARY.md ----------
const fmtSize = (b) => (b == null ? '-' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
export function renderSummaryMd(s) {
  const L = [];
  const rows = s.steps || [];
  L.push(`# Export summary: ${s.dir}`, '');
  L.push(`Started ${s.startedAt}, elapsed ${Math.floor(s.elapsedSeconds / 60)} min ${s.elapsedSeconds % 60} s. Preflight ${s.preflightOk ? 'ok' : 'FAILED'}, finally ${s.finishedAt ? (s.finallyOk ? 'ok' : 'FAILED') : 'pending'}.`, '');
  L.push('| Batch | Status | Screens (got/expected) | Size | F0 avg | F0 min | Broken | Warn | Seconds |', '|---|---|---|---|---|---|---|---|---|');
  let got = 0; let exp = 0;
  for (const r of rows) {
    const status = r.status + (r.keptPrevious ? ' (previous output kept)' : '') + (r.carried ? ' (earlier run)' : '');
    if (r.expected != null) { exp += r.expected; got += r.got || 0; }
    L.push(`| ${r.batch} | ${status} | ${r.got ?? '-'}/${r.expected ?? '-'} | ${fmtSize(r.sizeBytes)} | ${r.f0Avg ?? '-'} | ${r.f0Min ?? '-'} | ${(r.broken || []).length} | ${(r.warned || []).length} | ${r.seconds ?? '-'} |`);
  }
  L.push('', `Total screens ${got}/${exp}.`, '');
  const failed = rows.filter((r) => r.status === 'failed' || (r.errors || []).length);
  if (failed.length) { L.push('## Failed steps and errors', ''); for (const r of failed) { L.push(`- ${r.batch}: ${r.errors.join('; ')}`); for (const a of r.attempts || []) if (a.error) L.push(`  - attempt ${a.n}: ${a.error}`); } L.push(''); }
  const low = rows.filter((r) => (r.lowF0 || []).length);
  if (low.length) { L.push(`## Screens below ${F0_THRESHOLD}% F0`, ''); for (const r of low) for (const x of r.lowF0) L.push(`- ${r.batch}: ${x.name} (${x.F0}%)`); L.push(''); }
  const flagged = rows.filter((r) => (r.broken || []).length || (r.warned || []).length);
  if (flagged.length) {
    L.push('## Flagged screens', '');
    for (const r of flagged) {
      for (const x of r.broken || []) L.push(`- BROKEN ${r.batch}: ${x.name}: ${(x.issues || []).join(' | ')}`);
      for (const x of r.warned || []) L.push(`- warn ${r.batch}: ${x.name}: ${(x.issues || []).join(' | ')}`);
    }
    L.push('');
  }
  for (const [title, list] of [['Preflight', s.preflight], ['Finally', s.finally]]) {
    const bad = (list || []).filter((c) => c.code !== 0);
    if (bad.length) { L.push(`## ${title} failures`, ''); for (const c of bad) L.push(`- exit ${c.code}: ${c.cmd.slice(0, 120)}${c.output ? ' | ' + c.output.trim().split('\n').slice(-2).join(' ').slice(0, 200) : ''}`); L.push(''); }
  }
  return L.join('\n');
}
