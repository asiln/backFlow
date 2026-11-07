// usage: node extract.mjs <batch.json> [out.json] [--only <substring>] [--strict] [--report <file>]
// batch: { "phone": "test-user-id", "width": 390, "height": 844, "base": "http://localhost:3000", "fullPage": false,
//          "screens": [ { "name": "Athlete / Dashboard", "path": "/dashboard", "setup": "click('^ok$')", "delayMs": 2500,
//                         "tutorial": false, "fullPage": true, "selector": "[role=dialog]", "backdrop": true } ] }
// Local app only. Test accounts only. Credentials and app specifics come from config.mjs (figma-lift.config.json, $FIGMA_LIFT_TEST_PASSWORD).
// Never point this at production.
// Also importable: import { runBatch } from './extract.mjs'
import { normalize, summarize } from './normalize.mjs';
import { loadConfig } from './config.mjs';
import { launchBrowser } from './browser.mjs';
import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const MEASURE_JS = `(() => { let d = 0;
  for (const e of document.querySelectorAll('*')) { const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1) d = Math.max(d, e.scrollHeight - e.clientHeight); }
  const de = document.documentElement; d = Math.max(d, de.scrollHeight - innerHeight, document.body.scrollHeight - innerHeight);
  return d; })()`;
const EXPAND_JS = `(() => { let n = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (const e of document.querySelectorAll('*')) { const cs = getComputedStyle(e);
      const scroller = /(auto|scroll)/.test(cs.overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1;
      const rootHidden = (e === document.body || e === document.documentElement) && cs.overflowY !== 'visible';
      if (scroller || rootHidden) { e.style.setProperty('overflow-y', 'visible', 'important'); e.style.setProperty('height', 'auto', 'important'); e.style.setProperty('max-height', 'none', 'important'); n++; } }
  }
  return n; })()`;
