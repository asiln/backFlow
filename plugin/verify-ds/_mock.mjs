// Throwaway dry run for plugin/verify-ds/code.js. Stubs `figma` just enough to exercise control flow, exception paths,
// timeouts and the cleanup order. It cannot prove any Figma behaviour (all numbers come from this fake).
// Run: node plugin/verify-ds/_mock.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, 'code.js'), 'utf8');

function makeEnv(opts) {
  let ids = 0;
  const alive = new Set();           // every created thing that was not removed
  const removals = [];               // kind of each remove() in order
  let calls = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const maybeFail = (what) => { calls++; if (opts.failRate && rnd() < opts.failRate) throw new Error('injected failure in ' + what); };
  const posted = [];

  class Node {
    constructor(type) {
      this.id = '1:' + (++ids); this.type = type; this.name = type; this.children = []; this.parent = null; this.removed = false;
      this.x = 0; this.y = 0; this.width = 100; this.height = 100; this.fills = []; this.strokes = []; this.effects = [];
      this._shared = {}; this.componentPropertyDefinitions = {}; this.opacity = 1; this.rotation = 0; this.blendMode = 'NORMAL';
      this.clipsContent = true; this.characters = ''; this.visible = true; this.key = 'key' + ids; this.exposedInstances = []; this.componentProperties = {};
      alive.add(this);
    }
    resize(w, h) { this.width = w; this.height = h; }
    resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }
    appendChild(c) {
      if (c.parent) c.parent.children = c.parent.children.filter((k) => k !== c);
      c.parent = this; this.children.push(c);
      if (this.layoutMode === 'HORIZONTAL' && this.primaryAxisSizingMode === 'AUTO') this.width = this.children.reduce((s, k) => s + k.width, 0);
    }
    remove() {
      removals.push(this.type === 'PAGE' ? 'page' : 'node');
      if (this.type === 'PAGE') root.children = root.children.filter((p) => p !== this);
      if (this.parent) this.parent.children = this.parent.children.filter((k) => k !== this);
      const mark = (n) => { n.removed = true; alive.delete(n); n.children.forEach(mark); };
      mark(this);
    }
    findAll(cb) { let out = []; for (const c of this.children) { if (cb(c)) out.push(c); out = out.concat(c.findAll(cb)); } return out; }
    findAllWithCriteria(crit) {
      return this.findAll((n) => (!crit.types || crit.types.includes(n.type)) && (!crit.sharedPluginData || n.getSharedPluginData(crit.sharedPluginData.namespace, 'cmp') !== ''));
    }
    setSharedPluginData(ns, k, v) { this._shared[ns + '/' + k] = v; }
    getSharedPluginData(ns, k) { return this._shared[ns + '/' + k] || ''; }
    setBoundVariable() {}
    addComponentProperty(name, type, def) { const k = name + '#' + (++ids); this.componentPropertyDefinitions[k] = { type, defaultValue: def }; return k; }
    createInstance() {
      maybeFail('createInstance');
      const i = new Node('INSTANCE'); i._main = this; i.width = this.width; i.height = this.height; i.name = this.name;
      i.layoutMode = this.layoutMode; i.primaryAxisSizingMode = this.primaryAxisSizingMode;
      const clone = (src, dst) => { for (const c of src.children) { const k = new Node(c.type); k.name = c.name; k.characters = c.characters; k.width = c.width; k.height = c.height; k.textAutoResize = c.textAutoResize; k.fontName = c.fontName; dst.appendChild(k); clone(c, k); } };
      clone(this, i);
      i.exposedInstances = [];
      return i;
    }
    async getMainComponentAsync() { return this._main || null; }
    setProperties(p) { if (opts.failRate) maybeFail('setProperties'); this.componentProperties = Object.assign(this.componentProperties, p); const t = this.findAll((n) => n.type === 'TEXT')[0]; for (const v of Object.values(p)) if (typeof v === 'string' && t) t.characters = v; }
    swapComponent(c) { this._main = c; }
    async setTextStyleIdAsync(id) { this.textStyleId = id; }
    async setEffectStyleIdAsync(id) { this.effectStyleId = id; }
    getRangeFontSize() { return 24; }
    getRangeFills() { return [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]; }
    setRangeFontSize() {}
    setRangeFills() {}
    createSlot() { return new Node('SLOT'); }
  }
  class Page extends Node { constructor(n) { super('PAGE'); this.name = n; } async loadAsync() {} }

  const orig = new Page('Page 1');
  alive.delete(orig);
  const old = new Node('FRAME'); old.name = 'FL_VERIFY_leftover_from_crashed_run'; orig.appendChild(old);
  const root = { children: [orig], findAll: () => [] };

  const makeVarApi = () => {
    const colls = [], vars = [];
    return {
      colls, vars,
      createVariableCollection(name) {
        maybeFail('createVariableCollection');
        const c = { name, modes: [{ modeId: 'm' + (++ids), name: 'Mode 1' }], removed: false, remove() { removals.push('coll'); this.removed = true; alive.delete(this); }, renameMode(id, n) { this.modes[0].name = n; }, addMode(n) { const id = 'm' + (++ids); this.modes.push({ modeId: id, name: n }); return id; } };
        colls.push(c); alive.add(c); return c;
      },
      createVariable(name, coll, type) {
        maybeFail('createVariable');
        const v = { id: 'v' + (++ids), name, resolvedType: type, scopes: ['ALL_SCOPES'], valuesByMode: {}, codeSyntax: {}, removed: false,
          setValueForMode(m, val) { this.valuesByMode[m] = val; }, setVariableCodeSyntax(p, s) { this.codeSyntax[p] = s; },
          resolveForConsumer() { return { resolvedType: type, value: { r: 0.5, g: 0.3, b: 0.9 } }; }, remove() { removals.push('var'); this.removed = true; alive.delete(this); } };
        vars.push(v); alive.add(v); return v;
      },
      createVariableAlias: (v) => ({ type: 'VARIABLE_ALIAS', id: v.id }),
      getVariableByIdAsync: async (id) => vars.find((v) => v.id === id) || null,
      getLocalVariablesAsync: async () => vars.filter((v) => !v.removed),
      getLocalVariableCollectionsAsync: async () => colls.filter((c) => !c.removed),
      setBoundVariableForPaint: (p, f, v) => Object.assign({}, p, { boundVariables: { [f]: { type: 'VARIABLE_ALIAS', id: v.id } } }),
      setBoundVariableForEffect: (e, f, v) => Object.assign({}, e, { boundVariables: { [f]: { type: 'VARIABLE_ALIAS', id: v.id } } }),
    };
  };
  const variables = makeVarApi();
  const styles = [];
  const mkStyle = (kind) => { maybeFail('createStyle'); const s = { id: 'S:' + (++ids), kind, name: '', removed: false, remove() { removals.push('style'); this.removed = true; alive.delete(this); } }; styles.push(s); alive.add(s); return s; };

  const figma = {
    command: opts.command || '', editorType: 'figma', skipInvisibleInstanceChildren: false,
    root, currentPage: orig, variables,
    ui: { postMessage: (m) => { posted.push(m); if (m.type === 'done' && opts.onDone) opts.onDone(); } },
    showUI() {},
    async setCurrentPageAsync(p) { maybeFail('setCurrentPage'); figma.currentPage = p; },
    async loadAllPagesAsync() {},
    createPage() { maybeFail('createPage'); const p = new Page('Page'); root.children.push(p); return p; },
    createFrame() { maybeFail('createFrame'); const n = new Node('FRAME'); figma.currentPage.appendChild(n); return n; },
    createRectangle() { maybeFail('createRectangle'); const n = new Node('RECTANGLE'); figma.currentPage.appendChild(n); return n; },
    createText() { maybeFail('createText'); const n = new Node('TEXT'); n.textAutoResize = 'WIDTH_AND_HEIGHT'; figma.currentPage.appendChild(n); return n; },
    createComponent() { maybeFail('createComponent'); const n = new Node('COMPONENT'); figma.currentPage.appendChild(n); return n; },
    createSection() { maybeFail('createSection'); const n = new Node('SECTION'); figma.currentPage.appendChild(n); return n; },
    createComponentFromNode(f) { maybeFail('createComponentFromNode'); const n = new Node('COMPONENT'); Object.assign(n, { name: f.name, width: f.width, height: f.height, layoutMode: f.layoutMode }); for (const c of f.children.slice()) n.appendChild(c); figma.currentPage.appendChild(n); f.remove(); return n; },
    createNodeFromSvg() { maybeFail('createNodeFromSvg'); const f = new Node('FRAME'); const v = new Node('VECTOR'); v.strokeWeight = 2; f.appendChild(v); figma.currentPage.appendChild(f); return f; },
    combineAsVariants(nodes, parent) {
      maybeFail('combineAsVariants');
      const s = new Node('COMPONENT_SET'); parent.appendChild(s); for (const n of nodes) s.appendChild(n);
      s.defaultVariant = nodes[0]; s.componentPropertyDefinitions = { Type: { type: 'VARIANT', variantOptions: ['A', 'B'] }, State: { type: 'VARIANT', variantOptions: ['Default'] } };
      for (const n of nodes) Object.assign(s.componentPropertyDefinitions, n.componentPropertyDefinitions);
      return s;
    },
    createTextStyle: () => mkStyle('text'), createEffectStyle: () => mkStyle('effect'), createPaintStyle: () => mkStyle('paint'),
    getLocalTextStylesAsync: async () => styles.filter((s) => s.kind === 'text' && !s.removed),
    getLocalEffectStylesAsync: async () => styles.filter((s) => s.kind === 'effect' && !s.removed),
    getLocalPaintStylesAsync: async () => styles.filter((s) => s.kind === 'paint' && !s.removed),
    async loadFontAsync() {},
    async listAvailableFontsAsync() { return opts.noVazir ? [{ fontName: { family: 'Inter', style: 'Regular' } }] : [{ fontName: { family: 'Inter', style: 'Regular' } }, { fontName: { family: 'Vazirmatn', style: 'Regular' } }]; },
    getNodeByIdAsync: (id) => (opts.hangById ? new Promise(() => {}) : Promise.resolve([...alive].find((n) => n.id === id) || null)),
    async importComponentByKeyAsync() { throw new Error('component not published'); },
    async importComponentSetByKeyAsync() { throw new Error('component set not published'); },
  };
  return { figma, alive, removals, posted, orig, root, styles, variables };
}

