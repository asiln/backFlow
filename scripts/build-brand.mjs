// Builds the Backflow logo SVGs in brand/.
//   MARK                         the "b": one line whose bowl flows back into its own stem and ends in a
//                                drafting harpoon. Drawn in Archivo's font units so it sits in the
//                                wordmark as its first letter: stem width = Archivo's stem (133 units at
//                                wdth 112, wght 620), bowl = Archivo's b bowl, ascender 724, baseline 0.
//   brand/src/wordmark-ackflow.path  "ackflow" in Archivo (wdth 112, wght 620, tracking -8), outlined by
//                                brand/src/wordmark-to-path.py (fontTools); font units, baseline y=0.
// Run: node scripts/build-brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (f, s) => { fs.writeFileSync(path.join(root, 'brand', f), s.trim() + '\n'); console.log('brand/' + f); };

export const MARK = 'M134 -657.5V-263A208.5 208.5 0 1 0 342 -471.5H266L370 -575.5';
export const STROKE = 133;
export const MARK_BOX = '-78 -776 840 840'; // square, centred on the mark's ink
export const INK = { blue: '#1f4fa8', graphite: '#1b1f24', sheet: '#eef2f5', prussian: '#0f2a55', white: '#ffffff', line: '#9cc2ff' };

const round = (s) => s.replace(/-?\d+\.\d+/g, (n) => String(Math.round(parseFloat(n) * 10) / 10));
const word = round(fs.readFileSync(path.join(root, 'brand/src/wordmark-ackflow.path'), 'utf8').trim());
const B_ADV = 653, WORD_W = 4031, ASC = 724, DESC = 12;
const W = B_ADV + WORD_W;

const markEl = (stroke, extra = '') => `<path d="${MARK}" fill="none" stroke="${stroke}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const auto = (light, dark) => `<style>.s{stroke:${light}}.f{fill:${light}}@media (prefers-color-scheme:dark){.s{stroke:${dark}}.f{fill:${dark}}}</style>`;

// mark alone (favicons, avatars, plugin header)
const mark = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_BOX}" width="32" height="32"><title>Backflow</title>${markEl(c)}</svg>`;
out('backflow-mark.svg', mark(INK.blue));
out('backflow-mark-white.svg', mark(INK.white));
out('backflow-mark-auto.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_BOX}" width="32" height="32"><title>Backflow</title>${auto(INK.blue, INK.white)}<path class="s" d="${MARK}" fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

// app icon: a sheet with corner crop ticks, the mark drawn on it
const icon = (bg, fg, tick) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>Backflow</title>
<rect width="512" height="512" rx="112" fill="${bg}"/>
<g fill="none" stroke="${tick}" stroke-width="10" stroke-linecap="round" opacity=".6"><path d="M92 140V92h48M372 92h48v48M420 372v48h-48M140 420H92v-48"/></g>
<svg x="106" y="106" width="300" height="300" viewBox="${MARK_BOX}">${markEl(fg)}</svg></svg>`;
out('backflow-icon.svg', icon(INK.blue, INK.white, INK.white));
out('backflow-icon-dark.svg', icon(INK.prussian, INK.white, INK.line));

// wordmark: the mark is the "b"
const box = `0 ${-ASC - 40} ${W} ${ASC + DESC + 80}`;
const lockup = (light, dark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${Math.round(W / 16)}" height="${Math.round((ASC + DESC + 80) / 16)}"><title>Backflow</title>${auto(light, dark)}
<path class="s" d="${MARK}" fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
<path class="f" transform="translate(${B_ADV} 0)" d="${word}"/></svg>`;
out('backflow-wordmark.svg', lockup(INK.blue, INK.white));
out('backflow-wordmark-graphite.svg', lockup(INK.graphite, INK.white));
out('backflow-wordmark-white.svg', lockup(INK.white, INK.white));
