// Naming (spec 1.6): owner/ds -> role vote -> aria/id prefix -> shape guess -> hash. No project literals: tables are
// defaults that nameHints in ds.config.json override.
import { hashStr } from '../common/hash.mjs';

export const DEFAULT_ROLE_NAMES = {
  button: 'Button', link: 'Link', input: 'Input', item: 'List Item', li: 'List Item', tab: 'Tab', alert: 'Alert', aside: 'Sidebar',
  header: 'Header', tr: 'Table Row', nav: 'Navigation', dialog: 'Dialog', article: 'Card', textarea: 'Input', select: 'Select',
};
const GROUP_BY_NAME = { Button: 'Buttons', Link: 'Buttons', Tab: 'Navigation', Navigation: 'Navigation', Sidebar: 'Navigation', Header: 'Navigation',
  Input: 'Forms', Select: 'Forms', 'List Item': 'Lists', 'Table Row': 'Lists', Alert: 'Feedback', Dialog: 'Feedback', Card: 'Cards', Badge: 'Feedback', Avatar: 'Other', Pill: 'Buttons' };

const title = (s) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const GENERIC = new Set(['div', 'span', 'p', 'section', 'form', 'list', 'label', 'bdi', 'frame', 'text', 'ul', 'ol', 'main', 'figure']);

function lcp(strs) {
  if (!strs.length) return '';
  let p = strs[0];
  for (const s of strs) { while (!s.startsWith(p)) p = p.slice(0, -1); if (!p) break; }
  return p;
}

function shapeGuess(core, hints) {
  const v = core.leader, n = v.n;
  const w = v.w, h = v.h;
  for (const sh of hints || []) {
    const m = sh.match || {};
    const ok = Object.entries(m).every(([k, val]) => {
      if (k === 'h') return Math.abs(h - val) <= 1;
      if (k === 'w') return Math.abs(w - val) <= 1;
      if (k === 'fixedBottom') return (v.pos === 'fixed') === !!val;
      return true;
    });
    if (ok) return sh.name;
  }
  const r = Array.isArray(n.radius) ? Math.max(...n.radius) : n.radius || 0;
  const texts = v.dg.leaves;
  if (v.styled && h <= 28 && r >= h / 2 - 0.5 && texts <= 2) return 'Badge';
  if (w === h && w <= 64 && r >= w / 2 - 0.5 && texts >= 1) return 'Avatar';
  return null;
}

/** Returns { name, group, nameSource, notes[] }. `taken` is a Set of names already used (collision suffix). */
export function nameCore(core, cfg, taken) {
  const hints = (cfg && cfg.nameHints) || {};
  const roleTable = { ...DEFAULT_ROLE_NAMES, ...(hints.roles || {}) };
  const notes = [];
  let name = null, src = null, role = null;
  const votes = new Map();
  for (const m of core.members) votes.set(m.v.role, (votes.get(m.v.role) || 0) + 1);
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && roleTable[top[0]]) { name = roleTable[top[0]]; src = 'role'; role = top[0]; }
  if (!name) {
    const ids = [];
    for (const m of core.members) {
      const mm = /#([A-Za-z][A-Za-z0-9_-]*)/.exec(m.v.n.name || '');
      if (mm) ids.push(mm[1].replace(/[-_]?[0-9a-f]{6,}.*$/i, '').replace(/[-_]?\d+$/g, ''));
    }
    if (ids.length >= core.members.length * 0.5) {
      const p = lcp(ids).replace(/[-_]+$/, '');
      if (p.length >= 3) { name = title(p); src = 'aria'; }
    }
  }
  if (!name) {
    const g = shapeGuess(core, hints.shapes);
    if (g) { name = g; src = 'shape'; }
  }
  if (!name) {
    if (top && !GENERIC.has(top[0])) { name = title(top[0]); src = 'role'; notes.push('role not in table'); }
  }
  if (!name) { name = 'Component ' + hashStr(core.leader.dg.S, 4); src = 'hash'; }
  let group = (hints.groups || {})[name] || GROUP_BY_NAME[name] || 'Other';
  let full = name;
  if (name.includes('/')) group = name.split('/')[0].trim();
  let k = 1, base = full;
  while (taken.has(full)) { k++; full = `${base} ${k}`; }
  if (k > 1) notes.push(`name collision: ${base} -> ${full}`);
  taken.add(full);
  return { name: full, group, nameSource: src, notes, baseName: base };
}
