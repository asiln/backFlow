// Tiny glob expander (zero dependencies): `*`, `**`, `?`, `{a,b}`; forward or back slashes; plain paths and directories work too.
import fs from 'node:fs';
import path from 'node:path';

const ESC = /[.+^$()|[\]\\]/;

export function globToRegExp(glob) {
  let re = '';
  const g = glob.replace(/\\/g, '/');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const j = g.indexOf('}', i);
      if (j < 0) re += '\\{';
      else {
        re += '(?:' + g.slice(i + 1, j).split(',').map((s) => s.split('').map((x) => (ESC.test(x) ? '\\' + x : x)).join('')).join('|') + ')';
        i = j;
      }
    } else re += ESC.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(f)); } else out.push(f);
  }
  return out;
}

export function expandGlob(pattern, cwd = process.cwd()) {
  const p = pattern.replace(/\\/g, '/');
  if (!/[*?{]/.test(p)) {
    const abs = path.resolve(cwd, p);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isDirectory()) return walk(abs).filter((f) => /\.json$/.test(f)).sort();
    return [abs];
  }
  const parts = p.split('/');
  const k = parts.findIndex((s) => /[*?{]/.test(s));
  const baseRel = parts.slice(0, k).join('/') || (p.startsWith('/') ? '/' : '.');
  const baseAbs = path.resolve(cwd, baseRel);
  if (!fs.existsSync(baseAbs)) return [];
  const re = globToRegExp(parts.slice(k).join('/'));
  return walk(baseAbs).filter((f) => re.test(path.relative(baseAbs, f).replace(/\\/g, '/'))).sort();
}
