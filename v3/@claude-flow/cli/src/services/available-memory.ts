/**
 * Available-memory measurement for the worker daemon's resource gate (#2935).
 *
 * On Darwin, `os.freemem()` (libuv: host `free_count` × page size) counts only
 * free and speculative pages. The kernel keeps file cache resident on the
 * inactive queue and reclaims it on demand, so a healthy idle Mac reports a
 * few percent "free" and the daemon defers almost every worker.
 *
 * On Darwin this module reads `vm_stat` and measures
 *   (free + speculative + inactive) × pageSize, clamped to totalmem,
 * where vm_stat's "Pages free" is `free_count - speculative_count` (so
 * free + speculative is the kernel's `free_count`) and the page size is taken
 * from vm_stat's own header (16384 on Apple Silicon, 4096 on Intel). Purgeable
 * pages are parsed for diagnostics only: they are an attribute of pages that
 * already sit on other queues, so adding them could double-count. This is the
 * same `inactive + free_count` measure psutil and Zabbix report as available.
 *
 * Every other platform keeps `os.freemem()`, unchanged. If the probe fails,
 * the reader falls back to `os.freemem()` and says so in `fallbackReason`.
 */

export type AvailableMemorySource = 'vm_stat' | 'os.freemem' | 'os.freemem-fallback';

export interface AvailableMemory {
  availableBytes: number;
  totalBytes: number;
  /** Available memory as a percentage of total, 0–100. */
  percent: number;
  source: AvailableMemorySource;
  /** Set only when source is 'os.freemem-fallback': why vm_stat was not used. */
  fallbackReason?: string;
  /** Set when the measurement itself is degenerate (e.g. invalid totalmem). */
  diagnostic?: string;
}

export interface VmStatSample {
  pageSize: number;
  free: number;
  inactive: number;
  speculative: number;
  purgeable?: number;
}

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;
type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean; encoding: 'utf8' },
  callback: ExecFileCallback,
) => unknown;

export interface AvailableMemoryDeps {
  /** Platform of the measured host; anything other than 'darwin' keeps os.freemem(). */
  platform?: () => Promise<string | undefined>;
  execFile?: () => Promise<ExecFileLike>;
  freemem?: () => Promise<number>;
  totalmem?: () => Promise<number>;
  now?: () => number;
}

export const VM_STAT_PATH = '/usr/bin/vm_stat';
export const VM_STAT_TIMEOUT_MS = 1000;
export const AVAILABLE_MEMORY_CACHE_TTL_MS = 5000;

const VM_STAT_MAX_BUFFER = 16 * 1024;
const PAGE_SIZE_HEADER = /page size of (\d+) bytes/;
const COUNTER_LINE = /^([^:]+):\s+(\d+)\.?\s*$/;
const COUNTERS: Record<string, keyof Omit<VmStatSample, 'pageSize'>> = {
  'Pages free': 'free',
  'Pages inactive': 'inactive',
  'Pages speculative': 'speculative',
  'Pages purgeable': 'purgeable',
};

/** Parse `vm_stat` output. Returns null unless the header and required counters are valid. */
export function parseVmStat(text: string): VmStatSample | null {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header = PAGE_SIZE_HEADER.exec(lines[0] ?? '');
  if (!header) return null;
  const pageSize = Number(header[1]);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null;

  const counters: Partial<Record<keyof Omit<VmStatSample, 'pageSize'>, number>> = {};
  for (const line of lines.slice(1)) {
    const match = COUNTER_LINE.exec(line);
    if (!match) continue;
    const key = COUNTERS[match[1].trim()];
    if (!key) continue;
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value < 0) return null;
    counters[key] = value;
  }
  const { free, inactive, speculative, purgeable } = counters;
  if (free === undefined || inactive === undefined || speculative === undefined) return null;
  return purgeable === undefined
    ? { pageSize, free, inactive, speculative }
    : { pageSize, free, inactive, speculative, purgeable };
}

/** Available bytes per the documented formula, or null if the product is not a safe integer. */
export function vmStatAvailableBytes(sample: VmStatSample): number | null {
  const pages = sample.free + sample.speculative + sample.inactive;
  const bytes = pages * sample.pageSize;
  return Number.isSafeInteger(pages) && Number.isSafeInteger(bytes) ? bytes : null;
}

