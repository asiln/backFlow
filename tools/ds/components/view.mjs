// Detector-side node views (spec 1.1): thin layer over tools/ds/common/view.mjs.
// Adds parent pointers, preorder intervals, screen bookkeeping and in-place collapsing of accepted instances.
import path from 'node:path';
import { makeView, walkView, formatPath, stableName, roleOf, INTERACTIVE_ROLES, GENERIC_ROLES, SYNTHETIC_ROLES } from '../common/view.mjs';

export { walkView, formatPath, stableName, roleOf, INTERACTIVE_ROLES, GENERIC_ROLES, SYNTHETIC_ROLES };

/** Label of an export file used in locators: 'athlete-settings' for '.../athlete-settings.figma.json'. */
export const fileLabel = (p) => path.basename(String(p)).replace(/\.figma\.json$/i, '').replace(/\.json$/i, '');

/**
 * Screen = { fi, file, idx, name, raw, root(view), area, nodes }.
 * Every view gets: parent, screen (Screen), pre (preorder index in the ORIGINAL tree), end (last descendant pre index).
 */
export function buildScreen(fi, file, frame, idx) {
  const root = makeView(frame, { file, screen: frame.name || '', screenIdx: idx });
  const screen = { fi, file, idx, name: frame.name || '', raw: frame, root, area: Math.max(1, (frame.w || 0) * (frame.h || 0)), nodes: 0, w: frame.w || 0, h: frame.h || 0 };
  let c = 0;
  (function number(v, parent) {
    v.parent = parent;
    v.scr = screen;
    v.pre = c++;
    for (const k of v.kids) number(k, v);
    v.end = c - 1;
  })(root, null);
  screen.nodes = c;
  return screen;
}

export function buildScreens(files) {
  const out = [];
  files.forEach((f, fi) => {
    const label = fileLabel(f.path || f.name || `file${fi}`);
    (f.data.frames || []).forEach((fr, idx) => out.push(buildScreen(fi, label, fr, idx)));
  });
  return out;
}

/** Preorder array of the CURRENT tree (collapsed instances are leaves). */
export function preorder(v, out = []) {
  out.push(v);
  for (const k of v.kids) preorder(k, out);
  return out;
}

/** True iff `a` is a proper ancestor of `b` (same screen, original numbering). */
export const isAncestor = (a, b) => a !== b && a.scr === b.scr && a.pre < b.pre && b.pre <= a.end;

/** Turn an accepted member into a leaf instance in place (spec 1.7: S contribution 'C:<id>'). */
export function collapseView(v, id) {
  v.inst = { id, v: null };
  v.kids = [];
}

/** Does the raw node carry an icon reference (T5 annotation)? */
export const iconIdOf = (v) => (v.t === 'svg' && v.n.cmp && v.n.cmp.kind === 'icon' ? v.n.cmp.id : null);

export const countKids = (v) => v.kids.length;
