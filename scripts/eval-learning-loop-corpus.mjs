#!/usr/bin/env node
/**
 * ADR-511 §5: the corpus for scripts/eval-learning-loop.mjs ($0, no model call):
 *   node scripts/eval-learning-loop-corpus.mjs --out <dir> [--train 3] [--eval 6]
 * One small Node project ("the shop"), five features. Each feature's public module (src/money.js, src/slug.js, ...)
 * resolves its core step through src/registry.js and config/registry.json, so the code that decides the behaviour
 * lives in a file whose name says little (src/ext/half-even.js for money rounding) next to an unused module whose name
 * says a lot (src/ext/round.js). That is the kind of project-specific "where the fix goes" knowledge a lesson can
 * carry and a prompt does not: the prompts describe a symptom and name no file.
 *
 * A fixture is the whole project with ONE bug planted in one feature's real core file. Per feature, the first
 * --train mutations form the training split and the next --eval the evaluation split, so no eval fixture is a train
 * fixture. Each task's check is a hidden copy of all five feature specs, run from outside the fixture, so a run that
 * edits a visible test, or breaks another feature, does not pass. Validated as written: the clean project passes
 * every hidden spec, and every planted bug fails its own feature's spec (one that does not is an error).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REGISTRY_JSON = { rounding: 'halfEven', fold: 'fold', window: 'span', tokenize: 'lexer', combine: 'overlay' };

const SHARED = {
  'package.json': JSON.stringify({ name: 'shop', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'README.md': '# shop\n\nInvoices, catalogue slugs, listing pages, CSV imports and layered config.\n',
  'config/registry.json': JSON.stringify(REGISTRY_JSON, null, 2) + '\n',
  'src/registry.js': `import { readFileSync } from 'node:fs';
import * as ext from './ext/index.js';

const table = JSON.parse(readFileSync(new URL('../config/registry.json', import.meta.url), 'utf8'));

/** The implementation configured for a step. */
export function get(step) {
  const name = table[step];
  const impl = name && ext[name];
  if (typeof impl !== 'function') throw new Error(\`no implementation for \${step}\`);
  return impl;
}
`,
  'src/ext/index.js': `export { default as halfEven } from './half-even.js';
export { default as round } from './round.js';
export { default as fold } from './fold.js';
export { default as translit } from './translit.js';
export { default as span } from './span.js';
export { default as pages } from './pages.js';
export { default as lexer } from './lexer.js';
export { default as csvSplit } from './csv-split.js';
export { default as overlay } from './overlay.js';
export { default as deepMerge } from './deep-merge.js';
`,
  // Unused (not in config/registry.json): kept for "older callers".
  'src/ext/round.js': `/** Rounds half away from zero to \`decimals\` places. */
export default function round(value, decimals) {
  const f = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * f) / f;
}
`,
  'src/ext/translit.js': `const TABLE = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };

/** German-style transliteration. */
export default function translit(s) {
  return [...s].map(c => TABLE[c] ?? c).join('');
}
`,
  'src/ext/pages.js': `/** Every page number from 1 to \`count\`. */
export default function pages(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i + 1);
}
`,
  'src/ext/csv-split.js': `/** Splits a CSV line on the separator (no quoting support). */
export default function csvSplit(line, sep = ',') {
  return line.split(sep);
}
`,
  'src/ext/deep-merge.js': `/** Recursively merges plain objects. */
export default function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = typeof b[k] === 'object' && b[k] && typeof a[k] === 'object' ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
`,
  'src/money.js': `import { get } from './registry.js';

const CURRENCIES = { USD: { symbol: '$', decimals: 2 }, EUR: { symbol: '€', decimals: 2 }, JPY: { symbol: '¥', decimals: 0 }, KWD: { symbol: 'KD ', decimals: 3 } };

/** "$1,234.56": rounded with the configured rounding step, grouped by thousands. */
export function formatMoney(amount, currency) {
  const c = CURRENCIES[currency];
  if (!c) throw new Error(\`unknown currency \${currency}\`);
  const rounded = get('rounding')(Math.abs(amount), c.decimals);
  const [int, frac] = rounded.toFixed(c.decimals).split('.');
  const grouped = int.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return \`\${amount < 0 && rounded !== 0 ? '-' : ''}\${c.symbol}\${grouped}\${frac ? '.' + frac : ''}\`;
}
`,
  'src/slug.js': `import { get } from './registry.js';

/** A URL slug: folded to ASCII, lower case, runs of anything else as one dash. */
export function slugify(title) {
  return get('fold')(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
`,
  'src/listing.js': `import { get } from './registry.js';

/** The page links and item range for page \`page\` of \`total\` items, \`size\` per page, at most \`width\` links. */
export function paginate(total, page, size, width = 5) {
  const count = Math.ceil(total / size);
  const current = Math.min(Math.max(1, page), Math.max(1, count));
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(total, current * size);
  return { count, current, from, to, links: get('window')(current, count, width) };
}
`,
  'src/importer.js': `import { get } from './registry.js';

/** Rows of fields; CRLF or LF line ends, a trailing newline adds no row. */
export function parseCsv(text, { sep = ',' } = {}) {
  const lines = text.split(/\\r?\\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.map(line => get('tokenize')(line, sep));
}
`,
  'src/settings.js': `import { get } from './registry.js';

/** Defaults overlaid by each layer in turn; no layer is changed. */
export function loadConfig(defaults, ...layers) {
  return layers.reduce((acc, layer) => get('combine')(acc, layer), defaults);
}
`,
};

/** Each feature: its real core file (correct), the planted bugs (find → replace), the spec, and symptom prompts. */
const FEATURES = [
  {
    id: 'money',
    file: 'src/ext/half-even.js',
    source: `/** Rounds to \`decimals\` places, ties to the even neighbour (banker's rounding). */
export default function halfEven(value, decimals) {
  const f = 10 ** decimals;
  const n = Math.round(value * f * 1e6) / 1e6;
  const floor = Math.floor(n);
  const diff = n - floor;
  let r;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / f;
}
`,
    bugs: [
      ['if (diff > 0.5)', 'if (diff >= 0.5)'],
      ['floor % 2 === 0 ? floor', 'floor % 2 === 1 ? floor'],
      ['10 ** decimals', '10 ** (decimals + 1)'],
      ['else if (diff < 0.5) r = floor;', 'else if (diff < 0.5) r = floor + (diff > 0.25 ? 1 : 0);'],
      ['return r / f;', 'return Math.trunc(r / f);'],
      ['* 1e6) / 1e6', '* 1e1) / 1e1'],
      [': floor + 1;\n  return', ': floor;\n  return'],
      ['if (diff > 0.5) r = floor + 1;', 'if (diff > 0.5) r = floor + 2;'],
      ['const floor = Math.floor(n);', 'const floor = Math.floor(n) - (n > 1000 ? 1 : 0);'],
    ],
    spec: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '$SRC/money.js';

test('money: plain amounts', () => {
  assert.equal(formatMoney(0, 'USD'), '$0.00');
  assert.equal(formatMoney(19.99, 'EUR'), '€19.99');
  assert.equal(formatMoney(1234567.891, 'USD'), '$1,234,567.89');
  assert.equal(formatMoney(-42.1, 'USD'), '-$42.10');
});
test('money: ties go to the even cent', () => {
  assert.equal(formatMoney(2.5, 'JPY'), '¥2');
  assert.equal(formatMoney(3.5, 'JPY'), '¥4');
  assert.equal(formatMoney(0.125, 'USD'), '$0.12');
  assert.equal(formatMoney(0.135, 'USD'), '$0.14');
  assert.equal(formatMoney(1.0005, 'KWD'), 'KD 1.000');
});
test('money: non-ties round to nearest', () => {
  assert.equal(formatMoney(2.6, 'JPY'), '¥3');
  assert.equal(formatMoney(2.4, 'JPY'), '¥2');
  assert.equal(formatMoney(10.126, 'USD'), '$10.13');
  assert.equal(formatMoney(10.1251, 'USD'), '$10.13');
  assert.equal(formatMoney(1234.5671, 'KWD'), 'KD 1,234.567');
});
`,
    prompts: [
      'Some invoice amounts are formatted with the wrong cents: formatMoney rounds certain prices incorrectly. Find the cause and fix it. Run npm test to confirm.',
      'Customers report invoice totals that are a cent off. formatMoney is producing wrong amounts for some prices; please fix the rounding problem and run npm test.',
      'formatMoney output is wrong for some invoice prices (rounding). Track down the bug, fix it, and confirm with npm test.',
    ],
  },
  {
    id: 'slug',
    file: 'src/ext/fold.js',
    source: `const MAP = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'œ': 'oe', 'đ': 'd', 'ł': 'l', '&': ' and ' };

/** Folds text to plain ASCII letters: accents dropped, special letters spelled out. */
export default function fold(s) {
  let out = '';
  for (const ch of s.normalize('NFD')) {
    if (/[\\u0300-\\u036f]/.test(ch)) continue;
    const low = ch.toLowerCase();
    out += MAP[low] ?? ch;
  }
  return out;
}
`,
    bugs: [
      ["'ß': 'ss'", "'ß': 's'"],
      ["'æ': 'ae'", "'æ': 'a'"],
      ["'&': ' and '", "'&': 'and'"],
      ["s.normalize('NFD')", "s.normalize('NFC')"],
      ['\\u036f', '\\u0301'],
      ['MAP[low] ?? ch', 'MAP[ch] ?? ch'],
      ["'œ': 'oe'", "'œ': 'o'"],
      ["'ł': 'l', ", ''],
      ["'đ': 'd'", "'đ': 'dj'"],
    ],
    spec: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '$SRC/slug.js';

test('slug: plain titles', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  --Spring  Sale 2026!! '), 'spring-sale-2026');
});
test('slug: accents are dropped', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  assert.equal(slugify('Ångström Ölmühle'), 'angstrom-olmuhle');
  assert.equal(slugify('Ça̧ va'), 'ca-va');
});
test('slug: special letters are spelled out', () => {
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('Æther'), 'aether');
  assert.equal(slugify('Œuvre'), 'oeuvre');
  assert.equal(slugify('Ørsted'), 'orsted');
  assert.equal(slugify('Łódź'), 'lodz');
  assert.equal(slugify('Đakovo'), 'dakovo');
  assert.equal(slugify('Rock & Roll'), 'rock-and-roll');
  assert.equal(slugify('R&B Classics'), 'r-and-b-classics');
});
`,
    prompts: [
      'Catalogue URLs come out wrong for product titles with accents or special letters (slugify). Find the cause and fix it, then run npm test.',
      'slugify produces bad catalogue slugs for some international product titles. Please fix the bug and confirm with npm test.',
      'Some product page slugs are mangled when titles contain letters like ß or æ, or accents. Fix slugify and run npm test to check.',
    ],
  },
  {
    id: 'listing',
    file: 'src/ext/span.js',
    source: `/** At most \`width\` consecutive page numbers around \`current\`, inside 1..\`count\`. */
export default function span(current, count, width) {
  if (count <= 0) return [];
  const half = Math.floor(width / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(count, start + width - 1);
  start = Math.max(1, end - width + 1);
  const out = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}
`,
    bugs: [
      ['Math.floor(width / 2)', 'Math.ceil(width / 2)'],
      ['start + width - 1', 'start + width'],
      ['end - width + 1)', 'end - width)'],
      ['p <= end', 'p < end'],
      ['Math.max(1, current - half)', 'Math.max(0, current - half)'],
      ['const half = Math.floor(width / 2);', 'const half = Math.floor(width / 2) + (width % 2 === 0 ? 1 : 0);'],
      ['Math.min(count, start', 'Math.max(count, start'],
      ['  start = Math.max(1, end - width + 1);\n', ''],
      ['let start = Math.max(1, current - half);', 'let start = Math.max(1, current - half + 1);'],
    ],
    spec: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '$SRC/listing.js';

test('listing: item range', () => {
  assert.deepEqual([paginate(95, 1, 10).from, paginate(95, 1, 10).to], [1, 10]);
  assert.deepEqual([paginate(95, 10, 10).from, paginate(95, 10, 10).to], [91, 95]);
  assert.equal(paginate(95, 1, 10).count, 10);
});
test('listing: page links stay centred and in range', () => {
  assert.deepEqual(paginate(95, 1, 10).links, [1, 2, 3, 4, 5]);
  assert.deepEqual(paginate(95, 2, 10).links, [1, 2, 3, 4, 5]);
  assert.deepEqual(paginate(95, 5, 10).links, [3, 4, 5, 6, 7]);
  assert.deepEqual(paginate(95, 10, 10).links, [6, 7, 8, 9, 10]);
  assert.deepEqual(paginate(95, 6, 10, 4).links, [4, 5, 6, 7]);
});
test('listing: short and empty lists', () => {
  assert.deepEqual(paginate(25, 2, 10).links, [1, 2, 3]);
  assert.deepEqual(paginate(5, 1, 10).links, [1]);
  assert.deepEqual(paginate(0, 1, 10).links, []);
});
`,
    prompts: [
      'The page links under product listings are wrong on some pages (paginate). Find the cause and fix it, then run npm test.',
      'Listing pagination shows the wrong set of page-number links in some cases. Please fix paginate and confirm with npm test.',
      'Users see odd page links in the listing pager: paginate returns the wrong links for some pages. Fix it and run npm test.',
    ],
  },
  {
    id: 'importer',
    file: 'src/ext/lexer.js',
    source: `/** The fields of one CSV line: quoted fields may hold the separator, "" is a literal quote. */
export default function lexer(line, sep = ',') {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
`,
    bugs: [
      ["if (line[i + 1] === '\"')", "if (line[i + 2] === '\"')"],
      ["cur += '\"';\n          i++;", "cur += '\"\"';\n          i++;"],
      ['} else quoted = false;', '} else quoted = true;'],
      ['else if (c === sep)', "else if (c === ',')"],
      ['  out.push(cur);\n  return out;', '  if (cur) out.push(cur);\n  return out;'],
      ['      out.push(cur);\n      cur = \'\';', '      out.push(cur.trim());\n      cur = \'\';'],
      ["      cur = '';\n", "      cur = cur.trim() ? '' : cur;\n"],
      ['for (let i = 0; i < line.length; i++)', 'for (let i = 0; i < line.length - 1; i++)'],
      ['} else cur += c;\n    } else if', '} else if (c !== \' \') cur += c;\n    } else if'],
    ],
    spec: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '$SRC/importer.js';

test('importer: plain fields and line ends', () => {
  assert.deepEqual(parseCsv('a,b,c\\n1,2,3\\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,b\\r\\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('a,,b'), [['a', '', 'b']]);
  assert.deepEqual(parseCsv('a,'), [['a', '']]);
  assert.deepEqual(parseCsv(',x'), [['', 'x']]);
  assert.deepEqual(parseCsv(' a , b'), [[' a ', ' b']]);
  assert.deepEqual(parseCsv(' ,x'), [[' ', 'x']]);
});
test('importer: quoting', () => {
  assert.deepEqual(parseCsv('"a,b",c'), [['a,b', 'c']]);
  assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]);
  assert.deepEqual(parseCsv('"",z'), [['', 'z']]);
  assert.deepEqual(parseCsv('x,"two words"'), [['x', 'two words']]);
  assert.deepEqual(parseCsv('"a ""b"" c"'), [['a "b" c']]);
});
test('importer: other separators', () => {
  assert.deepEqual(parseCsv('a;b;"c;d"', { sep: ';' }), [['a', 'b', 'c;d']]);
  assert.deepEqual(parseCsv('a\\tb', { sep: '\\t' }), [['a', 'b']]);
});
`,
    prompts: [
      'The product CSV import mis-reads some rows (parseCsv): fields come out split or merged wrongly. Find the cause and fix it, then run npm test.',
      'parseCsv returns wrong fields for some import files, especially with quotes or other separators. Please fix it and confirm with npm test.',
      'Our CSV importer garbles certain rows. Fix the parsing bug in parseCsv and run npm test.',
    ],
  },
  {
    id: 'settings',
    file: 'src/ext/overlay.js',
    source: `const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** \`top\` laid over \`base\`: plain objects merge, arrays and values replace, undefined is ignored; inputs never change. */
export default function overlay(base, top) {
  const out = { ...base };
  for (const [k, v] of Object.entries(top)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (v === undefined) continue;
    out[k] = plain(v) && plain(base[k]) ? overlay(base[k], v) : Array.isArray(v) ? [...v] : v;
  }
  return out;
}
`,
    bugs: [
      ["&& !Array.isArray(v);", ';'],
      ['if (v === undefined) continue;', 'if (v === null) continue;'],
      ["if (k === '__proto__' || k === 'constructor') continue;", ''],
      ['plain(v) && plain(base[k])', 'plain(v)'],
      ['Array.isArray(v) ? [...v] : v', 'v'],
      ['const out = { ...base };', 'const out = base;'],
      ['? overlay(base[k], v) :', '? { ...v } :'],
      ['if (v === undefined) continue;', 'if (v === undefined) { delete out[k]; continue; }'],
      ['plain(base[k]) ? overlay(base[k], v)', 'plain(base[k]) ? overlay(v, base[k])'],
    ],
    spec: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '$SRC/settings.js';

test('settings: layers merge nested objects', () => {
  const d = { db: { host: 'localhost', port: 5432, pool: { min: 1, max: 5 } }, debug: false };
  assert.deepEqual(loadConfig(d, { db: { port: 6543 } }, { db: { pool: { max: 9 } }, debug: true }), { db: { host: 'localhost', port: 6543, pool: { min: 1, max: 9 } }, debug: true });
});
test('settings: arrays and nulls replace, undefined is ignored', () => {
  assert.deepEqual(loadConfig({ tags: ['a', 'b'], x: 1, y: { z: 1 } }, { tags: ['c'], x: undefined, y: null }), { tags: ['c'], x: 1, y: null });
  assert.deepEqual(loadConfig({ x: [1, 2] }, { x: { a: 1 } }), { x: { a: 1 } });
});
test('settings: no layer or default is changed', () => {
  const d = { a: { b: 1 }, list: [1] };
  const layer = { a: { c: 2 }, list: [2] };
  const out = loadConfig(d, layer);
  out.list.push(3);
  out.a.d = 4;
  assert.deepEqual(d, { a: { b: 1 }, list: [1] });
  assert.deepEqual(layer, { a: { c: 2 }, list: [2] });
});
test('settings: a layer cannot reach the prototype', () => {
  const out = loadConfig({}, JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}'));
  assert.equal(({}).polluted, undefined);
  assert.equal(out.polluted, undefined);
  assert.equal(out.ok, 1);
});
`,
    prompts: [
      'Layered settings come out wrong: loadConfig loses or mixes up values from some layers. Find the cause and fix it, then run npm test.',
      'loadConfig gives the wrong merged config for some layer combinations. Please fix the bug and confirm with npm test.',
      'Something is off with how config layers combine in loadConfig. Track down the bug, fix it, and run npm test.',
    ],
  },
];

function args(argv) {
  const out = { out: null, train: 3, eval: 6 };
  const keys = { '--out': 'out', '--train': 'train', '--eval': 'eval' };
  for (let i = 0; i < argv.length; i++) {
    if (!keys[argv[i]]) throw new Error(`unknown argument: ${argv[i]}`);
    out[keys[argv[i]]] = argv[i] === '--out' ? argv[++i] : Number(argv[++i]);
  }
  if (!out.out) throw new Error('--out <dir> is required');
  return out;
}

function writeProject(dir, overrides = {}) {
  const files = { ...SHARED };
  for (const f of FEATURES) {
    files[f.file] = f.source;
    files[`test/${f.id}.test.mjs`] = f.spec.replace(/\$SRC/g, '../src');
  }
  Object.assign(files, overrides);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

/** Every hidden spec, importing from the fixture under test (the check's cwd). */
const hiddenSpec = (f) =>
  `import { pathToFileURL } from 'node:url';\nimport { join } from 'node:path';\n` +
  f.spec.replace(/import \{ (\w+) \} from '\$SRC\/([\w.]+)';/, (_, name, file) => `const { ${name} } = await import(pathToFileURL(join(process.cwd(), 'src', '${file}')).href);`);

const runSpecs = (cwd, specs) => spawnSync(process.execPath, ['--test', ...specs], { cwd, encoding: 'utf8', timeout: 60_000 }).status === 0;

function main() {
  const a = args(process.argv.slice(2));
  const root = resolve(a.out);
  if (existsSync(root)) throw new Error(`${root} exists; pass a new directory`);
  mkdirSync(join(root, 'hidden'), { recursive: true });
  const specs = FEATURES.map(f => join(root, 'hidden', `${f.id}.test.mjs`));
  FEATURES.forEach((f, i) => writeFileSync(specs[i], hiddenSpec(f)));

  const scratch = mkdtempSync(join(tmpdir(), 'll-corpus-'));
  writeProject(join(scratch, 'clean'));
  const clean = runSpecs(join(scratch, 'clean'), specs);
  rmSync(scratch, { recursive: true, force: true });
  if (!clean) throw new Error('the clean project fails its hidden specs');

  const tasks = { version: 1, train: [], eval: [] };
  for (const f of FEATURES) {
    if (f.bugs.length < a.train + a.eval) throw new Error(`${f.id}: ${f.bugs.length} bugs, need ${a.train + a.eval}`);
    f.bugs.slice(0, a.train + a.eval).forEach(([find, replace], i) => {
      if (!f.source.includes(find)) throw new Error(`${f.id} bug ${i}: pattern not found`);
      const id = `${f.id}-${i}`;
      const dir = join(root, 'fixtures', id);
      writeProject(dir, { [f.file]: f.source.replace(find, replace) });
      if (runSpecs(dir, [specs[FEATURES.indexOf(f)]])) throw new Error(`${id}: the planted bug does not fail its spec`);
      const split = i < a.train ? 'train' : 'eval';
      tasks[split].push({ id, prompt: f.prompts[i % f.prompts.length], fixture: `fixtures/${id}`, check: [process.execPath, '--test', ...specs] });
    });
  }
  writeFileSync(join(root, 'tasks.json'), JSON.stringify(tasks, null, 2) + '\n');
  console.log(`wrote ${tasks.train.length} train + ${tasks.eval.length} eval tasks to ${root}/tasks.json (all validated)`);
}

main();
