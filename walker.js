// Runs INSIDE the page (evaluated as an async IIFE; returns a Promise of the node tree).
// Options come from window.__kheezOpts = { selector?, backdrop? } (set by extract.mjs).
// Schema node: {t:'frame'|'text'|'svg'|'img', name, x,y,w,h (relative to parent),
//   fill?, stroke?, radius?, shadow?, opacity?, clip?, layout?, children?, text?, font?, svg?, data?, ...}
// Optional additions (all backward compatible, ignored by old consumers):
//   layers (css-ordered background layers incl. images), fit/tf (image placement), runs (inline text styling),
//   xf (rotation/flip matrix), blend, pos (fixed|sticky|absolute), shadow[].inset, font.shadow, needsFetch/failed (images).
(async function () {
  const OPTS = window.__kheezOpts || {};
  const FONT_MAP = [
    [/vazirmatn/i, 'Vazirmatn'],
    [/space.?grotesk/i, 'Space Grotesk'],
    [/jetbrains.?mono/i, 'JetBrains Mono'],
  ];
  const fam = (ff) => {
    for (const part of ff.split(',')) {
      const p = part.trim().replace(/^["']|["']$/g, '');
      for (const [re, name] of FONT_MAP) if (re.test(p)) return name;
    }
    return 'Vazirmatn';
  };
  const col = (s) => {
    if (!s) return null;
    let m = s.match(/rgba?\(([^)]+)\)/);
    let p;
    if (m) p = m[1].split(/[ ,/]+/).filter(Boolean).map((v) => (v.endsWith('%') ? parseFloat(v) * 2.55 : Number(v)));
    else {
      m = s.match(/color\(srgb\s+([^)]+)\)/);
      if (!m) return null;
      p = m[1].split(/[ /]+/).filter(Boolean).map(Number);
      p = p.map((v, i) => (i < 3 ? v * 255 : v));
    }
    const a = p.length > 3 ? p[3] : 1;
    if (!(a > 0)) return null;
    return { r: +(p[0] / 255).toFixed(4), g: +(p[1] / 255).toFixed(4), b: +(p[2] / 255).toFixed(4), a: +a.toFixed(3) };
  };
  const px = (v) => parseFloat(v) || 0;
  const r1 = (n) => Math.round(n * 100) / 100;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const shadowOf = (s) => {
    if (!s || s === 'none') return null;
    const out = [];
    const re = /((?:rgba?|color)\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?(\s+inset)?/g;
    let m;
    while ((m = re.exec(s))) {
      const c = col(m[1]);
      if (c) { const o = { c, x: +m[2], y: +m[3], blur: +m[4], spread: +(m[5] || 0) }; if (m[6]) o.inset = true; out.push(o); }
    }
    return out.length ? out : null;
  };
  const textShadowOf = (s) => {
    if (!s || s === 'none') return null;
    const m = s.match(/((?:rgba?|color)\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/);
    if (!m) return null;
    const c = col(m[1]);
    return c ? { c, x: +m[2], y: +m[3], blur: +(m[4] || 0) } : null;
  };

  const splitTop = (str) => {
    const out = []; let d = 0, cur = '';
    for (const ch of str) {
      if (ch === '(') d++; if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const DIRS = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
  const gradientsOf = (bg) => {
    const out = [];
    const re = /(repeating-)?(linear|radial)-gradient\(/g;
    let m;
    while ((m = re.exec(bg))) {
      let i = re.lastIndex, d = 1;
      while (i < bg.length && d > 0) { if (bg[i] === '(') d++; if (bg[i] === ')') d--; i++; }
      const args = splitTop(bg.slice(re.lastIndex, i - 1));
      re.lastIndex = i;
      let angle = 180;
      const first = args[0] || '';
      if (/^-?[\d.]+deg$/.test(first)) { angle = parseFloat(first); args.shift(); }
      else if (/^to /.test(first)) { angle = DIRS[first] ?? 180; args.shift(); }
      else if (/^-?[\d.]+(turn|rad)$/.test(first)) { const v = parseFloat(first); angle = /turn/.test(first) ? v * 360 : v * 180 / Math.PI; args.shift(); }
      else if (m[2] === 'radial' && !/^(rgba?|color)\(/.test(first)) args.shift();
      const stops = args.map((a) => {
        const cm = a.match(/(?:rgba?|color)\([^)]+\)/);
        const pm = a.replace(cm ? cm[0] : '', '').match(/(-?[\d.]+)%/);
        return { c: cm ? col(cm[0]) || { r: 0, g: 0, b: 0, a: 0 } : null, pos: pm ? parseFloat(pm[1]) / 100 : null };
      }).filter((x) => x.c);
      if (stops.length >= 2) out.push({ type: m[2], angle, stops });
    }
    return out;
  };
  const blurOf = (v) => { const m = v && v.match(/blur\(([\d.]+)px\)/); return m ? parseFloat(m[1]) : 0; };

  // ---------- images ----------
  const MAXDIM = 1600, MAXBYTES = 1.5e6;
  const blobToDataUrl = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(b); });
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  async function encode(src, w, h, preferJpeg) {
    let scale = Math.min(1, MAXDIM / Math.max(w, h));
    for (let i = 0; i < 6; i++) {
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d');
      if (!preferJpeg) {
        g.drawImage(src, 0, 0, cw, ch);
        const b = await toBlob(c, 'image/png');
        if (b && b.size <= MAXBYTES) return { blob: b, w: cw, h: ch };
      }
      g.clearRect(0, 0, cw, ch); g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
      const j = await toBlob(c, 'image/jpeg', 0.86);
      if (j && j.size <= MAXBYTES) return { blob: j, w: cw, h: ch };
      scale *= 0.7;
    }
    return null;
  }
  // source: Blob | drawable (canvas, video, img). hint: {w,h} rendered size (used for svg without intrinsic size)
  async function convertSource(source, hint) {
    let drawable = source, iw, ih, revoke = null, lossy = false;
    if (source instanceof Blob) {
      const isSvg = /svg/i.test(source.type);
      lossy = /jpe?g|webp|avif/i.test(source.type);
      drawable = null;
      if (!isSvg) { try { drawable = await createImageBitmap(source); } catch (e) { drawable = null; } }
      if (!drawable) {
        const url = URL.createObjectURL(source); revoke = url;
        const im = new Image();
        if (isSvg && hint) { im.width = Math.max(1, Math.round(hint.w * 2)); im.height = Math.max(1, Math.round(hint.h * 2)); }
        await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('decode')); im.src = url; });
        drawable = im;
        iw = isSvg && hint ? im.width : im.naturalWidth; ih = isSvg && hint ? im.height : im.naturalHeight;
      }
    }
    if (iw == null) {
      iw = drawable.naturalWidth || drawable.videoWidth || drawable.width;
      ih = drawable.naturalHeight || drawable.videoHeight || drawable.height;
    }
    if (!iw || !ih) throw new Error('zero size');
    try {
      const enc = await encode(drawable, iw, ih, lossy && iw * ih > 250000);
      if (!enc) throw new Error('too large');
      return { data: await blobToDataUrl(enc.blob), w: enc.w, h: enc.h, ow: iw, oh: ih };
    } finally { if (revoke) URL.revokeObjectURL(revoke); if (drawable && drawable.close) try { drawable.close(); } catch (e) {} }
  }
  const memo = new Map();
  async function convertUrl(url, hint) {
    const key = url + '|' + (hint ? Math.round(hint.w) + 'x' + Math.round(hint.h) : '');
    if (memo.has(key)) return memo.get(key);
    const p = (async () => {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('http ' + resp.status);
      return convertSource(await resp.blob(), hint);
    })();
    memo.set(key, p);
    return p;
  }
  // Used by extract.mjs as a fallback for cross-origin images it downloaded itself (data: url input).
  window.__kheezPlace = (a) => place(a.bw, a.bh, a.iw, a.ih, a.fit, a.pos);
  window.__kheezConvert = (dataUrl, hint) => convertUrl(dataUrl, hint).catch((e) => ({ error: String(e && e.message || e) }));

  // Compute how an image of (iw,ih) sits in a (bw,bh) box.
  // fit: fill|cover|contain|none|scale-down. pos: [x,y] each {pct}|{px}. size: [sw,sh] explicit px (optional)
  function place(bw, bh, iw, ih, fit, pos, size) {
    let sw, sh;
    if (size) { sw = size[0]; sh = size[1]; }
    else if (fit === 'fill') return { mode: 'CROP', tf: [[1, 0, 0], [0, 1, 0]] };
    else if (fit === 'cover') { const s = Math.max(bw / iw, bh / ih); sw = iw * s; sh = ih * s; }
    else if (fit === 'none') { sw = iw; sh = ih; }
    else return { mode: 'FIT' };
    if (!(sw > 0 && sh > 0)) return { mode: 'FILL' };
    if (bw / sw > 1.001 || bh / sh > 1.001) return { mode: size ? 'FIT' : (fit === 'none' ? 'FIT' : 'FILL') };
    const off = (p, free) => (p && p.px != null ? p.px : free * ((p && p.pct != null ? p.pct : 50) / 100));
    const ox = off(pos && pos[0], bw - sw), oy = off(pos && pos[1], bh - sh);
    const centered = Math.abs(ox - (bw - sw) / 2) < 0.5 && Math.abs(oy - (bh - sh) / 2) < 0.5;
    if (fit === 'cover' && centered) return { mode: 'FILL' };
    return { mode: 'CROP', tf: [[r4(bw / sw), 0, r4(-ox / sw)], [0, r4(bh / sh), r4(-oy / sh)]] };
  }
  const posOf = (str) => {
    const t = (str || '50% 50%').split(/\s+/);
    const one = (s) => (s && s.endsWith('%') ? { pct: parseFloat(s) } : s && /px$/.test(s) ? { px: parseFloat(s) } : { pct: 50 });
    return [one(t[0]), one(t[1] || t[0])];
  };

  const jobs = []; // {run: async () => void}
  const tasks = (fn) => jobs.push(fn);

  // ---------- svg ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const INH = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule', 'font-family', 'font-size', 'font-weight', 'text-anchor'];
  const GRAPHIC = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'image', 'svg', 'use']);
  const normVal = (prop, v) => {
    if (!v) return v;
    if (/url\(/.test(v)) { const m = v.match(/#([^"')]+)/); return m ? 'url(#' + m[1] + ')' : 'none'; }
    if (/^(stroke-width|stroke-dashoffset|font-size|stroke-miterlimit)$/.test(prop)) return String(px(v));
    if (prop === 'stroke-dasharray' && v !== 'none') return v.replace(/px/g, '').replace(/,\s*/g, ' ');
    if (prop === 'font-family') return fam(v);
    return v;
  };
  function svgString(el, r) {
    const root = el.cloneNode(true);
    const needed = new Set();
    function refsIn(dst) {
      for (const a of dst.attributes) {
        const m = a.value.match(/url\(["']?#([^)"']+)/);
        if (m) needed.add(m[1]);
        if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#') && dst.localName !== 'use') needed.add(a.value.slice(1));
      }
    }
    function resolve(src, dst, parent, isRoot, ctxColor) {
      const tg = src.localName;
      if (['style', 'script', 'title', 'desc', 'metadata', 'foreignobject'].includes(tg.toLowerCase())) { dst.remove(); return; }
      const cs = getComputedStyle(src);
      if (!isRoot && GRAPHIC.has(tg) && cs.display === 'none') { dst.remove(); return; }
      if (!isRoot && GRAPHIC.has(tg) && cs.visibility === 'hidden' && tg !== 'g') { dst.remove(); return; }
      if (tg === 'use') {
        const href = src.getAttribute('href') || src.getAttribute('xlink:href') || '';
        const target = href.startsWith('#') ? (el.querySelector('#' + CSS.escape(href.slice(1))) || document.getElementById(href.slice(1))) : null;
        if (!target) { dst.remove(); return; }
        const g = document.createElementNS(SVGNS, 'g');
        const ux = px(src.getAttribute('x')), uy = px(src.getAttribute('y'));
        const tr = src.getAttribute('transform');
        g.setAttribute('transform', ((tr ? tr + ' ' : '') + (ux || uy ? `translate(${ux} ${uy})` : '')).trim() || 'translate(0 0)');
        const useColor = cs.color;
        const pv = {}; for (const p of INH) pv[p] = normVal(p, cs.getPropertyValue(p));
        let holder = g, tsrc = target, tcl = target.cloneNode(true);
        if (target.localName === 'symbol') {
          const s = document.createElementNS(SVGNS, 'svg');
          const vb = target.getAttribute('viewBox'); if (vb) s.setAttribute('viewBox', vb);
          s.setAttribute('width', src.getAttribute('width') || '100%'); s.setAttribute('height', src.getAttribute('height') || '100%');
          g.appendChild(s); holder = s;
          for (let i = 0; i < target.children.length; i++) {
            const k = target.children[i].cloneNode(true); s.appendChild(k);
            resolve(target.children[i], k, pv, false, useColor);
          }
        } else {
          g.appendChild(tcl);
          resolve(tsrc, tcl, pv, false, useColor);
        }
        refsIn(g); g.querySelectorAll('*').forEach(refsIn);
        dst.replaceWith(g);
        return;
      }
      const vals = {};
      for (const p of INH) {
        let v = normVal(p, cs.getPropertyValue(p));
        // currentColor written on the referenced element of a <use>: honour the use element's colour
        const raw = src.getAttribute(p);
        if (ctxColor && raw === 'currentColor' && (p === 'fill' || p === 'stroke')) v = ctxColor;
        vals[p] = v;
        if (v == null || v === '') continue;
        if (isRoot || !parent || v !== parent[p]) dst.setAttribute(p, v);
        else dst.removeAttribute(p);
      }
      if (parseFloat(cs.opacity) < 1) dst.setAttribute('opacity', r4(parseFloat(cs.opacity)));
      if (tg === 'stop') { const sc = cs.getPropertyValue('stop-color'), so = cs.getPropertyValue('stop-opacity'); if (sc) dst.setAttribute('stop-color', sc); if (so) dst.setAttribute('stop-opacity', so); }
      if (!isRoot && !src.hasAttribute('transform') && cs.transform && cs.transform !== 'none' && GRAPHIC.has(tg)) dst.setAttribute('transform', cs.transform);
      dst.removeAttribute('class'); dst.removeAttribute('style');
      refsIn(dst);
      const dk = [...dst.children], sk = [...src.children];
      for (let i = 0; i < sk.length; i++) if (dk[i]) resolve(sk[i], dk[i], vals, false, ctxColor);
    }
    resolve(el, root, {}, true, null);
    // pull in gradients/clipPaths/masks defined elsewhere in the document
    let defs = null;
    for (let depth = 0; depth < 3; depth++) {
      let added = false;
      for (const id of [...needed]) {
        if (root.querySelector('#' + CSS.escape(id))) continue;
        const ext = document.getElementById(id);
        if (!ext) continue;
        if (!defs) { defs = document.createElementNS(SVGNS, 'defs'); root.insertBefore(defs, root.firstChild); }
        const cl = ext.cloneNode(true);
        cl.querySelectorAll('*').forEach((n) => { n.removeAttribute('class'); n.removeAttribute('style'); });
        cl.querySelectorAll('stop').forEach((st) => { /* colours already inline in most cases */ });
        defs.appendChild(cl); refsIn(cl); cl.querySelectorAll('*').forEach(refsIn);
        added = true;
      }
      if (!added) break;
    }
    root.setAttribute('xmlns', SVGNS);
    if (!root.getAttribute('viewBox')) {
      const ow = px(el.getAttribute('width')) || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width) || r.width;
      const oh = px(el.getAttribute('height')) || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.height) || r.height;
      if (ow && oh) root.setAttribute('viewBox', `0 0 ${r1(ow)} ${r1(oh)}`);
    }
    root.setAttribute('width', r1(r.width));
    root.setAttribute('height', r1(r.height));
    let s = new XMLSerializer().serializeToString(root);
    s = s.replace(/currentColor/g, getComputedStyle(el).color);
    return s;
  }

  // ---------- text ----------
  const fontOf = (cs, bgGrad) => {
    const lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
    let color = col(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
    if (!color && bgGrad && bgGrad.length) color = bgGrad[0].stops[0].c; // gradient text: use first stop
    const f = {
      family: fam(cs.fontFamily),
      size: px(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      color: color || { r: 0, g: 0, b: 0, a: 1 },
      lh,
      ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
      align: cs.textAlign,
      deco: cs.textDecorationLine,
      upper: cs.textTransform === 'uppercase',
      dir: cs.direction,
    };
    const ts = textShadowOf(cs.textShadow);
    if (ts) f.shadow = ts;
    return f;
  };
  const INLINE_TAGS = new Set(['span', 'b', 'strong', 'i', 'em', 'a', 'u', 's', 'small', 'mark', 'code', 'sub', 'sup', 'br', 'abbr', 'time', 'bdi', 'bdo', 'del', 'ins', 'q', 'cite', 'kbd', 'wbr']);
  const plainInline = (el) => {
    for (const c of el.children) {
      const tg = c.tagName.toLowerCase();
      if (!INLINE_TAGS.has(tg)) return false;
      const cs = getComputedStyle(c);
      if (cs.display === 'none') continue;
      if (cs.display !== 'inline') return false;
      if (cs.position !== 'static') return false;
      if (col(cs.backgroundColor) || cs.backgroundImage !== 'none') return false;
      if (px(cs.borderTopWidth) || px(cs.borderBottomWidth) || px(cs.borderLeftWidth) || px(cs.borderRightWidth)) return false;
      if (px(cs.paddingLeft) || px(cs.paddingRight)) return false;
      if (cs.boxShadow !== 'none') return false;
      if (cs.transform !== 'none') return false;
      if (!plainInline(c)) return false;
    }
    return true;
  };
  // Collect text with per-run style differences. base = fontOf(cs of el)
  function collectText(el, cs, base, wantRuns) {
    const pre = /^pre/.test(cs.whiteSpace);
    let text = '';
    const raw = []; // {s,e,f}
    const rects = [];
    const rec = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          let s = n.textContent;
          if (!s.trim() && !pre && (!text || /[\s\n]$/.test(text))) continue;
          const pcs = n.parentNode === el ? cs : getComputedStyle(n.parentNode);
          if (!pre) s = s.replace(/\s+/g, ' ');
          if (!pre && (text === '' || /[ \n]$/.test(text)) && s.startsWith(' ')) s = s.slice(1);
          if (!s) continue;
          if (pcs.textTransform === 'uppercase') s = s.toUpperCase(); else if (pcs.textTransform === 'lowercase') s = s.toLowerCase();
          const st = text.length;
          text += s;
          if (wantRuns) raw.push({ s: st, e: text.length, cs: pcs });
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const rc of rg.getClientRects()) if (rc.width > 0) rects.push(rc);
        } else if (n.nodeType === 1) {
          if (n.localName === 'br') { text += '\n'; continue; }
          const ccs = getComputedStyle(n);
          if (ccs.display === 'none') continue;
          rec(n);
        }
      }
    };
    rec(el);
    const trimmedEnd = text.replace(/[ \n]+$/, '');
    text = trimmedEnd;
    const runs = [];
    if (wantRuns) {
      for (const q of raw) {
        const e = Math.min(q.e, text.length);
        if (q.s >= e) continue;
        const f = fontOf(q.cs);
        const d = {};
        if (f.family !== base.family) d.family = f.family;
        if (f.size !== base.size) d.size = f.size;
        if (f.weight !== base.weight) d.weight = f.weight;
        if (JSON.stringify(f.color) !== JSON.stringify(base.color)) d.color = f.color;
        if (f.deco !== base.deco) d.deco = f.deco;
        if (Object.keys(d).length) {
          const last = runs[runs.length - 1];
          if (last && last.e === q.s && JSON.stringify(last.st) === JSON.stringify(d)) last.e = e; else runs.push({ s: q.s, e, st: d });
        }
      }
    }
    return { t: text, rects, runs: runs.map((x) => ({ s: x.s, e: x.e, ...x.st })) };
  }

  // ---------- names ----------
  const SEMANTIC = { button: 'button', a: 'link', input: 'input', textarea: 'textarea', select: 'select', nav: 'nav', header: 'header', footer: 'footer', main: 'main', section: 'section', aside: 'aside', form: 'form', ul: 'list', ol: 'list', li: 'item', label: 'label', dialog: 'dialog', table: 'table', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', article: 'article', p: 'p', video: 'video', canvas: 'canvas' };
  const SNIP = new Set(['button', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'option', 'summary']);
  const nameOf = (el, tag, cs, r) => {
    const aria = el.getAttribute('aria-label'), tid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-slot');
    const role = el.getAttribute('role');
    let base = aria || tid || '';
    if (!base) {
      if (role) base = role;
      else if (SEMANTIC[tag]) base = SEMANTIC[tag];
      else if (cs.position === 'fixed' && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) base = 'overlay';
      else base = tag;
    }
    if (!aria && SNIP.has(tag) || (!aria && (role === 'button' || role === 'tab' || role === 'menuitem'))) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
      if (t) base += ' · ' + t;
    }
    if (el.id && !aria && !tid) base += '#' + el.id;
    return base.slice(0, 60);
  };

  const visible = (el, cs, r) => {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (r.width < 0.5 && r.height < 0.5) return false;
    return true;
  };

  const parseMatrix = (t) => {
    if (!t || t === 'none') return null;
    let m = t.match(/^matrix\(([^)]+)\)$/);
    if (m) { const v = m[1].split(',').map(Number); return v.length === 6 ? v : null; }
    m = t.match(/^matrix3d\(([^)]+)\)$/);
    if (m) { const v = m[1].split(',').map(Number); return [v[0], v[1], v[4], v[5], v[12], v[13]]; }
    return null;
  };
  const BLEND_OK = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
  const radiusOf = (v, w, h) => {
    const first = (v || '').split(' ')[0];
    const val = first.endsWith('%') ? parseFloat(first) * Math.min(w, h) / 100 : px(first);
    return Math.min(val || 0, Math.min(w, h) / 2);
  };

  // Background layers (css order = top first). Returns {layers, grads}
  function bgLayers(el, cs, w, h, node) {
    const bi = cs.backgroundImage;
    if (!bi || bi === 'none') return;
    const parts = splitTop(bi);
    const sizes = splitTop(cs.backgroundSize || 'auto');
    const poss = splitTop(cs.backgroundPosition || '0% 0%');
    const reps = splitTop(cs.backgroundRepeat || 'repeat');
    const layers = [];
    let hasImg = false;
    parts.forEach((p, i) => {
      if (/^url\(/.test(p)) {
        const m = p.match(/url\((["']?)(.*?)\1\)/);
        if (!m) return;
        hasImg = true;
        const layer = { k: 'img', mode: 'FILL', sizeCss: sizes[i % sizes.length] };
        layers.push(layer);
        const size = sizes[i % sizes.length], pos = poss[i % poss.length], rep = reps[i % reps.length];
        tasks(async () => {
          try {
            const res = await convertUrl(new URL(m[2], location.href).href, { w, h });
            const ow = res.w, oh = res.h;
            if (size === 'cover') { Object.assign(layer, place(w, h, ow, oh, 'cover', posOf(pos))); }
            else if (size === 'contain') layer.mode = 'FIT';
            else if (/no-repeat/.test(rep) || rep === 'repeat-x' || rep === 'repeat-y' || rep === 'repeat') {
              let sw = ow, sh = oh;
              const st = size.split(/\s+/);
              if (st[0] && st[0] !== 'auto') sw = st[0].endsWith('%') ? w * parseFloat(st[0]) / 100 : px(st[0]);
              if (st[1] && st[1] !== 'auto') sh = st[1].endsWith('%') ? h * parseFloat(st[1]) / 100 : px(st[1]);
              else if (st[0] && st[0] !== 'auto') sh = sw * oh / ow;
              if (st[0] === 'auto' || !st[0]) { if (st[1] && st[1] !== 'auto') sw = sh * ow / oh; }
              if (rep === 'no-repeat') {
                if (Math.abs(sw - w) < 1 && Math.abs(sh - h) < 1) layer.mode = 'FILL';
                else Object.assign(layer, place(w, h, ow, oh, 'explicit', posOf(pos), [sw, sh]));
              } else { layer.mode = 'TILE'; layer.scale = r4(sw / ow); }
            }
            layer.data = res.data; layer.iw = ow; layer.ih = oh; delete layer.sizeCss;
          } catch (e) {
            layer.failed = String(e && e.message || e);
            layer.needsFetch = new URL(m[2], location.href).href;
            layer.hint = { w, h };
          }
        });
      } else if (/gradient\(/.test(p)) {
        const g = gradientsOf(p);
        if (g.length) layers.push({ k: 'grad', ...g[0] });
      }
    });
    if (hasImg) node.layers = layers;
  }

  // ---------- layout facts (consumed by normalize.mjs; removed from the final JSON) ----------
  const LF = { n: 0, probed: 0, skipped: 0, t0: performance.now(), budget: OPTS.probeBudgetMs || 9000, ms: 0 };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const nonDef = (v, none) => (v === none || v === 'auto' || v === 'normal' || !/px$/.test(v) ? null : parseFloat(v));
  function itemFacts(el, cs, pel, pcs) {
    const i = {};
    i.pos = cs.position;
    if (cs.zIndex !== 'auto') i.z = parseInt(cs.zIndex, 10) || 0;
    if (cs.float && cs.float !== 'none') i.fl = 1;
    if (pcs && /flex/.test(pcs.display)) { i.fg = num(cs.flexGrow) || 0; i.fs = num(cs.flexShrink); i.fb = cs.flexBasis; i.as = cs.alignSelf; i.ord = num(cs.order) || 0; }
    else if (pcs && /grid/.test(pcs.display)) { i.as = cs.alignSelf; i.js = cs.justifySelf; }
    i.m = [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)];
    const mnw = nonDef(cs.minWidth, '0px'), mnh = nonDef(cs.minHeight, '0px'), mxw = nonDef(cs.maxWidth, 'none'), mxh = nonDef(cs.maxHeight, 'none');
    if (mnw || mnh) i.mn = [mnw || null, mnh || null];
    if (mxw != null || mxh != null) i.mx = [mxw, mxh];
    if (cs.aspectRatio && cs.aspectRatio !== 'auto') i.ar = cs.aspectRatio;
    return i;
  }
  function containerFacts(cs, r) {
    const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    const pad = [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)];
    const c = { disp: cs.display, pad, bor: bw };
    if (cs.direction === 'rtl') c.rtl = 1;
    if (/flex/.test(cs.display)) { c.fd = cs.flexDirection; c.fw = cs.flexWrap; c.jc = cs.justifyContent; c.ai = cs.alignItems; c.ac = cs.alignContent; c.rg = px(cs.rowGap); c.cg = px(cs.columnGap); }
    else if (/grid/.test(cs.display)) { c.gtc = cs.gridTemplateColumns; c.gtr = cs.gridTemplateRows; c.ai = cs.alignItems; c.jc = cs.justifyContent; c.rg = px(cs.rowGap); c.cg = px(cs.columnGap); c.gaf = cs.gridAutoFlow; }
    if (cs.writingMode && cs.writingMode !== 'horizontal-tb') c.wm = cs.writingMode;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') c.ov = (cs.overflowX !== 'visible' ? 'x' : '') + (cs.overflowY !== 'visible' ? 'y' : '');
    return c;
  }
  // style-override probes: set an inline override, read the rect, restore. Tells FIXED vs HUG vs FILL per axis.
  function probeItem(el, cs, r, pcs, lf) {
    if (performance.now() - LF.t0 > LF.budget) { LF.skipped++; lf.np = 1; return; }
    const st = el.style, sv = {};
    for (const p of ['width', 'height', 'align-self']) sv[p] = [st.getPropertyValue(p), st.getPropertyPriority(p)];
    const back = (ps) => { for (const p of ps) { const [v, pr] = sv[p]; if (v) st.setProperty(p, v, pr); else st.removeProperty(p); } };
    const t = performance.now();
    try {
      st.setProperty('width', 'auto', 'important'); lf.wa = el.getBoundingClientRect().width;
      st.setProperty('width', 'max-content', 'important'); lf.wm = el.getBoundingClientRect().width;
      back(['width']);
      st.setProperty('height', 'auto', 'important'); lf.ha = el.getBoundingClientRect().height;
      if (pcs && ((/flex/.test(pcs.display) && /^row/.test(pcs.flexDirection)) || /grid/.test(pcs.display))) {
        const eff = cs.alignSelf === 'auto' ? pcs.alignItems : cs.alignSelf;
        if (eff === 'normal' || eff === 'stretch') { st.setProperty('align-self', 'flex-start', 'important'); lf.hs = el.getBoundingClientRect().height; }
      }
    } finally { back(['width', 'height', 'align-self']); }
    LF.probed++; LF.ms += performance.now() - t;
  }
  function probeGrid(el, cs, r, lf) {
    try {
      const st = el.style, sv = [st.getPropertyValue('width'), st.getPropertyPriority('width')];
      st.setProperty('width', (r.width + 40) + 'px', 'important');
      lf.gtc2 = getComputedStyle(el).gridTemplateColumns;
      if (sv[0]) st.setProperty('width', sv[0], sv[1]); else st.removeProperty('width');
    } catch (e) {}
  }
  // which inset sides are authored on a positioned element
  function probeInset(el, r) {
    const st = el.style, out = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const sv = st.getPropertyValue(side), sp = st.getPropertyPriority(side);
      st.setProperty(side, 'auto', 'important');
      const q = el.getBoundingClientRect();
      out[side] = Math.abs(q.left - r.left) > 0.5 || Math.abs(q.top - r.top) > 0.5 || Math.abs(q.width - r.width) > 0.5 || Math.abs(q.height - r.height) > 0.5 ? 1 : 0;
      if (sv) st.setProperty(side, sv, sp); else st.removeProperty(side);
    }
    return out;
  }
  const textFacts = (el, cs, lines, rs, ownerW, lhBase) => {
    const tops = [...new Set(rs.map((q) => Math.round(q.top)))].sort((a, b) => a - b);
    let lh = lhBase;
    if (!lh) { if (tops.length > 1) lh = r1((tops[tops.length - 1] - tops[0]) / (tops.length - 1)); else lh = r1(Math.min(...rs.map((q) => q.height))); }
    const t = { l: lines, lh, ow: r1(ownerW) };
    if (/^(nowrap|pre)$/.test(cs.whiteSpace)) t.nw = 1;
    if (cs.textOverflow === 'ellipsis' && (cs.overflowX !== 'visible')) t.tr = { l: 1, on: el.scrollWidth > el.clientWidth + 1 ? 1 : 0 };
    const lc = parseInt(cs.webkitLineClamp, 10);
    if (lc > 0 && cs.overflowY !== 'visible') t.tr = { l: lc, on: el.scrollHeight > el.clientHeight + 1 ? 1 : 0 };
    return t;
  };

  async function walk(el, origin, sortKey, isRoot) {
    if (el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta', 'template', 'head', 'title'].includes(tag)) return null;
    const cs = getComputedStyle(el);
    let r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) return null;

    // rotation / flip: measure the element untransformed, remember the matrix
    let xfm = parseMatrix(cs.transform), restore = null, lin = null;
    if (xfm) {
      const sx = Math.hypot(xfm[0], xfm[1]) || 1, sy = Math.hypot(xfm[2], xfm[3]) || 1;
      lin = [xfm[0] / sx, xfm[1] / sx, xfm[2] / sy, xfm[3] / sy];
      const isId = Math.abs(lin[1]) < 1e-3 && Math.abs(lin[2]) < 1e-3 && lin[0] > 0 && lin[3] > 0;
      if (isId) { xfm = null; lin = null; }
      else {
        restore = [el.style.getPropertyValue('transform'), el.style.getPropertyPriority('transform')];
        el.style.setProperty('transform', 'none', 'important');
        r = el.getBoundingClientRect();
      }
    }
    try {
      const x = r1(r.left - origin.x), y = r1(r.top - origin.y);
      const base = { name: nameOf(el, tag, cs, r), x, y, w: r1(r.width), h: r1(r.height) };
      const opacity = parseFloat(cs.opacity);
      if (opacity < 1) base.opacity = r1(opacity);
      if (lin) {
        const to = (cs.transformOrigin || '').split(/\s+/).map(px);
        // the cleared computed style no longer reports the origin differently; origin defaults to center
        const ox = to.length ? to[0] : r.width / 2, oy = to.length > 1 ? to[1] : r.height / 2;
        const e = xfm[4], f = xfm[5];
        base.xf = [r4(lin[0]), r4(lin[1]), r4(lin[2]), r4(lin[3]), r1(x + ox + e - (lin[0] * ox + lin[2] * oy)), r1(y + oy + f - (lin[1] * ox + lin[3] * oy))];
      }
      if (cs.position === 'fixed' || cs.position === 'sticky') base.pos = cs.position;
      const pel = el.parentElement, pcs = pel ? getComputedStyle(pel) : null;
      const lf = { id: ++LF.n, i: itemFacts(el, cs, pel, pcs) };
      if (!isRoot && (cs.position === 'absolute' || cs.position === 'fixed')) { lf.i.ins = probeInset(el, r); lf.i.cbp = el.offsetParent === pel ? 1 : 0; }
      base.lf = lf;
      if (BLEND_OK.has(cs.mixBlendMode)) base.blend = cs.mixBlendMode;
      if (sortKey) base.z = sortKey;

      if (tag === 'svg') {
        try { return { t: 'svg', ...base, svg: svgString(el, r) }; }
        catch (e) { return { t: 'frame', ...base, children: [], failed: 'svg: ' + (e && e.message || e) }; }
      }

      const boxStyle = (node) => {
        const w = r.width, h = r.height;
        const bgc = col(cs.backgroundColor);
        if (bgc) node.fill = bgc;
        const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
        if (bw.some((v) => v > 0)) {
          const sides = [['Top', 0], ['Right', 1], ['Bottom', 2], ['Left', 3]].filter(([, i]) => bw[i] > 0).map(([k]) => k);
          const bc = col(cs['border' + sides[0] + 'Color']);
          if (bc) node.stroke = { c: bc, w: bw, style: cs['border' + sides[0] + 'Style'] };
        }
        const oc = col(cs.outlineColor);
        if (px(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' && oc && !node.stroke) node.stroke = { c: oc, w: [px(cs.outlineWidth), px(cs.outlineWidth), px(cs.outlineWidth), px(cs.outlineWidth)], style: 'solid' };
        const rad = [radiusOf(cs.borderTopLeftRadius, w, h), radiusOf(cs.borderTopRightRadius, w, h), radiusOf(cs.borderBottomRightRadius, w, h), radiusOf(cs.borderBottomLeftRadius, w, h)].map(r1);
        if (rad.some((v) => v > 0)) node.radius = rad;
        const sh = shadowOf(cs.boxShadow);
        if (sh) node.shadow = sh;
        return bw;
      };

      if (tag === 'img' || tag === 'canvas' || tag === 'video' || tag === 'picture') {
        if (tag === 'picture') return null;
        const node = { t: 'img', ...base };
        boxStyle(node);
        if (node.radius && node.radius.every((v) => v === node.radius[0])) node.radius = node.radius[0]; else if (node.radius) { node.radiusArr = node.radius; node.radius = node.radius[0]; }
        const fit = tag === 'img' || tag === 'video' ? cs.objectFit : 'fill';
        const pos = posOf(cs.objectPosition);
        const w = r.width, h = r.height;
        const apply = (res) => {
          node.data = res.data; node.iw = res.w; node.ih = res.h;
          const pl = place(w, h, res.w, res.h, fit === 'fill' ? 'fill' : fit === 'scale-down' ? 'contain' : fit, pos);
          node.fit = pl.mode; if (pl.tf) node.tf = pl.tf;
        };
        if (tag === 'img') node.alt = el.alt || undefined;
        // WebGL/2D canvases and videos read back black or empty via JS once painted: tag them so extract.mjs can take a real element screenshot
        if (tag === 'canvas' || tag === 'video') { window.__kzShot = (window.__kzShot || 0) + 1; el.setAttribute('data-kz-shot', String(window.__kzShot)); node.shot = window.__kzShot; }
        tasks(async () => {
          let url = null;
          try {
            if (tag === 'img') {
              url = el.currentSrc || el.src;
              if (!url) throw new Error('no src');
              if (el.complete && !el.naturalWidth && !/svg/i.test(url)) throw new Error('broken image');
              apply(await convertUrl(url, { w, h }));
            } else {
              apply(await convertSource(el, { w, h }));
            }
          } catch (e) {
            node.failed = String(e && e.message || e);
            if (url && !/^data:|^blob:/.test(url)) { node.needsFetch = url; node.hint = { w, h }; node.fitArgs = { fit: fit === 'fill' ? 'fill' : fit === 'scale-down' ? 'contain' : fit, pos }; }
          }
        });
        return node;
      }

      // frame
      const node = { t: 'frame', ...base, children: [] };
      const bw = boxStyle(node);
      lf.c = containerFacts(cs, r);
      if (!isRoot && cs.position !== 'absolute' && cs.position !== 'fixed' && cs.display !== 'inline') probeItem(el, cs, r, pcs, lf);
      if (/grid/.test(cs.display) && cs.gridTemplateColumns !== 'none') probeGrid(el, cs, r, lf);
      const textClip = cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text';
      let grads = null;
      if (cs.backgroundImage.includes('gradient')) { grads = gradientsOf(cs.backgroundImage); if (grads.length && !textClip) node.grads = grads; }
      if (!textClip) bgLayers(el, cs, r.width, r.height, node);
      const lb = blurOf(cs.filter), bb = blurOf(cs.backdropFilter || cs.webkitBackdropFilter);
      if (lb) node.blur = lb;
      if (bb) node.bblur = bb;
      if (!lin && (cs.overflow !== 'visible' || cs.overflowX !== 'visible')) node.clip = true;
      else if (lin && (cs.overflow !== 'visible' || cs.overflowX !== 'visible')) node.clip = true;

      // inputs / textareas: synthesize text
      if (tag === 'input' || tag === 'textarea') {
        const val = el.value || el.placeholder || '';
        if (val && el.type !== 'checkbox' && el.type !== 'radio') {
          const isPh = !el.value;
          const f = fontOf(cs);
          if (isPh) { const pc = col(getComputedStyle(el, '::placeholder').color); if (pc) f.color = pc; }
          const padL = px(cs.paddingLeft), padR = px(cs.paddingRight), padT = px(cs.paddingTop), padB = px(cs.paddingBottom);
          node.children.push({ t: 'text', name: 'value', x: padL + bw[3], y: padT + bw[0], w: r1(r.width - padL - padR - bw[1] - bw[3]), h: r1(r.height - padT - padB - bw[0] - bw[2]), text: tag === 'input' && el.type === 'password' && el.value ? '•'.repeat(el.value.length) : val, font: f, fixed: true, lf: { id: ++LF.n, t: { inp: 1, l: tag === 'textarea' ? 2 : 1, lh: f.lh || null } } });
        }
        return node;
      }
      if (tag === 'select') {
        const opt = el.options && el.options[el.selectedIndex];
        const val = opt ? opt.text : '';
        if (val) {
          const f = fontOf(cs);
          const padL = px(cs.paddingLeft), padR = px(cs.paddingRight);
          node.children.push({ t: 'text', name: 'value', x: padL + bw[3], y: 0, w: r1(r.width - padL - padR - bw[1] - bw[3]), h: r1(r.height), text: val, font: f, fixed: true, lf: { id: ++LF.n, t: { inp: 1, l: 1, lh: f.lh || null } } });
        }
        return node;
      }

      // layout hints
      const disp = cs.display;
      if ((disp === 'flex' || disp === 'inline-flex') && cs.flexWrap === 'nowrap') {
        const dir = cs.flexDirection.startsWith('column') ? 'V' : 'H';
        node.layout = {
          dir,
          gap: dir === 'H' ? px(cs.columnGap) : px(cs.rowGap),
          pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
          justify: cs.justifyContent,
          align: cs.alignItems,
          rtl: cs.direction === 'rtl',
          rev: cs.flexDirection.endsWith('reverse'),
        };
      }

      // text (with inline runs when the element only holds plain inline markup)
      const inlineOnly = el.children.length > 0 && disp !== 'flex' && disp !== 'inline-flex' && disp !== 'grid'
        && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && plainInline(el);
      const fullBase = fontOf(cs, grads && textClip ? grads : null);
      // direct text nodes, split into groups at every element child (each group keeps its own position)
      const collectGroups = (e) => {
        const groups = []; let cur = null;
        for (const n of e.childNodes) {
          if (n.nodeType === 3) {
            if (!n.textContent.trim() && !cur) continue;
            if (!cur) cur = { t: '', rects: [], runs: [] };
            cur.t += n.textContent;
            if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); for (const rc of rg.getClientRects()) if (rc.width > 0) cur.rects.push(rc); }
          } else if (n.nodeType === 1) { if (cur) { groups.push(cur); cur = null; } }
        }
        if (cur) groups.push(cur);
        return groups.map((g) => ({ ...g, t: g.t.replace(/\s+/g, ' ').trim() })).filter((g) => g.t);
      };
      const owns = inlineOnly ? [collectText(el, cs, fullBase, true)] : collectGroups(el);
      for (const own of owns) {
        if (!own.t || !own.rects.length) continue;
        const rs = own.rects;
        const left = Math.min(...rs.map((q) => q.left)), top = Math.min(...rs.map((q) => q.top));
        const right = Math.max(...rs.map((q) => q.right)), bottom = Math.max(...rs.map((q) => q.bottom));
        const lines = new Set(rs.map((q) => Math.round(q.top))).size;
        // Figma text boxes start at the line box, DOM text rects start at the glyph content area: add the half-leading back
        let ty = top - r.top, th = bottom - top;
        const firstH = Math.min(...rs.filter((q) => Math.abs(q.top - top) < 2).map((q) => q.height));
        if (fullBase.lh && firstH > 0 && Math.abs(fullBase.lh - firstH) > 0.5) { ty -= (fullBase.lh - firstH) / 2; th = lines * fullBase.lh; }
        const tx = fullBase.upper && !inlineOnly ? own.t.toUpperCase() : own.t;
        const tfont = (/[؀-ۿ]/.test(tx) && fullBase.family !== 'Vazirmatn' && /vazirmatn/i.test(cs.fontFamily)) ? { ...fullBase, family: 'Vazirmatn' } : fullBase;
        const tn = { t: 'text', name: 'text', x: r1(left - r.left), y: r1(ty), w: r1(right - left), h: r1(th), text: tx, font: tfont, fixed: lines > 1 || /\n/.test(own.t) };
        if (own.runs.length) tn.runs = own.runs;
        tn.lf = { id: ++LF.n, t: textFacts(el, cs, lines, rs, r.width - px(cs.paddingLeft) - px(cs.paddingRight) - bw[1] - bw[3], fullBase.lh) };
        node.children.push(tn);
      }
      if (!inlineOnly) {
        // children, painted in z-index order (stable)
        const kids = [];
        let i = 0;
        for (const ch of el.children) {
          const ccs = getComputedStyle(ch);
          let z = 0;
          if (ccs.zIndex !== 'auto' && (ccs.position !== 'static' || /flex|grid/.test(cs.display))) z = parseInt(ccs.zIndex, 10) || 0;
          kids.push({ ch, z, i: i++ });
        }
        kids.sort((a, b) => a.z - b.z || a.i - b.i);
        for (const k of kids) {
          const c = await walk(k.ch, { x: r.left, y: r.top }, k.z || 0);
          if (c) { if (!k.z) delete c.z; node.children.push(c); }
        }
      }
      return node;
    } finally {
      if (restore) { if (restore[0]) el.style.setProperty('transform', restore[0], restore[1]); else el.style.removeProperty('transform'); }
    }
  }

  // wait for lazy images
  try {
    const imgs = [...document.images];
    imgs.forEach((i) => { try { i.loading = 'eager'; } catch (e) {} });
    await Promise.race([Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null))), sleep(3000)]);
  } catch (e) {}

  // root selection
  let rootEl = document.body, rootBox = null;
  if (OPTS.selector) {
    const target = document.querySelector(OPTS.selector);
    if (!target) throw new Error('selector not found: ' + OPTS.selector);
    rootEl = target;
    if (OPTS.backdrop) {
      for (let p = target; p && p !== document.body; p = p.parentElement) {
        const pcs = getComputedStyle(p), pr = p.getBoundingClientRect();
        if ((pcs.position === 'fixed' || pcs.position === 'absolute') && pr.width >= innerWidth * 0.9 && pr.height >= innerHeight * 0.9) { rootEl = p; break; }
      }
    }
    rootBox = rootEl.getBoundingClientRect();
  }
  const rb = rootBox || document.body.getBoundingClientRect();
  const w = rootBox ? Math.round(rootBox.width) : window.innerWidth;
  const docEl = document.documentElement;
  const h = rootBox ? Math.round(rootBox.height) : Math.max(window.innerHeight, docEl.scrollHeight, Math.round(document.body.getBoundingClientRect().height));
  const origin = rootBox ? { x: rootBox.left, y: rootBox.top } : { x: 0, y: 0 };
  const tree = (await walk(rootEl, origin, 0, true)) || { t: 'frame', x: 0, y: 0, w, h, children: [] };
  tree.lfs = { nodes: LF.n, probed: LF.probed, skipped: LF.skipped, probeMs: Math.round(LF.ms), totalMs: Math.round(performance.now() - LF.t0) };
  tree.name = 'screen';
  if (!rootBox && (tree.x || tree.y)) for (const c of tree.children || []) { c.x = r1(c.x + tree.x); c.y = r1(c.y + tree.y); } // body offset by collapsed child margins
  tree.x = 0; tree.y = 0;
  if (rootBox) tree.src = { x: r1(rootBox.left), y: r1(rootBox.top) }; // page position of a selector capture
  tree.w = w;
  tree.h = h;
  if (!rootBox) {
    const html = getComputedStyle(docEl);
    tree.fill = col(getComputedStyle(document.body).backgroundColor) || col(html.backgroundColor);
  }
  tree.clip = true;

  // run image conversions (4 at a time)
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const j = jobs[next++]; try { await Promise.race([j(), sleep(12000)]); } catch (e) {} } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return tree;
})();