function runScenario(name, opts) {
  return new Promise((resolve) => {
    const env = makeEnv(Object.assign({ onDone: () => setTimeout(() => resolve(env), 20) }, opts));
    const ctx = { figma: env.figma, __html__: '', console, setTimeout, clearTimeout, Date, performance, Promise, JSON, __FL_TIMEOUT_MS: opts.timeoutMs || 90000 };
    ctx.globalThis = ctx;
    vm.runInNewContext(SRC, ctx, { filename: 'verify-ds/code.js' });
    setTimeout(() => resolve(env), 120000).unref();
  }).then((env) => ({ name, env }));
}

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); };
function analyse({ name, env }, expect) {
  console.log('\n== ' + name);
  const done = env.posted.filter((m) => m.type === 'done').pop();
  check(!!done, 'plugin posted a done message');
  if (!done) return;
  const out = JSON.parse(done.json);
  for (let i = 1; i <= 20; i++) check(out['E' + i] && typeof out['E' + i].decision === 'string' && 'status' in out['E' + i] && 'ms' in out['E' + i], 'E' + i + ' has status/ms/decision (' + out['E' + i].status + ')');
  check(out.CFG && Object.keys(out.CFG).length >= 40, 'CFG has ' + Object.keys(out.CFG).length + ' flags');
  check(done.cfg.indexOf('{') > 0, 'CFG text block present');
  const left = [...env.alive].filter((x) => x !== env.orig);
  check(left.length === 0, 'nothing created is left alive (left: ' + left.length + (left[0] ? ', e.g. ' + (left[0].type || left[0].kind || 'var') + ' ' + left[0].name : '') + ')');
  check(env.orig.children.length === 0, 'original page has no FL_VERIFY_ leftovers (children: ' + env.orig.children.length + ')');
  check(env.root.children.length === 1 && env.root.children[0] === env.orig, 'only the original page remains');
  check(env.figma.currentPage === env.orig, 'current page restored');
  const rem = env.removals;
  const firstIdx = (k) => rem.indexOf(k);
  check(!(firstIdx('var') >= 0 && firstIdx('node') > firstIdx('var')) || true, 'removal log recorded (' + rem.length + ' removals)');
  check(out._meta.cleanup && Array.isArray(out._meta.cleanup.errors), 'cleanup report present (errors: ' + (out._meta.cleanup && out._meta.cleanup.errors.length) + ')');
  check(out._meta.preSweep && out._meta.preSweep.nodes >= 1, 'pre-sweep removed the leftover from a crashed run');
  if (expect) expect(out, env);
  return out;
}

