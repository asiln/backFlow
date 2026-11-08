// Fidelity check: real screenshot vs an HTML re-render built only from the extracted JSON.
// usage: node diff.mjs <batch.json> [--screen <name-substring>] [--out <dir>] [--threshold 24]
// Writes <out>/<slug>.real.png, .render.png, .side.png (real | render | diff) and prints a JSON summary:
//   diffPct (whole screen), per-type diff (text/svg/img/frame), and the worst individual nodes.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { runBatch } from './extract.mjs';
import { workDir } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const screenSel = flag('--screen');
const outDir = path.resolve(flag('--out', path.join(workDir(), 'out', 'diff')));
const threshold = Number(flag('--threshold', 24));
const useLs = args.includes('--ls'); if (useLs) args.splice(args.indexOf('--ls'), 1);
const batchFile = args[0];
if (!batchFile) { console.error('usage: node diff.mjs <batch.json> [--screen <substr>] [--out dir] [--threshold 24]'); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rgba = (c) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
const assetsOf = {};

function gradCss(g) {
  const stops = g.stops.map((s, i) => `${rgba(s.c)} ${((s.pos != null ? s.pos : i / (g.stops.length - 1)) * 100).toFixed(1)}%`).join(',');
  return g.type === 'radial' ? `radial-gradient(circle farthest-corner at 50% 50%,${stops})` : `linear-gradient(${g.angle}deg,${stops})`;
}
function imgLayerCss(l, w, h) {
  const data = l.data || (l.asset && assetsOf[l.asset]);
  if (!data) return null;
  const url = `url('${data}')`;
  if (l.mode === 'FIT') return { img: url, size: 'contain', pos: 'center', rep: 'no-repeat' };
  if (l.mode === 'TILE') return { img: url, size: `${(l.iw || 100) * (l.scale || 1)}px auto`, pos: '0 0', rep: 'repeat' };
  if (l.mode === 'CROP' && l.tf) {
    const [[a, , tx], [, d, ty]] = l.tf; const sw = w / a, sh = h / d;
    return { img: url, size: `${sw}px ${sh}px`, pos: `${-tx * sw}px ${-ty * sh}px`, rep: 'no-repeat' };
  }
  return { img: url, size: 'cover', pos: 'center', rep: 'no-repeat' };
}
const AUTO_K = { H: 1, V: 1, W: 1, G: 1 };
const isAutoLs = (n) => useLs && n && n.t === 'frame' && n.ls && AUTO_K[n.ls.k] && n.children && n.children.length;
const ALN = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between', SPACE_AROUND: 'space-around', SPACE_EVENLY: 'space-evenly' };
// CSS (Chrome flexbox/grid) standing in for Figma auto-layout, so the `ls` spec can be checked visually and numerically
function lsContainerCss(n) {
  const L = n.ls, bw = n.stroke ? n.stroke.w : [0, 0, 0, 0];
  const p = L.p.map((v, i) => Math.max(0, v - bw[i]));
  const css = ['direction:ltr', `padding:${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`];
  if (L.k === 'G') {
    const t = (d) => d.map((x) => (x.t === 'FLEX' ? `${x.v || 1}fr` : x.t === 'FIXED' ? `${x.v}px` : 'auto')).join(' ');
    css.push('display:grid', `grid-template-columns:${t(L.cols)}`, `grid-template-rows:${t(L.rows)}`, `column-gap:${L.cg}px`, `row-gap:${L.rg}px`);
  } else {
    css.push('display:flex', `flex-direction:${L.k === 'V' ? 'column' : 'row'}`, `gap:${L.g || 0}px`, `justify-content:${ALN[L.pa || 'MIN']}`, `align-items:${ALN[L.ca || 'MIN']}`);
    if (L.k === 'W') css.push('flex-wrap:wrap', `row-gap:${L.g2 || 0}px`, 'align-content:flex-start');
  }
  return css;
}
function lsItemCss(n, par) {
  const L = n.ls, s = L.s || ['F', 'F'], k = par.ls.k;
  const css = ['position:relative', 'box-sizing:border-box', 'margin:0'];
  if (k === 'G') {
    const [r, c, rs, cs] = L.gp || [0, 0, 1, 1];
    css.push(`grid-area:${r + 1}/${c + 1}/span ${rs}/span ${cs}`, `justify-self:${s[0] === 'L' ? 'stretch' : L.ga ? ALN[L.ga[0]] : 'start'}`, `align-self:${s[1] === 'L' ? 'stretch' : L.ga ? ALN[L.ga[1]] : 'start'}`);
    if (s[0] === 'F') css.push(`width:${n.w}px`); if (s[1] === 'F') css.push(`height:${n.h}px`);
    return css;
  }
  const horiz = k === 'H' || k === 'W';
  const dimP = horiz ? 'width' : 'height', dimC = horiz ? 'height' : 'width';
  const sP = horiz ? s[0] : s[1], sC = horiz ? s[1] : s[0], sizeP = horiz ? n.w : n.h, sizeC = horiz ? n.h : n.w;
  if (sP === 'L' && k !== 'W') css.push('flex:1 1 0', horiz ? 'min-width:0' : 'min-height:0'); else { css.push('flex:none'); if (sP === 'F') css.push(`${dimP}:${sizeP}px`); }
  if (sC === 'L') css.push('align-self:stretch'); else if (sC === 'F') css.push(`${dimC}:${sizeC}px`);
  if (L.mn) { if (L.mn[0] != null) css.push(`min-width:${L.mn[0]}px`); if (L.mn[1] != null) css.push(`min-height:${L.mn[1]}px`); }
  if (L.mx) { if (L.mx[0] != null) css.push(`max-width:${L.mx[0]}px`); if (L.mx[1] != null) css.push(`max-height:${L.mx[1]}px`); }
  return css;
}
function boxCss(n, par) {
  const lsFlow = useLs && par && isAutoLs(par) && n.ls && n.ls.s && !n.ls.abs;
  const geom = lsFlow ? lsItemCss(n, par) : [`position:absolute`, `left:${n.x}px`, `top:${n.y}px`, `width:${n.w}px`, `height:${n.h}px`, 'box-sizing:border-box', 'margin:0'];
  const css = geom;
  if (isAutoLs(n)) css.push(...lsContainerCss(n));
  const imgs = [], sizes = [], poss = [], reps = [];
  if (n.layers) {
    for (const l of n.layers) {
      if (l.k === 'grad') { imgs.push(gradCss(l)); sizes.push('auto'); poss.push('0 0'); reps.push('no-repeat'); }
      else { const c = imgLayerCss(l, n.w, n.h); if (c) { imgs.push(c.img); sizes.push(c.size); poss.push(c.pos); reps.push(c.rep); } }
    }
  } else if (n.grads) for (const g of n.grads) { imgs.push(gradCss(g)); sizes.push('auto'); poss.push('0 0'); reps.push('no-repeat'); }
  if (n.t === 'img') {
    const data = n.data || (n.asset && assetsOf[n.asset]);
    if (data) {
      const c = imgLayerCss({ data, mode: n.fit || 'FILL', tf: n.tf }, n.w, n.h);
      imgs.push(c.img); sizes.push(c.size); poss.push(c.pos); reps.push(c.rep);
    } else css.push('background-color:rgba(128,128,128,.3)');
  }
  if (imgs.length) css.push(`background-image:${imgs.join(',')}`, `background-size:${sizes.join(',')}`, `background-position:${poss.join(',')}`, `background-repeat:${reps.join(',')}`);
  if (n.fill) css.push(`background-color:${rgba(n.fill)}`);
  if (n.stroke) {
    const [t, r, b, l] = n.stroke.w;
    css.push(`border-style:${n.stroke.style && n.stroke.style !== 'none' ? n.stroke.style : 'solid'}`, `border-color:${rgba(n.stroke.c)}`, `border-width:${t}px ${r}px ${b}px ${l}px`);
  }
  const rad = n.radiusArr || n.radius;
  if (rad != null) css.push(`border-radius:${Array.isArray(rad) ? rad.map((v) => v + 'px').join(' ') : rad + 'px'}`);
  if (n.shadow) css.push('box-shadow:' + n.shadow.map((s) => `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${rgba(s.c)}`).join(','));
  if (n.opacity != null) css.push(`opacity:${n.opacity}`);
  if (n.clip) css.push('overflow:hidden');
  if (n.blend) css.push(`mix-blend-mode:${n.blend}`);
  if (n.blur) css.push(`filter:blur(${n.blur}px)`);
  if (n.bblur) css.push(`backdrop-filter:blur(${n.bblur}px)`);
  if (n.xf) { const [a, b, c, d, tx, ty] = n.xf; css.push('transform-origin:0 0', `transform:matrix(${a},${b},${c},${d},${tx - n.x},${ty - n.y})`); }
  return css;
}
const alignOf = (f) => { const a = f.align; return a === 'center' ? 'center' : (a === 'right' || (a === 'start' && f.dir === 'rtl') || (a === 'end' && f.dir !== 'rtl')) ? 'right' : 'left'; };
function fontCss(f) {
  return `font-family:'${f.family}',Inter,sans-serif;font-size:${f.size}px;font-weight:${f.weight};color:${rgba(f.color)};` +
    (f.lh ? `line-height:${f.lh}px;` : 'line-height:normal;') + (f.ls ? `letter-spacing:${f.ls}px;` : '') +
    (f.deco && f.deco !== 'none' ? `text-decoration:${f.deco};` : '') + (f.shadow ? `text-shadow:${f.shadow.x}px ${f.shadow.y}px ${f.shadow.blur}px ${rgba(f.shadow.c)};` : '');
}
let idc = 0;
function html(n, par) {
  const id = ++idc; n.__id = id;
  if (n.t === 'text') {
    const f = n.font;
    const x = n.fixed ? n.x : n.x - 1, w = n.fixed ? n.w + 1 : n.w + 2;
    if (useLs && par && isAutoLs(par) && n.ls && n.ls.s && !n.ls.abs) {
      const s = n.ls.s, k = par.ls.k, horiz = k === 'H' || k === 'W';
      const fl = f.lh || !(n.ls.tx && n.ls.tx.lh) ? fontCss(f) : fontCss({ ...f, lh: n.ls.tx.lh });
      const ta = n.ls.tx && n.ls.tx.ta ? { L: 'left', C: 'center', R: 'right' }[n.ls.tx.ta] : alignOf(f);
      let g = 'position:relative;margin:0;box-sizing:border-box;';
      if (s[0] === 'L') g += horiz ? 'flex:1 1 0;min-width:0;' : 'align-self:stretch;'; else if (s[0] === 'F') g += `flex:none;width:${n.w}px;`; else g += 'flex:none;';
      if (s[1] === 'F') g += `height:${n.h}px;`;
      return `<div data-n="${id}" style="${g}${fl}text-align:${ta};white-space:${n.ls.tx && n.ls.tx.l > 1 || s[0] === 'L' ? 'pre-wrap' : 'pre'};${n.ls.tx && n.ls.tx.tr ? 'overflow:hidden;text-overflow:ellipsis;' : ''}" dir="auto">${esc(n.text)}</div>`;
    }
    let inner;
    if (n.runs && n.runs.length) {
      let pos = 0; inner = '';
      for (const r of n.runs) {
        inner += esc(n.text.slice(pos, r.s));
        const st = (r.family ? `font-family:'${r.family}';` : '') + (r.size ? `font-size:${r.size}px;` : '') + (r.weight ? `font-weight:${r.weight};` : '') + (r.color ? `color:${rgba(r.color)};` : '') + (r.deco ? `text-decoration:${r.deco};` : '');
        inner += `<span style="${st}">${esc(n.text.slice(r.s, r.e))}</span>`; pos = r.e;
      }
      inner += esc(n.text.slice(pos));
    } else inner = esc(n.text);
    return `<div data-n="${id}" style="position:absolute;left:${x}px;top:${n.y}px;width:${w}px;height:${n.h}px;${fontCss(f)}text-align:${alignOf(f)};white-space:${n.fixed ? 'pre-wrap' : 'pre'};overflow:visible" dir="auto">${inner}</div>`;
  }
  if (n.t === 'svg') return `<div data-n="${id}" style="${useLs && par && isAutoLs(par) && n.ls && n.ls.s && !n.ls.abs ? `position:relative;flex:none;width:${n.w}px;height:${n.h}px;` : `position:absolute;left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;`}${n.opacity != null ? `opacity:${n.opacity};` : ''}${n.xf ? `transform-origin:0 0;transform:matrix(${n.xf[0]},${n.xf[1]},${n.xf[2]},${n.xf[3]},${n.xf[4] - n.x},${n.xf[5] - n.y});` : ''}line-height:0">${n.svg}</div>`;
  const kids = (n.children || []).map((c) => html(c, n)).join('');
  return `<div data-n="${id}" style="${boxCss(n, par).join(';')}">${kids}</div>`;
}
const flat = (n, ox, oy, out) => { // absolute rects of every node (xf ignored)
  const ax = ox + n.x, ay = oy + n.y;
  out.push({ n, x: ax, y: ay, w: n.w, h: n.h });
  for (const c of n.children || []) flat(c, ax, ay, out);
  return out;
};

// ---- pixel compare, in a page ----
const COMPARE = async ({ a, b, regions, thr }) => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const W = ia.width, H = ia.height;
  const cv = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0); return g.getImageData(0, 0, W, H); };
  const da = cv(ia), db = cv(ib);
  const diff = new Uint8Array(W * H);
  let cnt = 0;
  const out = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const d = Math.max(Math.abs(da.data[p] - db.data[p]), Math.abs(da.data[p + 1] - db.data[p + 1]), Math.abs(da.data[p + 2] - db.data[p + 2]));
    if (d > thr) { diff[i] = 1; cnt++; out.data[p] = 255; out.data[p + 1] = 0; out.data[p + 2] = 60; out.data[p + 3] = 255; }
    else { const gr = Math.round(0.3 * da.data[p] + 0.59 * da.data[p + 1] + 0.11 * da.data[p + 2]); out.data[p] = out.data[p + 1] = out.data[p + 2] = 255 - (255 - gr) * 0.25; out.data[p + 3] = 255; }
  }
  const regionStats = regions.map((r) => {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
    let c = 0, t = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; c += diff[y * W + x]; }
    return { id: r.id, name: r.name, type: r.type, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), pct: t ? +(100 * c / t).toFixed(1) : 0, px: c };
  });
  // grid hot spots
  const gs = 60, cells = [];
  for (let gy = 0; gy < H; gy += gs) for (let gx = 0; gx < W; gx += gs) {
    let c = 0, t = 0;
    for (let y = gy; y < Math.min(H, gy + gs); y++) for (let x = gx; x < Math.min(W, gx + gs); x++) { t++; c += diff[y * W + x]; }
    cells.push({ x: gx, y: gy, pct: +(100 * c / t).toFixed(1) });
  }
  const side = document.createElement('canvas'); side.width = W * 3 + 20; side.height = H; const sg = side.getContext('2d');
  sg.fillStyle = '#888'; sg.fillRect(0, 0, side.width, H);
  sg.drawImage(ia, 0, 0); sg.drawImage(ib, W + 10, 0);
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H; oc.getContext('2d').putImageData(out, 0, 0); sg.drawImage(oc, 2 * W + 20, 0);
  return { W, H, pct: +(100 * cnt / (W * H)).toFixed(2), regionStats, cells: cells.sort((p, q) => q.pct - p.pct).slice(0, 8), side: side.toDataURL('image/png') };
};

