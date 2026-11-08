// node --test: pipeline manifest logic with a fake extractor and a fake shell (no browser, no processes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateManifest, selectSteps, summarizeReport, runPipeline, renderSummaryMd } from '../pipeline-lib.mjs';

function setup(batches) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
  const batchDir = path.join(root, 'batches', 'group');
  const toolDir = path.join(root, 'tool');
  fs.mkdirSync(batchDir, { recursive: true }); fs.mkdirSync(toolDir, { recursive: true });
  for (const [name, n, phone] of batches) fs.writeFileSync(path.join(batchDir, name + '.json'), JSON.stringify({ phone, screens: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, path: '/' })) }));
  return { root, batchDir, toolDir, outRoot: path.join(root, 'final') };
}
const rep = (n, f0 = 100, extra = {}) => Array.from({ length: n }, (_, i) => ({ name: `s${i}`, warnings: [`info: layout F0 ${f0}%`], broken: false, layout: { F0: f0 }, ...extra }));
// fake extractor: writes `frames` frames, returns a report; behaviours come from a queue per batch
function fakeExtractor(plan, calls) {
  return async ({ batchFile, outFile }) => {
    const name = path.basename(batchFile, '.json');
    calls.push(name);
    const next = (plan[name] || []).shift() || { frames: 'all' };
    if (next.throw) throw new Error(next.throw);
    const total = JSON.parse(fs.readFileSync(batchFile, 'utf8')).screens.length;
    const frames = next.frames === undefined || next.frames === 'all' ? total : next.frames;
    fs.writeFileSync(outFile, JSON.stringify({ figmaLift: 1, frames: Array.from({ length: frames }, () => ({})) }));
    return { report: next.report || rep(frames, next.f0 ?? 100) };
  };
}
function fakeExec(log, failOn = []) {
  return async (cmd) => { log.push(cmd); return failOn.some((f) => cmd.includes(f)) ? { code: 1, output: 'boom' } : { code: 0, output: '' }; };
}
const base = (s) => ({ batchDir: s.batchDir, toolDir: s.toolDir, outRoot: s.outRoot });

test('validateManifest accepts a good manifest and names every problem', () => {
  assert.deepEqual(validateManifest({ steps: [{ batch: 'a.json' }] }), []);
  const bad = validateManifest({ preflight: 'x', steps: [{ batch: 'a.json', retries: -1 }, { batch: 'a.json' }, { batch: 'b.txt' }] });
  assert.ok(bad.some((e) => e.includes('preflight')));
  assert.ok(bad.some((e) => e.includes('retries')));
  assert.ok(bad.some((e) => e.includes('duplicate')));
  assert.ok(bad.some((e) => e.includes('.json')));
  assert.ok(validateManifest({ steps: [] }).length);
});

test('selectSteps: --from is inclusive, --only prefers an exact name, errors on no match', () => {
  const steps = ['a-one', 'a-one-b', 'c'].map((n) => ({ batch: n + '.json' }));
  assert.deepEqual(selectSteps(steps, { from: 'a-one-b' }).map((s) => s.batch), ['a-one-b.json', 'c.json']);
  assert.deepEqual(selectSteps(steps, { only: 'a-one' }).map((s) => s.batch), ['a-one.json']);
  assert.deepEqual(selectSteps(steps, { only: 'a-' }).map((s) => s.batch), ['a-one.json', 'a-one-b.json']);
  assert.deepEqual(selectSteps(steps, { from: 'a-one-b', only: 'c' }).map((s) => s.batch), ['c.json']);
  assert.throws(() => selectSteps(steps, { only: 'zzz' }), /no step matches/);
});

test('summarizeReport: F0 average and minimum, ignores info lines, lists broken and low screens', () => {
  const r = summarizeReport([
    { name: 'a', warnings: ['info: x'], broken: false, layout: { F0: 100 } },
    { name: 'b', warnings: ['ERROR: 404 page', 'info: y'], broken: true, layout: { F0: 80 } },
    { name: 'c', warnings: ['warn: spinner'], broken: false, layout: { F0: 96 } },
  ]);
  assert.equal(r.f0Avg, 92); assert.equal(r.f0Min, 80); assert.equal(r.f0MinScreen, 'b');
  assert.deepEqual(r.lowF0, [{ name: 'b', F0: 80 }]);
  assert.deepEqual(r.broken, [{ name: 'b', issues: ['ERROR: 404 page'] }]);
  assert.equal(r.warned.length, 1);
});

