#!/usr/bin/env node
// The root README is copied into packages that live in a subdirectory
// (`ruflo/`, `v3/@claude-flow/cli/`). npmjs.com resolves a README's relative
// URLs against `repository.directory`, so `docs/assets/x.svg` became
// `ruflo/docs/assets/x.svg` and every relative image and link on those package
// pages 404ed. Rewrite them to absolute GitHub URLs pinned to the commit being
// published, so the page shows what that release shipped.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const REPO = 'ruvnet/ruflo';
const IMAGE_EXT = /\.(svg|png|gif|jpe?g|webp|avif)$/i;

function isRelative(url) {
  return url !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url);
}

function absolutize(url, ref) {
  if (!isRelative(url)) return url;
  const [path, hash = ''] = url.replace(/^\.\//, '').split(/(?=#)/);
  const base = IMAGE_EXT.test(path)
    ? `https://raw.githubusercontent.com/${REPO}/${ref}/`
    : `https://github.com/${REPO}/blob/${ref}/`;
  return base + path + hash;
}

export function absolutizeReadme(markdown, ref) {
  if (!ref) throw new Error('absolutizeReadme: ref is required');
  return markdown
    // HTML attributes: <img src>, <a href>, <source srcset> (single URL).
    .replace(/\b(src|href|srcset)="([^"]*)"/g, (m, attr, url) => `${attr}="${absolutize(url.trim(), ref)}"`)
    // Markdown links and images: [text](url) / ![alt](url "title").
    .replace(/\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g, (m, url, title = '') => `](${absolutize(url, ref)}${title})`);
}

export function resolveRef(repoRoot) {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const sha = git.status === 0 ? git.stdout.trim() : '';
  if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '')) return process.env.GITHUB_SHA;
  return 'main';
}

export async function stageReadme(repoRoot, sourcePath, destPath) {
  const ref = resolveRef(repoRoot);
  const text = await readFile(sourcePath, 'utf8');
  await writeFile(destPath, absolutizeReadme(text, ref));
  return ref;
}

