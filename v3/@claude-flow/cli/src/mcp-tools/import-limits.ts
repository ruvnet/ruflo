import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/** Bound allocation and reads even if an import file grows after its size check. */
export function readImportFile(file: string): Buffer {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Import input must be a regular file');
    if (stat.size > MAX_IMPORT_BYTES) throw new Error('Import file exceeds the 16 MiB limit');
    const buffer = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(fd, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > stat.size) throw new Error('Import input changed size while reading');
    return buffer.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}
