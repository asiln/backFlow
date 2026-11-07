// Human readable report for tokens.mjs (--report). Plain text, no app content other than keys and counts.
const STATUSES = ['bound', 'create', 'review', 'off-scale', 'skip'];
const FAMILIES = [['colors', 'colours'], ['gradients', 'gradients'], ['textStyles', 'text styles'], ['radii', 'radii'], ['spacing', 'spacing'], ['effects', 'effects'], ['sizes', 'sizes']];
const pad = (s, n) => String(s).padEnd(n);
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : 'n/a');

/** Share of colour uses that map to a Tailwind token, per role (uses = node-field counts). */
export function tailwindCoverage(tokens) {
  const out = {};
  for (const c of tokens.colors) {
    const o = (out[c.role] ||= { uses: 0, tailwind: 0, bound: 0, live: 0 });
    o.uses += c.count;
    if (c.tailwind) o.tailwind += c.count;
    if (c.status === 'bound') o.bound += c.count;
    if (['bound', 'create', 'review'].includes(c.status)) o.live += c.count;
  }
  return out;
}

export function renderReport(tokens, stats = null, opts = {}) {
  const top = opts.top ?? 8;
  const L = [];
  L.push(`Tokens report  (${tokens.source.files} file(s), ${tokens.source.screens} screens, ${tokens.source.nodes} nodes)`);
  L.push('');
  L.push(pad('family', 14) + pad('distinct', 10) + STATUSES.map((s) => pad(s, 11)).join(''));
  for (const [k, label] of FAMILIES) {
    const arr = tokens[k] || [];
    L.push(pad(label, 14) + pad(arr.length, 10) + STATUSES.map((s) => pad(arr.filter((e) => e.status === s).length, 11)).join(''));
  }
  L.push('');
  L.push('Colour uses by role (uses mapped to a Tailwind token / bound to an existing variable / will be tokenised):');
  for (const [role, o] of Object.entries(tailwindCoverage(tokens))) {
    L.push(`  ${pad(role, 14)} uses ${pad(o.uses, 8)} tailwind ${pad(pct(o.tailwind, o.uses), 7)} bound ${pad(pct(o.bound, o.uses), 7)} live ${pct(o.live, o.uses)}`);
  }
  for (const [k, label] of FAMILIES) {
    const arr = (tokens[k] || []).slice(0, top);
    if (!arr.length) continue;
    L.push('', `Most used ${label}:`);
    for (const e of arr) L.push(`  ${pad(e.key + (e.role ? ' [' + e.role + ']' : ''), 54)} ${pad(e.count, 8)} ${pad(e.screens + ' scr', 9)} ${e.status}${e.tailwind ? '  ' + e.tailwind : ''}`);
  }
  const off = [...(tokens.radii || []), ...(tokens.spacing || [])].filter((e) => e.status === 'off-scale');
  L.push('', `Off-scale values (${off.length}):`);
  for (const e of off.slice(0, 40)) L.push(`  ${pad(e.key, 12)} ${pad(e.count + 'x', 8)} nearest ${e.nearest || 'none'}`);
  const review = [...tokens.colors, ...tokens.gradients, ...tokens.textStyles, ...tokens.radii, ...tokens.spacing, ...tokens.effects].filter((e) => e.status === 'review');
  L.push('', `Review items (${review.length}):`);
  for (const e of review.slice(0, 40)) L.push(`  ${e.key}${e.role ? ' [' + e.role + ']' : ''}  ${(e.candidates || []).map((c) => c.name).join(', ')}`);
  const merged = tokens.colors.filter((e) => e.members).length + tokens.textStyles.filter((e) => e.members).length;
  L.push('', `Snapped: ${merged} leader(s) absorbed near-equal values.`);
  if (stats) {
    L.push(`Not tokenised: ${stats.blur} layer-blur and ${stats.bblur} backdrop-blur node(s); ${stats.strokeWeights.size} distinct stroke weight(s).`);
    if (stats.twUnresolved) L.push(`Tailwind colours left unresolved (CSS variables?): ${stats.twUnresolved}. Pass --css-vars <file.css>.`);
  }
  L.push('', `Findings (${tokens.findings.length}):`);
  for (const f of tokens.findings.slice(0, 60)) L.push('  ' + f);
  if (tokens.findings.length > 60) L.push(`  ... ${tokens.findings.length - 60} more in tokens.json`);
  return L.join('\n') + '\n';
}
