// Zero-dependency JSON Schema (draft 2020-12 subset) validator for docs/ds-schema/*.schema.json.
// Supported keywords: $ref ($defs / JSON pointer / other schema files in the same folder), type, enum, const, properties,
// patternProperties, additionalProperties, required, items, prefixItems, minItems, maxItems, uniqueItems, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, multipleOf, minLength, maxLength, pattern, minProperties, allOf, anyOf, oneOf, not, if/then/else,
// propertyNames, contains. Annotation keywords ($schema, $id, title, description, default, examples, format, $comment) are ignored.
// The schemas also work unchanged with ajv (2020 build) if a consumer prefers it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/ds-schema');

/** short name -> schema file */
export const SCHEMAS = {
  node: 'node.schema.json',
  cmp: 'cmp.schema.json',
  tok: 'tok.schema.json',
  'screen-file': 'screen-file.schema.json',
  library: 'library.schema.json',
  inventory: 'inventory.schema.json',
  config: 'config.schema.json',
  tokens: 'tokens.schema.json',
  decisions: 'decisions.schema.json',
};

const cache = new Map();
export function loadSchema(name) {
  const file = SCHEMAS[name] || (name.endsWith('.json') ? name : null);
  if (!file) throw new Error(`unknown schema "${name}" (known: ${Object.keys(SCHEMAS).join(', ')})`);
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8')));
  return cache.get(file);
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

function resolveRef(ref, ctx) {
  const [file, frag = ''] = ref.split('#');
  let doc = ctx.root;
  if (file) doc = loadSchema(path.basename(file));
  let node = doc;
  const parts = frag.split('/').filter(Boolean).map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  for (const p of parts) {
    node = node && node[p];
    if (node === undefined) throw new Error(`unresolvable $ref ${ref}`);
  }
  return { schema: node, root: doc };
}

function check(schema, data, ctx, at, errs) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { errs.push({ path: at, message: 'schema is false' }); return; }
  const fail = (message) => errs.push({ path: at || '/', message });

  if (schema.$ref) {
    const r = resolveRef(schema.$ref, ctx);
    check(r.schema, data, { root: r.root }, at, errs);
  }
  if (schema.allOf) for (const s of schema.allOf) check(s, data, ctx, at, errs);
  if (schema.anyOf) {
    const trials = schema.anyOf.map((s) => { const e = []; check(s, data, ctx, at, e); return e; });
    if (!trials.some((e) => e.length === 0)) {
      const best = trials.reduce((a, b) => (b.length < a.length ? b : a));
      fail(`does not match any of ${trials.length} alternatives (closest: ${best[0] ? best[0].path + ' ' + best[0].message : '?'})`);
    }
  }
  if (schema.oneOf) {
    const trials = schema.oneOf.map((s) => { const e = []; check(s, data, ctx, at, e); return e; });
    const n = trials.filter((e) => e.length === 0).length;
    if (n !== 1) {
      const best = trials.reduce((a, b) => (b.length < a.length ? b : a));
      fail(n === 0 ? `does not match any of ${trials.length} alternatives (closest: ${best[0] ? best[0].path + ' ' + best[0].message : '?'})` : `matches ${n} alternatives, expected exactly 1`);
    }
  }
  if (schema.not) { const e = []; check(schema.not, data, ctx, at, e); if (e.length === 0) fail('must not match the "not" schema'); }
  if (schema.if) {
    const e = []; check(schema.if, data, ctx, at, e);
    if (e.length === 0 && schema.then) check(schema.then, data, ctx, at, errs);
    if (e.length > 0 && schema.else) check(schema.else, data, ctx, at, errs);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(data, t))) { fail(`expected ${types.join('|')}, got ${typeOf(data)}`); return; }
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, data))) fail(`must be one of ${JSON.stringify(schema.enum)}`);
  if ('const' in schema && !deepEqual(schema.const, data)) fail(`must equal ${JSON.stringify(schema.const)}`);

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) fail(`must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) fail(`must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) fail(`must be < ${schema.exclusiveMaximum}`);
    if (schema.multipleOf !== undefined && Math.abs(data / schema.multipleOf - Math.round(data / schema.multipleOf)) > 1e-9) fail(`must be a multiple of ${schema.multipleOf}`);
  }
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && [...data].length < schema.minLength) fail(`length must be >= ${schema.minLength}`);
    if (schema.maxLength !== undefined && [...data].length > schema.maxLength) fail(`length must be <= ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) fail(`must match /${schema.pattern}/`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) fail(`needs >= ${schema.minItems} items`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) fail(`needs <= ${schema.maxItems} items`);
    if (schema.uniqueItems && data.some((x, i) => data.findIndex((y) => deepEqual(x, y)) !== i)) fail('items must be unique');
    const pre = schema.prefixItems || [];
    pre.forEach((s, i) => { if (i < data.length) check(s, data[i], ctx, `${at}/${i}`, errs); });
    if (schema.items !== undefined) for (let i = pre.length; i < data.length; i++) check(schema.items, data[i], ctx, `${at}/${i}`, errs);
    if (schema.contains && !data.some((x) => { const e = []; check(schema.contains, x, ctx, at, e); return e.length === 0; })) fail('no item matches "contains"');
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail(`needs >= ${schema.minProperties} properties`);
    for (const r of schema.required || []) if (!(r in data)) fail(`missing required property "${r}"`);
    if (schema.propertyNames) for (const k of keys) check(schema.propertyNames, k, ctx, `${at}/${k}`, errs);
    const props = schema.properties || {};
    const pats = Object.keys(schema.patternProperties || {}).map((p) => [new RegExp(p, 'u'), schema.patternProperties[p]]);
    for (const k of keys) {
      let matched = false;
      if (k in props) { matched = true; check(props[k], data[k], ctx, `${at}/${k}`, errs); }
      for (const [re, s] of pats) if (re.test(k)) { matched = true; check(s, data[k], ctx, `${at}/${k}`, errs); }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errs.push({ path: `${at}/${k}`, message: 'additional property not allowed' });
        else check(schema.additionalProperties, data[k], ctx, `${at}/${k}`, errs);
      }
    }
  }
}

/**
 * validate('library', data) -> { ok: boolean, errors: [{path, message}] }
 * `schemaName` is a key of SCHEMAS, a file name in docs/ds-schema, or a schema object.
 * Errors are capped at `max` (default 50).
 */
export function validate(schemaName, data, { max = 50 } = {}) {
  const schema = typeof schemaName === 'object' ? schemaName : loadSchema(schemaName);
  const errs = [];
  check(schema, data, { root: schema }, '', errs);
  return { ok: errs.length === 0, errors: errs.slice(0, max).map((e) => ({ path: e.path || '/', message: e.message })), total: errs.length };
}

/** validate or throw an Error listing the first errors. */
export function assertValid(schemaName, data, label = '') {
  const r = validate(schemaName, data);
  if (!r.ok) throw new Error(`${label || schemaName}: ${r.total} schema error(s)\n` + r.errors.slice(0, 10).map((e) => `  ${e.path}: ${e.message}`).join('\n'));
  return true;
}

export const formatErrors = (r, limit = 10) => r.errors.slice(0, limit).map((e) => `  ${e.path}: ${e.message}`).join('\n') + (r.total > limit ? `\n  ... ${r.total - limit} more` : '');