test('runs hooks in order around the extraction, writes output, report, summary and SUMMARY.md', async () => {
  const s = setup([['one', 3, '0990'], ['two', 2, null]]);
  const shell = []; const calls = [];
  const manifest = { preflight: ['pf1', 'pf2'], steps: [{ batch: 'one.json', before: ['b1'], after: ['a1'] }, { batch: 'two.json' }], finally: ['fin'] };
  const sum = await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, calls), exec: fakeExec(shell) });
  assert.deepEqual(shell, ['pf1', 'pf2', 'b1', 'a1', 'fin']);
  assert.deepEqual(calls, ['one', 'two']);
  assert.ok(sum.ok); assert.equal(sum.steps[0].got, 3); assert.equal(sum.steps[0].f0Avg, 100);
  const dir = path.join(s.outRoot, 'group');
  for (const f of ['one.figma.json', 'two.figma.json', 'reports/one.report.json', 'summary.json', 'SUMMARY.md']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(!fs.readdirSync(dir).some((f) => f.startsWith('.tmp-')));
  assert.match(fs.readFileSync(path.join(dir, 'SUMMARY.md'), 'utf8'), /\| one \| ok \| 3\/3 \|/);
});

test('output goes to a folder named after the batch file directory', async () => {
  const s = setup([['one', 1, null]]);
  const other = path.join(s.root, 'batches', 'other'); fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'x.json'), JSON.stringify({ screens: [{ name: 'a', path: '/' }] }));
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json' }, { batch: '../other/x.json' }] }, extract: fakeExtractor({}, []), exec: fakeExec([]) });
  assert.ok(fs.existsSync(path.join(s.outRoot, 'other', 'x.figma.json')));
  assert.ok(fs.existsSync(path.join(s.outRoot, 'group', 'summary.json')));
  assert.equal(sum.steps[1].outDir, 'other');
});

test('a failing step is recorded, the run continues, finally still runs', async () => {
  const s = setup([['one', 2, null], ['two', 2, null]]);
  const shell = []; const calls = [];
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json' }, { batch: 'two.json' }], finally: ['restore'] }, extract: fakeExtractor({ one: [{ throw: 'page died' }] }, calls), exec: fakeExec(shell) });
  assert.deepEqual(calls, ['one', 'two']);
  assert.equal(sum.steps[0].status, 'failed'); assert.match(sum.steps[0].errors[0], /page died/);
  assert.equal(sum.steps[1].status, 'ok');
  assert.deepEqual(sum.failedSteps, ['one']); assert.equal(sum.ok, false);
  assert.deepEqual(shell, ['restore']);
});

test('retries the whole step (before, extract, after) when the context was destroyed', async () => {
  const s = setup([['one', 3, null]]);
  const shell = []; const calls = [];
  const plan = { one: [{ frames: 2, report: [...rep(2), { name: 's2', warnings: ['ERROR: capture failed: Execution context was destroyed'], broken: true }] }, { frames: 'all' }] };
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json', before: ['b'], after: ['a'], retries: 1 }] }, extract: fakeExtractor(plan, calls), exec: fakeExec(shell) });
  assert.equal(sum.steps[0].status, 'ok'); assert.equal(sum.steps[0].attempts.length, 2);
  assert.equal(sum.steps[0].attempts[0].contextDestroyed, true);
  assert.deepEqual(shell, ['b', 'a', 'b', 'a']);
  assert.deepEqual(calls, ['one', 'one']);
});

test('no retries left: the step fails', async () => {
  const s = setup([['one', 3, null]]);
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json', retries: 1 }] }, extract: fakeExtractor({ one: [{ frames: 1 }, { frames: 2 }] }, []), exec: fakeExec([]) });
  assert.equal(sum.steps[0].status, 'failed'); assert.equal(sum.steps[0].attempts.length, 2);
});

test('refuses output with fewer frames than screens and keeps the previous good output', async () => {
  const s = setup([['one', 3, null]]);
  const manifest = { steps: [{ batch: 'one.json' }] };
  await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, []), exec: fakeExec([]) });
  const out = path.join(s.outRoot, 'group', 'one.figma.json');
  const good = fs.readFileSync(out, 'utf8');
  const sum = await runPipeline({ ...base(s), manifest, extract: fakeExtractor({ one: [{ frames: 2 }] }, []), exec: fakeExec([]) });
  assert.equal(sum.steps[0].status, 'failed'); assert.equal(sum.steps[0].keptPrevious, true);
  assert.match(sum.steps[0].errors[0], /only 2 of 3/);
  assert.equal(fs.readFileSync(out, 'utf8'), good);
});

test('after hooks run even when the extraction failed; a failing before hook skips the extraction', async () => {
  const s = setup([['one', 1, null], ['two', 1, null]]);
  const shell = []; const calls = [];
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json', before: ['setup'], after: ['restore'] }, { batch: 'two.json', before: ['bad-hook'], after: ['restore2'] }] }, extract: fakeExtractor({ one: [{ throw: 'x' }] }, calls), exec: fakeExec(shell, ['bad-hook']) });
  assert.deepEqual(shell, ['setup', 'restore', 'bad-hook', 'restore2']);
  assert.deepEqual(calls, ['one']);
  assert.equal(sum.steps[1].status, 'failed'); assert.match(sum.steps[1].errors[0], /before command failed/);
});

test('a failing after hook is reported as a problem even if the output is good', async () => {
  const s = setup([['one', 1, null]]);
  const sum = await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json', after: ['undo'] }] }, extract: fakeExtractor({}, []), exec: fakeExec([], ['undo']) });
  assert.equal(sum.steps[0].status, 'ok'); assert.match(sum.steps[0].errors[0], /after command failed/);
  assert.equal(sum.ok, false);
});

