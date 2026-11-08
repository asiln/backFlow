// Confidence score (spec 1.9) and bands. nameSource weights: owner/ds 1, role/aria 0.9, shape 0.7, hash 0.5 (styled) | 0.2.
const SEM = { owner: 1, ds: 1, role: 0.9, aria: 0.9, shape: 0.7 };

export function confidence(c) {
  const rep = Math.min(1, Math.log2(Math.max(1, c.occ)) / 3);
  const cross = Math.min(1, c.screens / 4) * (c.files >= 2 ? 1 : 0.7);
  const size = c.nodes < 3 ? 0.3 : c.nodes > 80 ? 0.5 : 1;
  const cohesion = 1 - Math.min(1, (c.meanDev || 0) / 4);
  const semantic = SEM[c.nameSource] ?? (c.styled ? 0.5 : 0.2);
  let v = 100 * (0.22 * rep + 0.18 * cross + 0.10 * size + 0.25 * cohesion + 0.25 * semantic);
  if (c.hasAbsKids) v -= 10;
  if (c.dataShaped) v -= 25;
  if (c.textOverflowRisk) v -= 10;
  return Math.max(0, Math.round(v));
}

/** >= 80 auto, minConf..79 review, below: report-only (null). */
export const bandOf = (conf, minConf = 55) => (conf >= 80 ? 'auto' : conf >= minConf ? 'review' : null);
