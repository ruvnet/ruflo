#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageReadme } from '../../scripts/readme-absolute-urls.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..');
// npm resolves relative README URLs against repository.directory ("ruflo"),
// so stage the root README with absolute, commit-pinned URLs.
await stageReadme(repoRoot, resolve(repoRoot, 'README.md'), resolve(packageDir, 'README.md'));
