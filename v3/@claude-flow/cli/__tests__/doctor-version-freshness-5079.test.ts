import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { checkVersionFreshness } from '../src/commands/doctor.js';

describe.skipIf(process.platform === 'win32')('doctor version freshness latest tag', () => {
  let fakeBin: string;
  let originalPath: string | undefined;

  const writeFakeNpm = (script: string) => {
    const npmPath = join(fakeBin, 'npm');
    writeFileSync(npmPath, script);
    chmodSync(npmPath, 0o755);
  };

  beforeAll(() => {
    fakeBin = mkdtempSync(join(tmpdir(), 'doctor-version-freshness-'));
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`;
  });

  beforeEach(() => {
    writeFakeNpm(`#!/bin/sh
if [ "$#" -eq 3 ] && [ "$1" = "view" ] && [ "$2" = "@claude-flow/cli@latest" ] && [ "$3" = "version" ]; then
  printf '999.0.0\\n'
elif [ "$#" -eq 3 ] && [ "$1" = "view" ] && [ "$2" = "@claude-flow/cli@alpha" ] && [ "$3" = "version" ]; then
  printf '0.0.1\\n'
else
  exit 1
fi
`);
  });

  afterAll(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(fakeBin, { recursive: true, force: true });
  });

  it('compares the installed CLI with the latest dist-tag', async () => {
    const check = await checkVersionFreshness();

    expect(check.status).toBe('warn');
    expect(check.message).toContain('latest: v999.0.0');
  });
});
