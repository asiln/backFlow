// The merged "Backflow" plugin: plugin-lift/code.js must match its sources, open one window,
// register all three engines and route messages by { mod } / { host }. A stub, not Figma.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildLift } from '../scripts/build-lift.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(root, 'plugin-lift/code.js'), 'utf8');

test('plugin-lift/code.js is up to date with its sources', () => {
  assert.equal(code.replace(/\r\n/g, '\n'), buildLift().replace(/\r\n/g, '\n'), 'run: node scripts/build-lift.mjs');
});

function stubFigma() {
  const sent = [], shows = [];
  const tagged = (key) => ({ getSharedPluginData: (ns, k) => (k === 'tokenKey' ? key : '') });
  const page = { name: 'Screens', type: 'PAGE', children: [{ type: 'SECTION' }], findAllWithCriteria: () => [{ type: 'COMPONENT', name: 'Button', getSharedPluginData: () => 'component' }, { type: 'COMPONENT_SET', name: 'Tab', getSharedPluginData: () => 'set' }] };
  const figma = {
    root: { name: 'Demo file', children: [page] }, currentPage: page,
    showUI: (html, opts) => shows.push(opts),
    ui: { postMessage: (m) => sent.push(m), onmessage: null, resize: () => {} },
    clientStorage: { getAsync: async () => ({}), setAsync: async () => {} },
    notify: () => {},
    listAvailableFontsAsync: async () => ['Inter', 'Space Grotesk', 'JetBrains Mono'].map((family) => ({ fontName: { family, style: 'Regular' } })),
    loadAllPagesAsync: async () => {},
    variables: { getLocalVariablesAsync: async () => [tagged('c:1'), tagged(''), tagged('r:8')], getLocalVariableCollectionsAsync: async () => [{}] },
    getLocalTextStylesAsync: async () => [tagged('t:Inter/14')], getLocalPaintStylesAsync: async () => [], getLocalEffectStylesAsync: async () => [],
  };
  return { figma, sent, shows };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('one window, three engines, host probe', async () => {
  const { figma, sent, shows } = stubFigma();
  vm.runInNewContext(code, { figma, __html__: '<html></html>', console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, Object, Array, String, Number, Error });
  assert.equal(shows.length, 1, 'showUI once');
  assert.equal(shows[0].themeColors, true);
  assert.equal(typeof figma.ui.onmessage, 'function');
  await tick();
  assert.ok(sent.some((m) => m.host === 'hello'), 'hello sent');
  await figma.ui.onmessage({ host: 'probe' });
  const p = sent.find((m) => m.host === 'probe');
  assert.ok(p, 'probe answered');
  assert.equal(p.result.file, 'Demo file');
  assert.deepEqual(JSON.parse(JSON.stringify(p.result.fonts)), { Inter: true, Vazirmatn: false, 'Space Grotesk': true, 'JetBrains Mono': true });
  assert.equal(p.result.tokens.tagged, 2);
  assert.equal(p.result.tokens.stylesTagged, 1);
  assert.equal(p.result.components.masters, 1);
  assert.equal(p.result.components.sets, 1);
  // engines answer through { mod, m }
  await figma.ui.onmessage({ mod: 'components', m: { type: 'run', mode: 'dry', library: '{"nope":1}' } });
  const c = sent.filter((m) => m.mod === 'components').map((m) => m.m);
  assert.ok(c.some((m) => m.log && /Not a _library\.json/.test(m.log)), 'components engine reached');
  assert.ok(c.some((m) => m.finished), 'components finished');
  await figma.ui.onmessage({ mod: 'tokens', m: { type: 'run', action: 'dry', tokens: null } });
  assert.ok(sent.some((m) => m.mod === 'tokens' && m.m.result && /No tokens\.json/.test(m.m.result.error || '')), 'tokens engine reached');
  await figma.ui.onmessage({ mod: 'import', m: { type: 'cancel' } }); // no throw
  await figma.ui.onmessage({ mod: 'unknown', m: {} }); // ignored
});