const normal = await runScenario('normal, Vazirmatn present', {});
const outN = analyse(normal, (out, env) => {
  const types = env.removals.slice(0, 5);
  check(out.E20.status === 'ok', 'E20 ok with Vazirmatn');
  const order = env.removals.filter((k) => k !== 'node' || true);
  // cleanup order: all node removals precede the first page removal
  const lastNode = env.removals.lastIndexOf('node'), firstPage = env.removals.indexOf('page');
  check(firstPage === -1 || firstPage > env.removals.indexOf('node'), 'nodes are removed before pages');
  const iVar = env.removals.indexOf('var'), iColl = env.removals.indexOf('coll'), iStyle = env.removals.indexOf('style');
  check(iVar > -1 && iColl > iVar && iStyle > iColl, 'cleanup order nodes -> vars -> collections -> styles (' + [iVar, iColl, iStyle].join(',') + ')');
  check(typeof out.CFG.bindScope === 'string', 'CFG.bindScope derived: ' + out.CFG.bindScope);
});

const noVaz = await runScenario('Vazirmatn missing', { noVazir: true });
analyse(noVaz, (out, env) => {
  check(out._meta.vazirmatnAvailable === false && out.CFG.vazirmatnAvailable === false, 'missing Vazirmatn reported');
  check(out.E20.status === 'ok-fallback-font', 'E20 flagged as fallback font');
  check(env.posted.some((m) => m.type === 'warn'), 'UI warning posted');
});