const ANALYZE_JS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const t = document.body.innerText || '';
  const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const heads = q('h1,h2').map((e) => e.innerText).join(' ');
  return {
    text: t.replace(/\\s+/g, ' ').slice(0, 100), len: t.trim().length,
    qmarks: /\\?{3,}/.test(t),
    spinner: q('.animate-spin,[class*=spinner i],[role=progressbar],[aria-busy=true]').length,
    skeleton: q('[class*=skeleton i],.animate-pulse').length,
    loadingText: /در حال (بارگذاری|بارگیری)|^\\s*Loading/m.test(t),
    toasts: q('[role=alert],[data-sonner-toast],[class*=toast i]').map((e) => (e.innerText || '').trim().slice(0, 60)).filter(Boolean),
    notFound: /(^|\\s)404(\\s|$)/.test(heads) || /could not be found|صفحه.{0,20}(یافت نشد|پیدا نشد)/.test(t),
    crashed: /Application error|Something went wrong|Unhandled Runtime Error|مشکلی پیش آمد/.test(t),
  }; })()`;

function stripLf(n) { delete n.lf; for (const c of n.children || []) stripLf(c); }

export async function runBatch(batchFile, outFile, opts = {}) {
  const only = opts.only ? String(opts.only).toLowerCase() : null;
  const log = opts.log || console.log;
  const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  outFile = outFile || path.join(here, 'out', path.basename(batchFile, '.json') + '.figma.json');
  const CFG = loadConfig();
  const base = batch.base || CFG.baseUrl;
  const api = (batch.api || CFG.apiUrl) + CFG.apiPrefix;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Refusing: base must be localhost');

  const walker = fs.readFileSync(path.join(here, 'walker.js'), 'utf8');

  const browser = await launchBrowser({ headless: true });
  const frames = [];
  const report = [];
  let ctx;
  try {
    const stateFile = path.join(here, `state-${batch.phone || 'anon'}.json`);
    const mobile = batch.width < 500;
    const ctxOpts = { viewport: { width: batch.width, height: batch.height }, locale: batch.locale || CFG.locale, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile };
    if (batch.phone && fs.existsSync(stateFile)) ctxOpts.storageState = stateFile;
    ctx = await browser.newContext(ctxOpts);
    if (batch.phone && !ctxOpts.storageState) {
      if (!CFG.password) throw new Error('No test password: set FIGMA_LIFT_TEST_PASSWORD (or "password" in figma-lift.config.json)');
      const r = await ctx.request.post(`${api}${CFG.login.path}`, { data: { [CFG.login.identifierField]: batch.phone, [CFG.login.passwordField]: CFG.password } });
      if (!r.ok()) throw new Error('login failed ' + r.status());
      await ctx.storageState({ path: stateFile });
    }

    for (const s of batch.screens) {
      if (only && !String(s.name || s.path).toLowerCase().includes(only) && !path.basename(batchFile).toLowerCase().includes(only)) continue;
      const warnings = [];
      let entry = { name: s.name || s.path, finalUrl: null, size: null, nodes: 0, setup: null, text: '', warnings };
      let page;
      try {
        page = await ctx.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 120)));
        if (s.width || s.height) await page.setViewportSize({ width: s.width || batch.width, height: s.height || batch.height });
        await page.addInitScript((o) => { try { if (!window.__keepTutorial) for (const k in o) localStorage.setItem(k, o[k]); } catch {} }, CFG.localStorage);
        if (s.tutorial) await page.addInitScript((keys) => { window.__keepTutorial = true; try { for (const k of keys) localStorage.removeItem(k); } catch {} }, CFG.tutorialKeys);
        const resp = await page.goto(base + s.path, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => null);
        await page.waitForTimeout(s.delayMs ?? 2500);
        let setupOut = null;
        if (s.setup) {
          setupOut = await page.evaluate(`(async()=>{const sleep=m=>new Promise(r=>setTimeout(r,m));const click=(re)=>{const e=[...document.querySelectorAll('button,a,label,[role=button],[role=tab]')].find(b=>b.getBoundingClientRect().width>0&&new RegExp(re).test((b.innerText||b.getAttribute('aria-label')||'').trim()));if(e)e.click();return e?(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,40):null};${s.setup}})()`);
          await page.waitForTimeout(1500);
        }
        if (s.selector) await page.waitForSelector(s.selector, { state: 'visible', timeout: 5000 }).catch(() => {});
        const fullPage = s.fullPage ?? batch.fullPage ?? false;
        if (fullPage && !s.selector) {
          const delta = await page.evaluate(MEASURE_JS);
          const cur = page.viewportSize();
          const target = Math.min(20000, cur.height + Math.ceil(delta));
          if (target > cur.height) { await page.setViewportSize({ width: cur.width, height: target }); await page.waitForTimeout(700); }
          await page.evaluate(EXPAND_JS);
          await page.waitForTimeout(500);
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        await page.evaluate((o) => { window.__figmaLiftOpts = o; }, { selector: s.selector || null, backdrop: !!s.backdrop });
        const tree = await page.evaluate(walker);

        // canvases/videos: replace the (black) JS readback with a real screenshot of just that element
        const shots = [];
        (function collect(n) { if (n.shot) shots.push(n); (n.children || []).forEach(collect); })(tree);
        for (const n of shots) {
          try {
            await page.evaluate(() => { const st = document.createElement('style'); st.id = '__fl_shot_style'; st.textContent = 'html,body{background:transparent!important} *{transition:none!important;animation:none!important} body *{visibility:hidden!important}'; document.head.appendChild(st); });
            await page.waitForTimeout(60);
            await page.evaluate((id) => { const el = document.querySelector('[data-fl-shot="' + id + '"]'); el.style.setProperty('visibility', 'visible', 'important'); }, n.shot);
            const buf = await page.locator('[data-fl-shot="' + n.shot + '"]').screenshot({ omitBackground: true, timeout: 8000 });
            let data = 'data:image/png;base64,' + buf.toString('base64');
            if (buf.length > 250000) { // big opaque shader/video frame: JPEG is ~10x smaller and visually identical
              const jb = await page.locator('[data-fl-shot="' + n.shot + '"]').screenshot({ type: 'jpeg', quality: 85, timeout: 8000 });
              if (jb.length < buf.length) data = 'data:image/jpeg;base64,' + jb.toString('base64');
            }
            n.data = data;
            n.iw = Math.round(n.w); n.ih = Math.round(n.h); n.fit = 'FILL'; delete n.failed; n.viaShot = true;
          } catch (e) { n.failed = 'screenshot: ' + String(e && e.message || e).slice(0, 120); }
          finally { await page.evaluate((id) => { const st = document.getElementById('__fl_shot_style'); if (st) st.remove(); const el = document.querySelector('[data-fl-shot="' + id + '"]'); if (el) el.style.removeProperty('visibility'); }, n.shot).catch(() => {}); }
        }

        // cross-origin images the page could not read: download via Playwright, convert in page
        const fetchJobs = [];
        (function collect(n) {
          if (n.needsFetch) fetchJobs.push(n);
          for (const l of n.layers || []) if (l.needsFetch) fetchJobs.push(l);
          (n.children || []).forEach(collect);
        })(tree);
        for (const n of fetchJobs) {
          try {
            const resp2 = await ctx.request.get(n.needsFetch, { timeout: 15000 });
            if (!resp2.ok()) throw new Error('http ' + resp2.status());
            const body = await resp2.body();
            if (body.length > 15e6) throw new Error('too big');
            const mime = (resp2.headers()['content-type'] || 'image/png').split(';')[0];
            const res = await page.evaluate(([u, h]) => window.__figmaLiftConvert(u, h), [`data:${mime};base64,${body.toString('base64')}`, n.hint]);
            if (!res || res.error) throw new Error(res ? res.error : 'convert failed');
            n.data = res.data;
            if (n.k === 'img') { n.mode = /contain/.test(n.sizeCss || '') ? 'FIT' : 'FILL'; n.iw = res.w; n.ih = res.h; }
            else {
              n.iw = res.w; n.ih = res.h;
              const pl = await page.evaluate((a) => window.__figmaLiftPlace(a), { bw: n.hint.w, bh: n.hint.h, iw: res.w, ih: res.h, fit: n.fitArgs ? n.fitArgs.fit : 'cover', pos: n.fitArgs ? n.fitArgs.pos : null });
              n.fit = pl.mode; if (pl.tf) n.tf = pl.tf;
            }
            delete n.failed; delete n.needsFetch;
          } catch (e) { n.failed = String(e && e.message || e); n.fetchFailed = true; }
          delete n.hint; delete n.fitArgs; delete n.sizeCss;
        }

        // real auto-layout: infer a layout spec (ls) per node from the walker's facts; falls back to the old flatten pass
        let layoutSummary = null;
        const layoutOn = opts.layout !== false && batch.layout !== false && s.layout !== false && tree.lfs;
        if (layoutOn) {
          try {
            const lfs = tree.lfs; delete tree.lfs;
            if (process.env.KRAW) fs.writeFileSync(process.env.KRAW, JSON.stringify(tree));
            if (process.env.KRAWDIR) { fs.mkdirSync(process.env.KRAWDIR, { recursive: true }); fs.writeFileSync(path.join(process.env.KRAWDIR, String(s.name || s.path).replace(/[^\w]+/g, '_') + '.json'), JSON.stringify(tree)); }
            const t0 = Date.now();
            const res = normalize(tree, { grid: opts.grid !== false });
            layoutSummary = { ...summarize(res.stats), walker: lfs, normalizeMs: Date.now() - t0 };
            warnings.push(`info: layout F0 ${layoutSummary.F0}% F1 ${layoutSummary.F1}% F2 ${layoutSummary.F2}% F3 ${layoutSummary.F3}% of ${layoutSummary.containers} containers`);
          } catch (e) { warnings.push('warn: layout inference failed, using absolute positions: ' + String(e && e.stack || e).slice(0, 300)); layoutSummary = { failed: true }; stripLf(tree); }
        } else { delete tree.lfs; stripLf(tree); }
        // flatten invisible, meaningless wrappers: hoist children, adding offsets
        const GENERIC = /^(div|span|p|section|ul|li|a|label|form|main)$/;
        if (!(layoutSummary && !layoutSummary.failed)) (function flatten(n) {
          if (!n.children) return;
          const out = [];
          for (const c of n.children) {
            flatten(c);
            const plain = c.t === 'frame' && !c.fill && !c.grads && !c.layers && !c.blur && !c.bblur && !c.stroke && !c.radius && !c.shadow && !c.clip && c.opacity == null && !c.xf && !c.blend && !c.pos && !c.failed && c.z == null && GENERIC.test(c.name);
            if (plain && !(c.layout && c.children.length > 1)) { for (const g of c.children) { g.x = Math.round((g.x + c.x) * 100) / 100; g.y = Math.round((g.y + c.y) * 100) / 100; out.push(g); } }
            else out.push(c);
          }
          n.children = out;
        })(tree);
        tree.name = s.name || s.path;

        // stats + warnings
        const st = { nodes: 0, texts: 0, imgOk: 0, imgFail: 0, qtext: false };
        (function c(n) {
          st.nodes++;
          if (n.t === 'text') { st.texts++; if (/\?{3,}/.test(n.text)) st.qtext = true; }
          if (n.t === 'img') { if (n.data) st.imgOk++; else st.imgFail++; }
          for (const l of n.layers || []) if (l.k === 'img') { if (l.data) st.imgOk++; else st.imgFail++; }
          if (n.failed && n.t === 'frame') warnings.push('warn: ' + n.name + ' ' + n.failed);
          (n.children || []).forEach(c);
        })(tree);
        const a = await page.evaluate(ANALYZE_JS);
        const finalPath = new URL(page.url()).pathname;
        const status = resp ? resp.status() : 0;
        if (status >= 400) warnings.push(`ERROR: HTTP ${status} for ${s.path}`);
        if (!resp) warnings.push('ERROR: navigation failed or timed out');
        if (a.notFound) warnings.push('ERROR: 404 page');
        if (a.crashed) warnings.push('ERROR: app error screen');
        if (/\/(login|register|otp)\b/.test(finalPath) && !/\/(login|register|otp)\b/.test(s.path) && finalPath !== s.path) warnings.push(`ERROR: redirected to ${finalPath} (logged out?)`);
        if (a.qmarks || st.qtext || /\?{3,}/.test(String(s.name) + (s.setup || ''))) warnings.push("ERROR: '???' in text (Persian lost in encoding - pass Persian via files, not shell args)");
        if (a.skeleton >= 3) warnings.push(`ERROR: ${a.skeleton} skeleton placeholders visible (data not loaded)`);
        else if (a.skeleton) warnings.push(`warn: ${a.skeleton} skeleton element(s)`);
        if (a.spinner) warnings.push(`warn: ${a.spinner} spinner-like element(s) visible`);
        if (a.loadingText) warnings.push('warn: loading text visible');
        for (const tmsg of a.toasts) warnings.push(/خطا|ناموفق|مشکل|error|failed|unauthor/i.test(tmsg) ? `ERROR: error toast "${tmsg}"` : `warn: toast "${tmsg}"`);
        if (s.selector ? st.nodes <= 1 : (st.nodes < 8 || st.texts === 0 || a.len < 3)) warnings.push(`ERROR: empty screen (${st.nodes} nodes, ${st.texts} texts)`);
        if (st.imgFail) warnings.push(`warn: ${st.imgFail} image(s) became placeholders`);
        if (pageErrors.length) warnings.push('warn: page error: ' + pageErrors[0]);
        if (s.selector && tree.w <= 1) warnings.push('ERROR: selector matched nothing visible');

        frames.push(tree);
        if (opts.onScreen) { try { await opts.onScreen({ page, ctx, tree, screen: s, base }); } catch (e) { console.error('onScreen failed:', e && e.stack || e); } }
        entry = { name: tree.name, finalUrl: page.url(), size: `${tree.w}x${tree.h}`, nodes: st.nodes, setup: setupOut, text: a.text, images: { ok: st.imgOk, failed: st.imgFail }, layout: layoutSummary, warnings };
      } catch (e) {
        warnings.push('ERROR: capture failed: ' + String(e && e.message || e).slice(0, 200));
      } finally {
        if (page) await page.close().catch(() => {});
      }
      entry.broken = warnings.some((w) => w.startsWith('ERROR'));
      report.push(entry);
    }
    await ctx.storageState({ path: stateFile }).catch(() => {});

    // images used more than once go to a shared asset table
    const seen = new Map();
    (function c(n) {
      if (n.data) seen.set(n.data, (seen.get(n.data) || 0) + 1);
      for (const l of n.layers || []) if (l.data) seen.set(l.data, (seen.get(l.data) || 0) + 1);
      (n.children || []).forEach(c);
    })({ children: frames });
    const assets = {}; const ids = new Map();
    const intern = (o) => {
      if (!o.data || seen.get(o.data) < 2) return;
      if (!ids.has(o.data)) { const id = 'a' + ids.size; ids.set(o.data, id); assets[id] = o.data; }
      o.asset = ids.get(o.data); delete o.data;
    };
    (function c(n) { intern(n); (n.layers || []).forEach(intern); (n.children || []).forEach(c); })({ children: frames });

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const out = { figmaLift: 1, name: path.basename(batchFile, '.json'), frames };
    if (Object.keys(assets).length) out.assets = assets;
    fs.writeFileSync(outFile, JSON.stringify(out));
    log(JSON.stringify(report, null, 1));
    log('wrote ' + outFile + ' ' + (fs.statSync(outFile).size / 1024).toFixed(0) + ' KB');
    const bad = report.filter((r) => r.warnings.length);
    if (bad.length) { log('--- warnings ---'); for (const r of bad) for (const w of r.warnings) log(`${r.name}: ${w}`); }
    return { report, outFile, broken: report.some((r) => r.broken) };
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const only = flag('--only');
  const reportFile = flag('--report');
  const si = args.indexOf('--strict'); const strict = si >= 0; if (si >= 0) args.splice(si, 1);
  const noLayout = args.indexOf('--no-layout'); if (noLayout >= 0) args.splice(noLayout, 1);
  const [batchFile, outFile] = args;
  if (!batchFile) { console.error('usage: node extract.mjs <batch.json> [out.json] [--only <substring>] [--strict] [--no-layout] [--report <file>]'); process.exit(1); }
  try {
    const res = await runBatch(batchFile, outFile, { only, layout: noLayout < 0 });
    if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(res.report));
    process.exit(strict && res.broken ? 2 : 0);
  } catch (e) { console.error(e && e.message ? e.message : e); process.exit(1); }
}
