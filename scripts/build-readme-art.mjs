// Renders the README and social images from the site itself, so GitHub shows the same drawings:
//   docs/assets/{hero,flow,review,ladder}-{light,dark}.png and site/og.png
// Run: node scripts/build-readme-art.mjs   (needs a Chromium, see README)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let f = path.join(site, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!f.startsWith(site) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
const url = 'http://localhost:' + srv.address().port + '/';
const out = (n) => path.join(root, 'docs/assets', n);

const b = await launchBrowser();
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(url); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.addStyleTag({ content: '.top nav{display:none} .sheet{margin:20px auto!important}' });
  // hero: the sheet from its top edge (with grid bubbles) to the end of the title block
  const box = await p.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(), t = document.querySelector('.tblock').getBoundingClientRect(); return { x: s.x - 6, y: s.y - 16, width: s.width + 12, height: t.bottom - s.y + 22 }; });
  await p.screenshot({ path: out(`hero-${scheme}.png`), clip: box });
  for (const [name, sel] of [['flow', '#how .flow'], ['review', '.review'], ['ladder', '.ladder']]) {
    const el = p.locator(sel).first();
    await el.scrollIntoViewIfNeeded(); const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; });
    await p.screenshot({ path: out(`${name}-${scheme}.png`), fullPage: true, clip: { x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 } });
  }
  if (scheme === 'light') {
    const og = await b.newContext({ viewport: { width: 1200, height: 630 }, colorScheme: 'light', deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const q = await og.newPage(); await q.goto(url); await q.evaluate(() => document.fonts.ready);
    await q.addStyleTag({ content: '.top nav{display:none} .sheet{margin:20px!important;width:auto!important} .hero{padding-top:28px!important} .hero .lede,.links,.caption{display:none} .hero h1{font-size:76px!important}' });
    await q.waitForTimeout(200); await q.screenshot({ path: path.join(site, 'og.png') }); await og.close();
  }
  await ctx.close();
}
await b.close(); srv.close();
for (const f of fs.readdirSync(path.join(root, 'docs/assets'))) console.log('docs/assets/' + f, Math.round(fs.statSync(out(f)).size / 1024) + ' KB');