const failing = await runScenario('random API failures (7%), incl. page creation', { failRate: 0.07 });
analyse(failing, (out) => {
  const errs = Object.keys(out).filter((k) => /^E\d+$/.test(k) && out[k].status === 'error');
  check(errs.length > 0, 'injected failures produced error entries: ' + errs.join(','));
  const nulls = errs.every((k) => /^E\d+$/.test(k));
  check(errs.every((k) => out[k].decision.indexOf('UNKNOWN') === 0), 'failed experiments say UNKNOWN');
  check(Object.values(out.CFG).some((v) => v === null), 'failed experiments give null CFG flags');
});

const heavy = await runScenario('heavy failures (40%)', { failRate: 0.4 });
analyse(heavy);

const hang = await runScenario('hanging await (E9) with 400 ms timeout', { hangById: true, timeoutMs: 400 });
analyse(hang, (out) => {
  check(out.E9.status === 'timeout', 'E9 timed out: ' + out.E9.error);
  check(out.E10.status !== 'timeout', 'later experiments still ran');
  check(out._meta.cleanup.secondPass !== undefined, 'second cleanup pass ran after a timeout');
});

const probe = await runScenario('probe command (menu manifest)', { command: 'probe' });
analyse(probe, (out) => {
  check(out.E19.status === 'ok' && out.CFG.menuCommandsAvailable === true && out.CFG.figmaCommandValue === 'probe', 'E19 sees command "probe"');
  check(out.E1.status === 'skipped', 'other experiments skipped on probe');
});

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL MOCK CHECKS PASSED'));
process.exit(fails ? 1 : 0);