function runExecFile(execFile: ExecFileLike): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        VM_STAT_PATH,
        [],
        { timeout: VM_STAT_TIMEOUT_MS, maxBuffer: VM_STAT_MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
        (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
      );
    } catch (error) {
      reject(error);
    }
  });
}

function describeError(error: unknown): string {
  const e = error as { code?: unknown; killed?: unknown; signal?: unknown; message?: unknown };
  if (e?.killed) return `vm_stat timed out after ${VM_STAT_TIMEOUT_MS}ms`;
  if (e?.code !== undefined) return `vm_stat failed (${String(e.code)})`;
  return `vm_stat failed (${String(e?.message ?? error).slice(0, 200)})`;
}

interface OsLike {
  freemem(): number;
  totalmem(): number;
  platform?: () => string;
}

// Resolved at call time, from the same `os` specifier canRunWorker has always
// imported, so a substituted `os` (as in the daemon's tests) supplies the
// platform as well as the byte counts. A substitute that does not provide
// `platform` is measured with its own freemem(), never with the host's vm_stat.
async function loadOs(): Promise<OsLike> {
  const mod = (await import('os')) as unknown as { default?: OsLike } & OsLike;
  return mod.default ?? mod;
}

const defaultDeps: Required<AvailableMemoryDeps> = {
  platform: async () => {
    const os = await loadOs();
    return typeof os.platform === 'function' ? os.platform() : undefined;
  },
  execFile: async () => (await import('node:child_process')).execFile as unknown as ExecFileLike,
  freemem: async () => (await loadOs()).freemem(),
  totalmem: async () => (await loadOs()).totalmem(),
  now: () => Date.now(),
};

export interface AvailableMemoryReader {
  read(): Promise<AvailableMemory>;
}

/**
 * Create a reader. Resolved results are cached for AVAILABLE_MEMORY_CACHE_TTL_MS
 * and concurrent callers share one in-flight measurement, so at most one
 * vm_stat child process exists at a time.
 */
export function createAvailableMemoryReader(deps: AvailableMemoryDeps = {}): AvailableMemoryReader {
  const d: Required<AvailableMemoryDeps> = { ...defaultDeps, ...deps };
  let cached: { at: number; value: AvailableMemory } | null = null;
  let inFlight: Promise<AvailableMemory> | null = null;

  async function measure(): Promise<AvailableMemory> {
    const totalBytes = await d.totalmem();
    const freeBytes = await d.freemem();
    const fromFreemem = (source: AvailableMemorySource, fallbackReason?: string): AvailableMemory => {
      const result: AvailableMemory = { availableBytes: freeBytes, totalBytes, percent: 0, source };
      if (fallbackReason) result.fallbackReason = fallbackReason;
      return withPercent(result);
    };

    if ((await d.platform()) !== 'darwin') return fromFreemem('os.freemem');

    let sample: VmStatSample | null;
    try {
      sample = parseVmStat(await runExecFile(await d.execFile()));
    } catch (error) {
      return fromFreemem('os.freemem-fallback', describeError(error));
    }
    if (!sample) return fromFreemem('os.freemem-fallback', 'vm_stat output could not be parsed');
    const bytes = vmStatAvailableBytes(sample);
    if (bytes === null) return fromFreemem('os.freemem-fallback', 'vm_stat page counts overflow');

    const availableBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? Math.min(bytes, totalBytes) : bytes;
    return withPercent({ availableBytes, totalBytes, percent: 0, source: 'vm_stat' });
  }

  return {
    read(): Promise<AvailableMemory> {
      const now = d.now();
      if (cached && now - cached.at < AVAILABLE_MEMORY_CACHE_TTL_MS) return Promise.resolve(cached.value);
      if (inFlight) return inFlight;
      inFlight = measure()
        .then((value) => {
          cached = { at: d.now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}

/**
 * A broken total (0, negative, NaN, Infinity) cannot yield a percentage. Report
 * 100% with a diagnostic so the gate does not deny on it, matching the
 * previous behaviour where `NaN < threshold` was false.
 */
function withPercent(result: AvailableMemory): AvailableMemory {
  const { availableBytes, totalBytes } = result;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { ...result, percent: 100, diagnostic: `invalid totalmem: ${String(totalBytes)}` };
  }
  const percent = (availableBytes / totalBytes) * 100;
  if (!Number.isFinite(percent)) {
    return { ...result, percent: 100, diagnostic: `invalid available memory: ${String(availableBytes)}` };
  }
  return { ...result, percent: Math.max(0, Math.min(100, percent)) };
}
