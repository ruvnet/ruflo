#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const failures = [];

if (typeof packageJson.main !== 'string' || packageJson.main.length === 0) {
  failures.push('package.json main field is missing.');
} else {
  const mainPath = path.resolve(repoRoot, packageJson.main);
  if (!fs.existsSync(mainPath)) {
    failures.push(`package.json main points to a missing path: ${packageJson.main}`);
  }
}

const devScript = packageJson.scripts?.dev;
if (typeof devScript !== 'string' || devScript.length === 0) {
  failures.push('package.json scripts.dev is missing.');
} else if (devScript.includes('src/index.ts')) {
  failures.push('scripts.dev still points to missing src/index.ts.');
}

if (failures.length > 0) {
  console.error('Root entrypoint contract verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Root entrypoint contract verification passed.');