test('deleteState removes the batch phone (and literal ids) after the step, also when it failed', async () => {
  const s = setup([['one', 1, '0990']]);
  const a = path.join(s.toolDir, 'state-0990.json'); const b = path.join(s.toolDir, 'state-extra.json'); const keep = path.join(s.toolDir, 'state-keep.json');
  for (const f of [a, b, keep]) fs.writeFileSync(f, '{}');
  await runPipeline({ ...base(s), manifest: { steps: [{ batch: 'one.json', deleteState: ['phone', 'extra'] }] }, extract: fakeExtractor({ one: [{ throw: 'x' }] }, []), exec: fakeExec([]) });
  assert.ok(!fs.existsSync(a)); assert.ok(!fs.existsSync(b)); assert.ok(fs.existsSync(keep));
});

test('onlyIfMissing skips a complete output and re-runs an incomplete one', async () => {
  const s = setup([['one', 2, null]]);
  const manifest = { steps: [{ batch: 'one.json', onlyIfMissing: true }] };
  const calls = [];
  await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, calls), exec: fakeExec([]) });
  const sum = await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, calls), exec: fakeExec([]) });
  assert.equal(sum.steps[0].status, 'skipped-existing'); assert.equal(calls.length, 1); assert.equal(sum.steps[0].f0Avg, 100);
  fs.writeFileSync(path.join(s.outRoot, 'group', 'one.figma.json'), JSON.stringify({ frames: [{}] }));
  await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, calls), exec: fakeExec([]) });
  assert.equal(calls.length, 2);
});

test('preflight failure runs no step but still runs finally', async () => {
  const s = setup([['one', 1, null]]);
  const shell = []; const calls = [];
  const sum = await runPipeline({ ...base(s), manifest: { preflight: ['check'], steps: [{ batch: 'one.json', before: ['b'] }], finally: ['fin'] }, extract: fakeExtractor({}, calls), exec: fakeExec(shell, ['check']) });
  assert.equal(sum.preflightOk, false); assert.deepEqual(calls, []); assert.deepEqual(shell, ['check', 'fin']); assert.equal(sum.ok, false);
});

test('--only keeps the other rows from the previous summary; --from runs the tail', async () => {
  const s = setup([['one', 1, null], ['two', 1, null], ['three', 1, null]]);
  const manifest = { steps: ['one', 'two', 'three'].map((n) => ({ batch: n + '.json' })) };
  const calls = [];
  await runPipeline({ ...base(s), manifest, extract: fakeExtractor({}, calls), exec: fakeExec([]) });
  calls.length = 0;
  const sum = await runPipeline({ ...base(s), manifest, only: 'two', extract: fakeExtractor({ two: [{ f0: 50 }] }, calls), exec: fakeExec([]) });
  assert.deepEqual(calls, ['two']);
  assert.equal(sum.steps.length, 3); assert.equal(sum.steps[0].carried, true); assert.equal(sum.steps[1].f0Avg, 50);
  calls.length = 0;
  await runPipeline({ ...base(s), manifest, from: 'two', extract: fakeExtractor({}, calls), exec: fakeExec([]) });
  assert.deepEqual(calls, ['two', 'three']);
});

test('dry run executes nothing and writes nothing, and flags a missing batch file', async () => {
  const s = setup([['one', 4, '0990']]);
  const shell = []; const calls = [];
  const plan = await runPipeline({ ...base(s), dryRun: true, manifest: { preflight: ['pf'], steps: [{ batch: 'one.json', before: ['b'] }, { batch: 'gone.json' }], finally: ['fin'] }, extract: fakeExtractor({}, calls), exec: fakeExec(shell) });
  assert.deepEqual(shell, []); assert.deepEqual(calls, []);
  assert.equal(plan.steps[0].screens, 4); assert.equal(plan.problems.length, 1);
  assert.ok(!fs.existsSync(s.outRoot));
});

test('renderSummaryMd lists failures, low F0 and flagged screens', () => {
  const md = renderSummaryMd({ dir: 'g', startedAt: 't', elapsedSeconds: 125, preflightOk: true, finallyOk: true, finishedAt: 'x', preflight: [], finally: [],
    steps: [{ batch: 'a', status: 'failed', expected: 3, got: 0, errors: ['only 0 of 3'], attempts: [{ n: 1, error: 'only 0 of 3' }], lowF0: [], broken: [], warned: [] },
      { batch: 'b', status: 'ok', expected: 2, got: 2, sizeBytes: 2048, f0Avg: 88, f0Min: 70, lowF0: [{ name: 's1', F0: 70 }], broken: [{ name: 's0', issues: ['ERROR: x'] }], warned: [], errors: [] }] });
  assert.match(md, /Failed steps/); assert.match(md, /below 90% F0/); assert.match(md, /BROKEN b: s0/); assert.match(md, /2 min 5 s/);
});