async function onScreen({ page, ctx, tree, screen, base }) {
  const slug = (screen.name || screen.path).replace(/[^\w]+/g, '_').slice(0, 60);
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = await page.evaluate(() => {
    const out = [];
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch { continue; }
      for (const r of rules) if (r.type === 5) {
        const b = sh.href || location.href;
        const css = r.cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (m, u) => `url("${new URL(u, b).href}")`);
        out.push({ fam: r.style.getPropertyValue('font-family').replace(/["']/g, ''), css });
      }
    }
    return out;
  });
  const MAP = [[/vazirmatn/i, 'Vazirmatn'], [/space.?grotesk/i, 'Space Grotesk'], [/jetbrains.?mono/i, 'JetBrains Mono']];
  const faceCss = fonts.filter((f) => !/fallback/i.test(f.fam)).map((f) => { for (const [re, name] of MAP) if (re.test(f.fam)) return f.css.replace(/font-family:\s*[^;]+;/, `font-family: "${name}";`); return ''; }).join('\n');

  const real = await page.screenshot({ clip: { x: tree.src ? tree.src.x : 0, y: tree.src ? tree.src.y : 0, width: tree.w, height: tree.h }, fullPage: !tree.src && tree.h > (page.viewportSize()?.height || 0) });
  fs.writeFileSync(path.join(outDir, slug + '.real.png'), real);
  const t2 = JSON.parse(JSON.stringify(tree));
  idc = 0;
  const body = html(t2); if (process.env.KDEBUG) fs.writeFileSync(path.join(outDir, slug + '.html'), body);
  const doc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${faceCss}\nhtml,body{margin:0;padding:0;background:#fff}*{-webkit-font-smoothing:auto}</style><div style="position:relative;width:${tree.w}px;height:${tree.h}px;overflow:hidden;background:${tree.fill ? rgba(tree.fill) : '#fff'}">${body.replace(/^<div /, '<div ')}</div>`;
  const rp = await ctx.newPage();
  await rp.setViewportSize({ width: tree.w, height: Math.max(tree.h, 100) });
  await rp.route(base + '/__backflow_render', (rt) => rt.fulfill({ contentType: 'text/html; charset=utf-8', body: doc }));
  await rp.goto(base + '/__backflow_render', { waitUntil: 'load' });
  await rp.evaluate(() => document.fonts.ready);
  await rp.waitForTimeout(500);
  const render = await rp.screenshot({ clip: { x: 0, y: 0, width: tree.w, height: tree.h } });
  fs.writeFileSync(path.join(outDir, slug + '.render.png'), render);
  await rp.close();

  const rects = flat(t2, 0, 0, []).slice(1).filter((r) => r.w >= 4 && r.h >= 4).map((r) => ({ id: r.n.__id, name: (r.n.t === 'text' ? r.n.text : r.n.name || r.n.t).slice(0, 40), type: r.n.t, x: r.x, y: r.y, w: r.w, h: r.h }));
  const cp = await ctx.newPage();
  await cp.goto('about:blank');
  const res = await cp.evaluate(COMPARE, { a: 'data:image/png;base64,' + real.toString('base64'), b: 'data:image/png;base64,' + render.toString('base64'), regions: rects, thr: threshold });
  await cp.close();
  fs.writeFileSync(path.join(outDir, slug + '.side.png'), Buffer.from(res.side.split(',')[1], 'base64'));
  const byType = {};
  for (const r of res.regionStats) { const t = (byType[r.type] ||= { n: 0, sum: 0 }); t.n++; t.sum += r.pct; }
  const summary = {
    screen: screen.name, size: `${res.W}x${res.H}`, diffPct: res.pct, threshold,
    avgRegionDiffPctByType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v.sum / v.n).toFixed(1)])),
    worstNodes: res.regionStats.filter((r) => r.type !== 'frame' || r.w * r.h < res.W * res.H * 0.5).sort((p, q) => q.px - p.px).slice(0, 12).map(({ type, name, x, y, w, h, pct, px }) => ({ type, name, x, y, w, h, pct, px })),
    hotCells: res.cells.slice(0, 5), files: slug + '.{real,render,side}.png in ' + outDir,
  };
  console.log(JSON.stringify(summary, null, 1));
}

const r = await runBatch(batchFile, path.join(outDir, 'diff-run.figma.json'), { only: screenSel, onScreen, log: () => {} });
console.log('screens:', r.report.map((x) => x.name + ' ' + (x.broken ? 'BROKEN' : 'ok')).join(' | '));
process.exit(0);
