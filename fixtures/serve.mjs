// Tiny static server for the extractor's regression fixtures: node fixtures/serve.mjs  (ports 3999 app, 3998 cross-origin images)
import http from 'http'; import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
// big.png: 2400x1600 noise (~11 MB PNG) to exercise the 1600px / 1.5 MB downscale; generated on demand, not committed
const bigPath = path.join(dir, 'big.png');
if (!fs.existsSync(bigPath)) {
  const W = 2400, H = 1600, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = (Math.random() * 256) | 0; }
  const tbl = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = tbl[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(bigPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const handler = (cors) => (req, res) => {
  const u = new URL(req.url, 'http://x'); const f = path.join(dir, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...(cors ? { 'access-control-allow-origin': '*' } : {}) });
  fs.createReadStream(f).pipe(res);
};
http.createServer(handler(true)).listen(3999);
http.createServer(handler(false)).listen(3998);   // no CORS header: forces the Playwright download fallback
console.log('fixtures on http://localhost:3999 (images also on :3998 without CORS)');
