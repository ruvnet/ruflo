#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutizeReadme } from '../readme-absolute-urls.mjs';

const ref = '0123456789abcdef0123456789abcdef01234567';
const raw = `https://raw.githubusercontent.com/ruvnet/ruflo/${ref}/`;
const blob = `https://github.com/ruvnet/ruflo/blob/${ref}/`;

const cases = [
  ['<img src="docs/assets/a.svg" alt="a">', `<img src="${raw}docs/assets/a.svg" alt="a">`],
  ['<img src="./ruflo/assets/b.gif">', `<img src="${raw}ruflo/assets/b.gif">`],
  ['<source srcset="docs/m.svg">', `<source srcset="${raw}docs/m.svg">`],
  ['<a href="docs/compare.md">x</a>', `<a href="${blob}docs/compare.md">x</a>`],
  ['<a href="plugins/p/README.md#usage">x</a>', `<a href="${blob}plugins/p/README.md#usage">x</a>`],
  ['![a](docs/assets/c.jpg)', `![a](${raw}docs/assets/c.jpg)`],
  ['![a](docs/c.png "Title")', `![a](${raw}docs/c.png "Title")`],
  ['[![a](docs/i.svg)](docs/guide.md)', `[![a](${raw}docs/i.svg)](${blob}docs/guide.md)`],
  ['[d](docs/)', `[d](${blob}docs/)`],
];
for (const [input, expected] of cases) assert.equal(absolutizeReadme(input, ref), expected, input);

// Absolute, anchor, mailto, protocol-relative and root-relative targets are untouched.
const untouched = [
  '<img src="https://img.shields.io/badge/x-y-z">',
  '<a href="#install">x</a>',
  '[mail](mailto:a@b.c)',
  '[h](https://github.com/ruvnet/ruflo)',
  '[s](//cdn.example.com/x.js)',
  '[r](/abs/path)',
  '[anchor](#quick-start)',
];
for (const input of untouched) assert.equal(absolutizeReadme(input, ref), input, input);

assert.throws(() => absolutizeReadme('x', ''), /ref is required/);

// The real README must have no relative image or link left after rewriting.
const here = dirname(fileURLToPath(import.meta.url));
const out = absolutizeReadme(readFileSync(resolve(here, '..', '..', 'README.md'), 'utf8'), ref);
const leftovers = [
  ...out.matchAll(/\b(?:src|href|srcset)="(?![a-z][a-z0-9+.-]*:|#|\/)([^"]+)"/gi),
  ...out.matchAll(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)/gi),
].map((m) => m[1]);
assert.deepEqual(leftovers, [], `relative URLs left in README: ${leftovers.join(', ')}`);

console.log(`readme-absolute-urls: ${cases.length + untouched.length + 2} checks passed`);
