import { getErrorMessage } from '../utils/error-handler.js';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getGeminiFlowRoot(): string {
  // Try multiple strategies to find the root
  const strategies = [
    // Strategy 1: From current file location
    resolve(__dirname, '../..'),
    // Strategy 2: From process.cwd()
    process.cwd(),
    // Strategy 3: From npm global location
    resolve(process.execPath, '../../lib/node_modules/gemini-flow'),
    // Strategy 4: From environment variable
    process.env.GEMINI_FLOW_ROOT || ''
  ];

  for (const path of strategies) {
    if (path && existsSync(join(path, 'package.json'))) {
      try {
        const pkg = require(join(path, 'package.json'));
        if (pkg.name === 'gemini-flow') {
          return path;
        }
      } catch {}
    }
  }

  // Fallback to current working directory
  return process.cwd();
}

export function getGeminiFlowBin(): string {
  return join(getGeminiFlowRoot(), 'bin', 'gemini-flow');
}

export function resolveProjectPath(relativePath: string): string {
  const root = getGeminiFlowRoot();
  return resolve(root, relativePath);
}