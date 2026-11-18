import { execFileSync } from 'child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RvfaPublisher } from '../src/appliance/rvfa-distribution.js';
import { downloadFromGCS, uploadToGCS } from '../src/transfer/storage/gcs.js';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('fixture')),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const bucket = 'fixture-bucket';
const uri = 'gs://fixture-bucket/example.json';

it('places GCS upload staging files in the OS temporary directory', async () => {
  vi.stubEnv('TMPDIR', undefined);
  await uploadToGCS(Buffer.from('fixture'), { name: 'example.json', config: { bucket } });
  const [command, args] = vi.mocked(execFileSync).mock.calls[0];
  expect(command).toBe('gcloud');
  expect(dirname((args as string[])[2])).toBe(tmpdir());
});

it('places GCS download staging files in the OS temporary directory', async () => {
  vi.stubEnv('TMPDIR', undefined);
  await expect(downloadFromGCS(uri, { bucket })).resolves.toEqual(Buffer.from('fixture'));
  const [command, args] = vi.mocked(execFileSync).mock.calls[0];
  expect(command).toBe('gcloud');
  expect(dirname((args as string[])[3])).toBe(tmpdir());
});

it.runIf(process.platform === 'win32')('publishes a Windows appliance path using only its filename', async () => {
  const file = String.raw`C:\fixtures\example.rvf`;
  const data = Buffer.from('fixture');
  vi.mocked(readFile).mockResolvedValue(data);
  const publisher = new RvfaPublisher({ pinataJwt: 'fixture-token' });
  const upload = vi.spyOn(publisher as unknown as {
    upload: (name: string, bytes: Buffer, metadata: Record<string, string>) => Promise<unknown>;
  }, 'upload').mockResolvedValue({});

  await publisher.publish(file);

  expect(readFile).toHaveBeenCalledWith(file);
  expect(upload).toHaveBeenCalledWith('example.rvf', data, expect.any(Object));
});
