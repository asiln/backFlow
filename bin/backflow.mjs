#!/usr/bin/env node
// backflow: one command for the tool. Each subcommand runs the matching script from the package with the
// current folder as the work dir, so exports (out/), saved sessions (state-*.json) and backflow.config.json
// live next to your batch files, not inside node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const cwd = process.cwd();

const SCRIPTS = {
  extract: ['extract.mjs', '<batch.json> [out.json] [--only <text>] [--strict] [--report <file>]', 'Capture the screens in a batch file into <batch>.figma.json'],
  run: ['run-all.mjs', '<batches dir> [--only <text>]', 'Capture every batch in a folder, plus summary.json'],
  pipeline: ['pipeline.mjs', '<batches dir> [--dry-run] [--only <step>] [--from <step>] [--out <dir>]', 'Run _pipeline.json: setup, capture and cleanup per batch'],
  tokens: ['tokens.mjs', '--in "<glob>" [--out <dir>] [--report]', 'Harvest colours, text styles, radii and spacing into tokens.json'],
  components: ['componentize.mjs', '--in "<glob>" [--out <dir>] [--report]', 'Find repeated UI and write _library.json'],
  diff: ['diff.mjs', '<batch.json> --screen <name> [--ls]', 'Pixel-compare a real screenshot with a re-render of the JSON'],
};

function help() {
  const w = Math.max(...Object.keys(SCRIPTS).map((k) => k.length), 6);
  console.log(`backflow ${pkg.version}: your running app, drawn as built in Figma.

Usage: backflow <command> [args]

  ${'init'.padEnd(w)}  Write screens.json and backflow.config.json here to start from
${Object.entries(SCRIPTS).map(([k, [, , d]]) => `  ${k.padEnd(w)}  ${d}`).join('\n')}
  ${'plugin'.padEnd(w)}  Copy the Figma plugin to ./backflow-figma-plugin for Plugins > Development > Import

Quick start:
  npx @backflow/cli init                 # then list your screens in screens.json
  npx @backflow/cli extract screens.json # -> out/screens.figma.json
  npx @backflow/cli plugin               # import its manifest.json in Figma desktop, drop the JSON on it

Localhost only. Use test accounts; the password comes from $BACKFLOW_TEST_PASSWORD.
Docs: ${pkg.homepage || 'https://github.com/asiln/backflow'}`);
}

function writeOnce(file, body) {
  const p = path.join(cwd, file);
  if (fs.existsSync(p)) { console.log(`kept      ${file} (already exists)`); return; }
  fs.writeFileSync(p, body);
  console.log(`created   ${file}`);
}

function init() {
  writeOnce('screens.json', JSON.stringify({
    width: 390, height: 844,
    screens: [
      { name: 'App / Home / 390', path: '/' },
      { name: 'App / Long page / 390', path: '/pricing', fullPage: true },
    ],
  }, null, 2) + '\n');
  const example = path.join(pkgDir, 'backflow.config.example.json');
  writeOnce('backflow.config.json', fs.readFileSync(example, 'utf8'));
  const gi = path.join(cwd, '.gitignore');
  const want = ['out/', 'state-*.json', 'backflow.config.json'];
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const missing = want.filter((l) => !have.split(/\r?\n/).includes(l));
  if (missing.length) { fs.appendFileSync(gi, (have && !have.endsWith('\n') ? '\n' : '') + '# backflow: exports and sessions stay private\n' + missing.join('\n') + '\n'); console.log(`updated   .gitignore (+${missing.join(', ')})`); }
  console.log(`\nNext: set baseUrl in backflow.config.json, list your screens, then run
  npx @backflow/cli extract screens.json
Add "phone": "<test account id>" to screens.json for logged-in pages, with $BACKFLOW_TEST_PASSWORD set.`);
}

function plugin() {
  const dest = path.join(cwd, 'backflow-figma-plugin');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['manifest.json', 'code.js', 'ui.html']) fs.copyFileSync(path.join(pkgDir, 'plugin-lift', f), path.join(dest, f));
  console.log(`Copied the Backflow plugin to ${dest}
In Figma desktop: Plugins > Development > Import plugin from manifest... > ${path.join(dest, 'manifest.json')}
Then run Backflow and drop tokens.json, _library.json and *.figma.json anywhere on its window.`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); process.exit(cmd ? 0 : 2); }
if (cmd === '--version' || cmd === '-v') { console.log(pkg.version); process.exit(0); }
if (cmd === 'init') { init(); process.exit(0); }
if (cmd === 'plugin') { plugin(); process.exit(0); }
const s = SCRIPTS[cmd];
if (!s) { console.error(`backflow: unknown command "${cmd}"\n`); help(); process.exit(2); }
if (args.includes('--help')) { console.log(`Usage: backflow ${cmd} ${s[1]}\n${s[2]}.`); process.exit(0); }

const child = spawn(process.execPath, [path.join(pkgDir, s[0]), ...args], { cwd, stdio: 'inherit', env: { ...process.env, BACKFLOW_WORKDIR: cwd } });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 130 : 1)));
