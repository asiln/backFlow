// Kheez Auto-layout Verify: runs the 9 experiments from docs/AUTO-LAYOUT-SPEC.md section D5 in throwaway nodes on the
// current page, prints the answers and a ready-to-paste CFG block for plugin/code.js. It deletes everything it creates.
// Run it in a scratch Figma file, then send the printed text back.
figma.showUI(__html__, { width: 520, height: 600 });
const out = [];
const log = (s) => out.push(s);
const cfg = {};
const r2 = (v) => Math.round(v * 100) / 100;
const created = [];
const frame = (w, h) => { const f = figma.createFrame(); created.push(f); f.resize(w, h); f.fills = []; figma.currentPage.appendChild(f); return f; };
const rect = (w, h) => { const r = figma.createRectangle(); r.resize(w, h); return r; };
async function exp(name, fn) {
  try { await fn(); } catch (e) { log(name + ': ERROR ' + (e && e.message ? e.message : e)); }
}

(async () => {
  await exp('V1', async () => {
    const f = frame(200, 100); f.layoutMode = 'HORIZONTAL'; f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.paddingLeft = 10; f.paddingTop = 10;
    f.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; f.strokeAlign = 'INSIDE'; f.strokeWeight = 4;
    const c = rect(20, 20); f.appendChild(c);
    const off = c.x;
    f.strokesIncludedInLayout = true; const onx = c.x;
    log('V1 strokesIncludedInLayout: child.x with false = ' + off + ', with true = ' + onx + '. (14 = padding is added to the stroke, like a CSS border; 10 = stroke ignored)');
    cfg.strokeInLayout = onx === 14;
  });
  await exp('V2', async () => {
    const f = frame(200, 100); f.layoutMode = 'HORIZONTAL'; const a = rect(20, 20), b = rect(20, 20); f.appendChild(a); f.appendChild(b);
    let ok = true;
    try { f.itemSpacing = -5; } catch (e) { ok = false; log('V2 negative itemSpacing: throws: ' + e.message); }
    if (ok) log('V2 negative itemSpacing: accepted, itemSpacing=' + f.itemSpacing + ', second child x=' + b.x + ' (15 = overlap works)');
    cfg.allowNegativeSpacing = ok && f.itemSpacing === -5 && b.x === 15;
  });
  await exp('V3', async () => {
    const f = frame(200, 100); f.layoutMode = 'HORIZONTAL'; f.primaryAxisSizingMode = 'FIXED'; const a = rect(20, 20), b = rect(20, 20); f.appendChild(a); f.appendChild(b);
    const res = {};
    for (const m of ['SPACE_BETWEEN', 'SPACE_AROUND', 'SPACE_EVENLY']) {
      try { f.primaryAxisAlignItems = m; res[m] = 'x=[' + r2(a.x) + ',' + r2(b.x) + ']'; } catch (e) { res[m] = 'throws: ' + e.message; }
    }
    log('V3 primaryAxisAlignItems, two 20px children in 200px: ' + JSON.stringify(res) + '  (CSS reference: between [0,180], around [40,140], evenly [53.33,126.67])');
    cfg.spaceAround = !/throws/.test(res.SPACE_AROUND || 'throws') && !/throws/.test(res.SPACE_EVENLY || 'throws');
  });
  await exp('V4', async () => {
    const f = frame(300, 200); f.layoutMode = 'VERTICAL';
    const after = f.primaryAxisSizingMode + '/' + f.counterAxisSizingMode + ', size ' + f.width + 'x' + f.height;
    f.resize(300, 200);
    log('V4 after layoutMode on a resized 300x200 frame: primary/counter = ' + after + '. After resize(300,200): ' + f.primaryAxisSizingMode + '/' + f.counterAxisSizingMode);
  });
  await exp('V5', async () => {
    const f = frame(100, 200); f.layoutMode = 'HORIZONTAL'; f.layoutWrap = 'WRAP'; f.itemSpacing = 8; f.counterAxisSpacing = 12;
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    const kids = []; for (let i = 0; i < 5; i++) { const r = rect(40, 20); f.appendChild(r); kids.push(r); }
    log('V5 wrap (100px wide, 40x20 items, gap 8, row gap 12): ' + kids.map((k) => '[' + r2(k.x) + ',' + r2(k.y) + ']').join(' ') + '  (expected [0,0] [48,0] [0,32] [48,32] [0,64])');
    let ac = 'n/a'; try { f.counterAxisAlignContent = 'AUTO'; ac = 'AUTO ok'; } catch (e) { ac = 'throws ' + e.message; }
    log('V5 counterAxisAlignContent: ' + ac + '. Note: RTL wrap rows always start on the left in Figma.');
    cfg.wrap = r2(kids[2].y) === 32;
  });
  await exp('V6', async () => {
    const g = frame(300, 200); g.layoutMode = 'GRID'; g.gridColumnCount = 3; g.gridRowCount = 2; g.gridColumnGap = 10; g.gridRowGap = 10;
    g.gridColumnSizes[0].type = 'FIXED'; g.gridColumnSizes[0].value = 50;
    log('V6 grid col0 set to FIXED 50, read back: ' + JSON.stringify(g.gridColumnSizes) + ' (does the change persist?)');
    try { g.gridColumnSizes[2].type = 'HUG'; log('V6 col2 HUG accepted: ' + g.gridColumnSizes[2].type); } catch (e) { log('V6 col2 HUG throws: ' + e.message); }
    const kids = []; for (let i = 0; i < 4; i++) { const r = rect(20, 20); g.appendChild(r); kids.push(r); }
    log('V6 auto placement anchors [row,col]: ' + kids.map((k) => '[' + k.gridRowAnchorIndex + ',' + k.gridColumnAnchorIndex + ']').join(' '));
    let m = 'ok'; try { kids[3].setGridChildPosition(1, 2); } catch (e) { m = 'throws: ' + e.message; }
    log('V6 setGridChildPosition(1,2) under MANUAL (default): ' + m + ' -> anchor [' + kids[3].gridRowAnchorIndex + ',' + kids[3].gridColumnAnchorIndex + ']');
    let a = 'n/a';
    try { const extra = rect(20, 20); if (g.appendChildAt) { g.appendChildAt(extra, 1, 0); a = 'ok at [' + extra.gridRowAnchorIndex + ',' + extra.gridColumnAnchorIndex + ']'; } else a = 'appendChildAt missing'; } catch (e) { a = 'throws: ' + e.message; }
    log('V6 appendChildAt(child,1,0): ' + a);
    let s = 'ok'; try { kids[0].gridColumnSpan = 2; s = 'ok, span=' + kids[0].gridColumnSpan; } catch (e) { s = 'throws: ' + e.message; }
    log('V6 gridColumnSpan = 2: ' + s);
    cfg.grid = true; cfg.gridAppendChildAt = /^ok/.test(a);
  });
  await exp('V7', async () => {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const f = frame(300, 100); f.layoutMode = 'VERTICAL'; f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.paddingLeft = 10; f.paddingRight = 10;
    const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Regular' }; f.appendChild(t);
    t.characters = 'a fairly long sentence that has to wrap inside the box because it is wider than the frame is';
    let bad = 'throws';
    try { t.layoutSizingHorizontal = 'FILL'; bad = r2(t.width); } catch (e) { bad = 'throws ' + e.message; }
    t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL';
    log('V7 text FILL: with default autoresize width=' + bad + ' (tiny = thread); after HEIGHT + FILL width=' + r2(t.width) + ' height=' + r2(t.height) + ' (expected width 280)');
    cfg.fillTextWorks = t.width > 200;
  });
  await exp('V8', async () => {
    const p = frame(200, 100); p.layoutMode = 'HORIZONTAL'; p.primaryAxisSizingMode = 'FIXED'; p.counterAxisSizingMode = 'FIXED';
    const a = rect(180, 20); p.appendChild(a); a.layoutPositioning = 'ABSOLUTE'; a.x = 10; a.y = 10; a.constraints = { horizontal: 'STRETCH', vertical: 'MIN' };
    p.resize(300, 100);
    log('V8 absolute child with STRETCH constraint: width after parent 200->300 is ' + r2(a.width) + ' (expected 280)');
    cfg.absoluteConstraints = r2(a.width) === 280;
  });
  await exp('V9', async () => {
    const fonts = await figma.listAvailableFontsAsync();
    const has = fonts.some((f) => f.fontName.family === 'Vazirmatn' && f.fontName.style === 'Regular');
    if (!has) { log('V9 Vazirmatn Regular is NOT installed in this Figma. Install it (Google Fonts) and run again.'); return; }
    await figma.loadFontAsync({ family: 'Vazirmatn', style: 'Regular' });
    const strs = ['ورود', 'شماره موبایل', 'رمز عبور', 'برنامه‌ای متناسب با هدف تو', 'حساب نداری؟ ثبت‌نام', 'ضمانت ۷ روزه', '۱٬۲۹۰٬۰۰۰', 'تومان برای ۳ ماه', 'شروع تمرین امروز', 'گزارش هفتگی'];
    const rows = [];
    for (const s of strs) {
      const t = figma.createText(); created.push(t); figma.currentPage.appendChild(t); t.fontName = { family: 'Vazirmatn', style: 'Regular' }; t.fontSize = 14; t.lineHeight = { unit: 'PIXELS', value: 20 }; t.characters = s;
      rows.push(s + '  =>  ' + r2(t.width) + ' x ' + r2(t.height));
    }
    log('V9 Vazirmatn Regular 14px, line-height 20px, one line (width x height). Chrome reference: run node plugin/verify/chrome-ref.mjs in the repo and compare.\n  ' + rows.join('\n  '));
  });
  log('\n--- paste these values into the CFG object at the top of plugin/code.js ---');
  log(JSON.stringify(cfg, null, 2));
  for (const n of created) { try { n.remove(); } catch (e) { /* already gone */ } }
  figma.ui.postMessage({ text: out.join('\n'), status: 'Done. Copy the text below and send it back.' });
})();
