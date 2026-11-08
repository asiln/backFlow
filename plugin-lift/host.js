// Backflow (merged plugin): host part. scripts/build-lift.mjs wraps this file around the three
// unchanged engines (plugin/, plugin-tokens/, plugin-components/) to produce plugin-lift/code.js.
// Messages UI -> host: { mod: 'import'|'tokens'|'components', m } goes to that engine's onmessage;
// { host: 'probe'|'prefs-get'|'prefs-set'|'resize'|'notify', ... } is handled here.
// Messages host -> UI: { mod, m } from an engine, { host, ... } from here.
/* @@ENGINES@@ */

const LIFT_NS = 'figmalift';
const LIFT_FONTS = ['Inter', 'Vazirmatn', 'Space Grotesk', 'JetBrains Mono'];
const PREFS_KEY = 'backflow.prefs.v1';
const hostPost = (m) => { try { figma.ui.postMessage(m); } catch (e) { /* UI closed */ } };

// What the open file already holds, so the checklist can say what is done and what is missing.
async function probe() {
  const out = { file: figma.root.name, page: figma.currentPage.name, fonts: {}, tokens: {}, components: {}, screens: {}, errors: [] };
  const step = async (label, fn) => { try { await fn(); } catch (e) { out.errors.push(label + ': ' + (e && e.message ? e.message : e)); } };
  await step('fonts', async () => {
    const fams = new Set((await figma.listAvailableFontsAsync()).map((f) => f.fontName.family));
    for (const f of LIFT_FONTS) out.fonts[f] = fams.has(f);
  });
  await step('variables', async () => {
    const vars = await figma.variables.getLocalVariablesAsync();
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    let tagged = 0;
    for (const v of vars) if (v.getSharedPluginData(LIFT_NS, 'tokenKey')) tagged++;
    out.tokens.variables = vars.length; out.tokens.tagged = tagged; out.tokens.collections = cols.length;
  });
  await step('styles', async () => {
    const [text, paint, effect] = await Promise.all([figma.getLocalTextStylesAsync(), figma.getLocalPaintStylesAsync(), figma.getLocalEffectStylesAsync()]);
    let tagged = 0;
    for (const s of [...text, ...paint, ...effect]) if (s.getSharedPluginData(LIFT_NS, 'tokenKey')) tagged++;
    out.tokens.textStyles = text.length; out.tokens.paintStyles = paint.length; out.tokens.effectStyles = effect.length; out.tokens.stylesTagged = tagged;
  });
  await step('components', async () => {
    await figma.loadAllPagesAsync();
    let masters = 0, sets = 0, superseded = 0, icons = 0;
    for (const page of figma.root.children) {
      let found = [];
      try { found = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'], sharedPluginData: { namespace: LIFT_NS, keys: ['cmp'] } }); } catch (e) { found = []; }
      for (const n of found) {
        if (/superseded/i.test(n.name)) { superseded++; continue; }
        if (n.getSharedPluginData(LIFT_NS, 'kind') === 'icon') icons++;
        else if (n.type === 'COMPONENT_SET') sets++;
        else masters++;
      }
    }
    out.components.masters = masters; out.components.sets = sets; out.components.icons = icons; out.components.superseded = superseded;
  });
  await step('screens', async () => {
    out.screens.sections = figma.currentPage.children.filter((n) => n.type === 'SECTION').length;
  });
  return out;
}

figma.showUI(__html__, { width: 400, height: 680, themeColors: true, title: 'Backflow' });
(async () => {
  let prefs = {};
  try { prefs = (await figma.clientStorage.getAsync(PREFS_KEY)) || {}; } catch (e) { prefs = {}; }
  if (prefs.size && prefs.size.w && prefs.size.h) { try { figma.ui.resize(prefs.size.w, prefs.size.h); } catch (e) { /* ignore */ } }
  hostPost({ host: 'hello', prefs, file: figma.root.name });
})();

figma.ui.onmessage = async (env) => {
  if (!env || typeof env !== 'object') return;
  if (env.mod) { const h = LIFT_HANDLERS[env.mod]; if (h) await h(env.m); return; }
  switch (env.host) {
    case 'probe': hostPost({ host: 'probe', result: await probe() }); break;
    case 'prefs-set': try { await figma.clientStorage.setAsync(PREFS_KEY, env.prefs || {}); } catch (e) { /* ignore */ } break;
    case 'resize': {
      const w = Math.max(340, Math.min(900, Math.round(env.w || 400))), h = Math.max(420, Math.min(1200, Math.round(env.h || 680)));
      try { figma.ui.resize(w, h); } catch (e) { /* ignore */ }
      break;
    }
    case 'notify': try { figma.notify(String(env.text || '').slice(0, 140), { error: !!env.error }); } catch (e) { /* ignore */ } break;
    default: break;
  }
};
