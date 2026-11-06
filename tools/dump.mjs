import fs from 'fs';
const [file, maxDepth = '6'] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const f = (n) => Math.round(n * 10) / 10;
function dump(n, depth, ind) {
  const l = n.ls || {};
  const s = l.s ? l.s.join('') : '';
  let info = `${n.t === 'text' ? 'T' : n.t[0]} ${n.name?.slice(0, 28) ?? ''}${n.t === 'text' ? ' "' + n.text.slice(0, 20) + '"' : ''} [${f(n.x)},${f(n.y)} ${f(n.w)}x${f(n.h)}]`;
  if (l.k) info += ` ${l.k}${l.lv != null ? '/F' + l.lv : ''} g${l.g ?? ''} p${(l.p || []).join(',')} ${l.pa || ''}/${l.ca || ''}`;
  if (s) info += ` s=${s}`;
  if (l.abs) info += ` ABS cn=${l.cn}`;
  if (l.sp) info += ' SPACER';
  if (l.tx) info += ' tx=' + JSON.stringify(l.tx);
  console.log(ind + info);
  if (depth < +maxDepth) for (const c of n.children || []) dump(c, depth + 1, ind + '  ');
}
for (const fr of d.frames) dump(fr, 0, '');
