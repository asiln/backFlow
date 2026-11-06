// node tools/dbg.mjs raw.json  -> runs normalize with debug output on failing containers
import fs from 'fs';
import { normalize, summarize } from '../normalize.mjs';
import { layoutBox } from '../layout-sim.mjs';
const tree = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const f = (v) => Math.round(v * 10) / 10;
const res = normalize(tree, { debug(N, attempt, lvl, bad, st) {
  console.log(`FAIL ${lvl} a${attempt} ${N.name} [${f(N.w)}x${f(N.h)}] k=${N.ls.k} pa=${N.ls.pa} ca=${N.ls.ca} g=${N.ls.g} p=${N.ls.p}`);
  for (const k of bad) console.log(`   bad ${k.t} ${k.name || ''} "${(k.text || '').slice(0, 14)}" exp[${f(k.x)},${f(k.y)} ${f(k.w)}x${f(k.h)}] s=${k.ls && k.ls.s} sim=${(k.__sim||[]).map(f)}`);
} });
console.log(JSON.stringify(summarize(res.stats)));
