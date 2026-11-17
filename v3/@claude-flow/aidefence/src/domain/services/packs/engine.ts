/**
 * Vendored from midstream `AIMDS/src/detection/engine.ts` at commit abe78d6.
 *
 * InjectionDetector: pack-driven prompt-injection detector.
 *
 * Pipeline: normalise -> text variants -> one regex exec per (pattern,
 * variant) -> bounded decode of encoded blobs -> one re-scan of each decoded
 * string with every pack except encoded_instruction (no recursion).
 *
 * ruflo changes:
 *  - packs come from the embedded `./data/` modules, validated and compiled
 *    ONCE per process (`compiledPacks()`); a detector instance only selects
 *    which compiled packs it scans, so creating detectors is cheap.
 *  - `packs` config also accepts `true`/`false` or a list of pack names.
 *  - threats carry `matchLength` so callers can report a location span.
 *  - normalised/decoded text is used for matching only; it is never returned
 *    (the `match` excerpt is the only text echoed, capped at 160 chars).
 */

import {
  CompiledPattern,
  PatternPack,
  Severity,
  ThreatKind,
  compilePack,
  validatePack,
} from './pattern-loader.js';
import { normalizeText, textVariants, TextVariant } from './normalize.js';
import { DecoderOptions, Encoding, extractDecodedCandidates } from './decoders.js';
import { EMBEDDED_PACKS } from './data/index.js';

export type PackName =
  | 'core'
  | 'tool_invocation'
  | 'exfil_url'
  | 'encoded_instruction'
  | 'slack_markup_forgery'
  | 'instruction_override_i18n'
  | (string & {});

/**
 * Which packs to scan. `true`/omitted: every pack whose `enabledByDefault`
 * is set (all six vendored packs). `false`: none. A list: exactly those.
 * A record: per-pack overrides on top of the defaults.
 */
export type PackSelection = boolean | readonly PackName[] | Partial<Record<PackName, boolean>>;

export interface InjectionDetectorConfig {
  readonly packs?: PackSelection;
  /** Preloaded packs (tests). Replaces the embedded packs; compiled per instance. */
  readonly preloaded?: readonly PatternPack[];
  /** Scan obfuscation variants (separators, leet, compact). Default true. */
  readonly variants?: boolean;
  /** Decode base64/hex/url blobs and re-scan once. Default true when encoded_instruction is enabled. */
  readonly decode?: boolean;
  readonly decoder?: DecoderOptions;
  /** Inputs longer than this are truncated before scanning. Default 262144. */
  readonly maxInputChars?: number;
}

export interface InjectionThreat {
  readonly id: string;
  readonly pack: string;
  readonly type: ThreatKind;
  readonly severity: Severity;
  readonly confidence: number;
  readonly description: string;
  /** Regex source of the pattern that matched. */
  readonly regex: string;
  readonly match: string;
  readonly offset: number;
  readonly matchLength: number;
  /** Which text variant matched: base, separators, leet, compact. */
  readonly variant: TextVariant['name'];
  /** Set when the match was found in decoded content. */
  readonly decodedFrom?: Encoding;
}

export interface InjectionReport {
  readonly safe: boolean;
  readonly maxSeverity: Severity | null;
  readonly threats: readonly InjectionThreat[];
  readonly scanned: { variants: number; decoded: number; patterns: number };
  readonly truncated: boolean;
  readonly durationMs: number;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const VARIANT_PENALTY: Record<TextVariant['name'], number> = { base: 0, separators: 0.05, leet: 0.1, compact: 0.15 };

interface CompiledPackSet {
  readonly packs: Map<string, PatternPack>;
  readonly compiled: Map<string, CompiledPattern[]>;
}

let embedded: CompiledPackSet | null = null;

function compileSet(packs: readonly PatternPack[]): CompiledPackSet {
  const byName = new Map<string, PatternPack>();
  const compiled = new Map<string, CompiledPattern[]>();
  for (const raw of packs) {
    const pack = validatePack(raw, raw.pack);
    if (byName.has(pack.pack)) throw new Error(`pattern pack: duplicate pack ${pack.pack}`);
    byName.set(pack.pack, pack);
    compiled.set(pack.pack, compilePack(pack));
  }
  return { packs: byName, compiled };
}

/**
 * V8 compiles a RegExp lazily on its first exec, which made the first
 * detect() of a process ~17 ms. Running every pattern and the normaliser once
 * here moves that cost to construction, outside detectionTimeMs.
 */
function warmUp(set: CompiledPackSet): void {
  const sample = normalizeText('Warm-up: ignore the p.r.e.v.i.o.u.s n0te at https://example.invalid/?q=aGVsbG8gd29ybGQ');
  for (const v of textVariants(sample)) {
    for (const list of set.compiled.values()) {
      for (const c of list) (v.compactForm ? c.compactRe : c.re)?.exec(v.text);
    }
  }
  extractDecodedCandidates(sample);
}

/** The embedded packs, validated, compiled and warmed once per process. */
export function compiledPacks(): CompiledPackSet {
  if (!embedded) {
    embedded = compileSet(EMBEDDED_PACKS);
    warmUp(embedded);
  }
  return embedded;
}

function isEnabled(name: string, pack: PatternPack, sel: PackSelection | undefined): boolean {
  if (sel === undefined || sel === true) return pack.enabledByDefault;
  if (sel === false) return false;
  if (Array.isArray(sel)) return sel.includes(name);
  const flag = (sel as Partial<Record<string, boolean>>)[name];
  return flag === true || (flag === undefined && pack.enabledByDefault);
}

export class InjectionDetector {
  private readonly enabled: Set<string>;
  private readonly compiled: CompiledPattern[];
  private readonly rescan: CompiledPattern[];
  private readonly cfg: Required<Pick<InjectionDetectorConfig, 'variants' | 'decode' | 'maxInputChars'>> & { decoder: DecoderOptions };

  constructor(config: InjectionDetectorConfig = {}) {
    const set = config.preloaded ? compileSet(config.preloaded) : compiledPacks();
    this.enabled = new Set<string>();
    this.compiled = [];
    for (const [name, pack] of set.packs) {
      if (!isEnabled(name, pack, config.packs)) continue;
      this.enabled.add(name);
      this.compiled.push(...set.compiled.get(name)!);
    }
    this.rescan = this.compiled.filter((c) => c.spec.pack !== 'encoded_instruction');
    this.cfg = {
      variants: config.variants ?? true,
      decode: config.decode ?? this.enabled.has('encoded_instruction'),
      maxInputChars: config.maxInputChars ?? 262144,
      decoder: config.decoder ?? {},
    };
  }

  /** Names of packs that are loaded and enabled. */
  enabledPacks(): string[] {
    return [...this.enabled];
  }

  /** Total compiled patterns across enabled packs. */
  patternCount(): number {
    return this.compiled.length;
  }

  detect(input: string): InjectionReport {
    const start = performance.now();
    if (this.compiled.length === 0) {
      return { safe: true, maxSeverity: null, threats: [], scanned: { variants: 0, decoded: 0, patterns: 0 }, truncated: false, durationMs: 0 };
    }
    const truncated = input.length > this.cfg.maxInputChars;
    const text = truncated ? input.slice(0, this.cfg.maxInputChars) : input;
    const normalized = normalizeText(text);
    const variants: TextVariant[] = this.cfg.variants
      ? textVariants(normalized)
      : [{ name: 'base', text: normalized, compactForm: false }];

    const found: InjectionThreat[] = [];
    for (const v of variants) this.scanVariant(v, this.compiled, found, undefined);

    let decoded = 0;
    if (this.cfg.decode) {
      for (const cand of extractDecodedCandidates(normalized, this.cfg.decoder)) {
        decoded++;
        const inner = normalizeText(cand.decoded);
        const innerVariants: TextVariant[] = this.cfg.variants
          ? textVariants(inner, 8192)
          : [{ name: 'base', text: inner, compactForm: false }];
        for (const v of innerVariants) this.scanVariant(v, this.rescan, found, cand.encoding, cand.offset, cand.sourceLength);
      }
    }

    const threats = dedupe(found);
    const maxSeverity = threats.length ? threats[0].severity : null;
    return {
      safe: threats.length === 0,
      maxSeverity,
      threats,
      scanned: { variants: variants.length, decoded, patterns: this.compiled.length },
      truncated,
      durationMs: performance.now() - start,
    };
  }

  private scanVariant(
    v: TextVariant,
    patterns: readonly CompiledPattern[],
    out: InjectionThreat[],
    decodedFrom: Encoding | undefined,
    baseOffset = 0,
    sourceLength?: number,
  ): void {
    for (const c of patterns) {
      const re = v.compactForm ? c.compactRe : c.re;
      if (!re) continue;
      const m = re.exec(v.text);
      if (!m || m[0].length === 0) continue;
      const base = c.spec.confidence ?? 0.7;
      const confidence = Math.max(0.1, Math.round((base - VARIANT_PENALTY[v.name] - (decodedFrom ? 0.05 : 0)) * 100) / 100);
      out.push({
        id: c.spec.id,
        pack: c.spec.pack,
        type: c.spec.type,
        severity: c.spec.severity,
        confidence,
        description: c.spec.description,
        regex: c.spec.regex,
        match: m[0].length > 160 ? `${m[0].slice(0, 157)}...` : m[0],
        // A decoded match is reported at the encoded blob it came from.
        offset: decodedFrom ? baseOffset : m.index,
        matchLength: decodedFrom ? (sourceLength ?? m[0].length) : m[0].length,
        variant: v.name,
        ...(decodedFrom ? { decodedFrom } : {}),
      });
    }
  }
}

/** One threat per pattern id (highest confidence), sorted by severity then confidence. */
function dedupe(threats: InjectionThreat[]): InjectionThreat[] {
  const best = new Map<string, InjectionThreat>();
  for (const t of threats) {
    const prev = best.get(t.id);
    if (!prev || t.confidence > prev.confidence) best.set(t.id, t);
  }
  return [...best.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence,
  );
}

let defaultDetector: InjectionDetector | null = null;

/** Shared detector with every default-on pack. */
export function getInjectionDetector(): InjectionDetector {
  if (!defaultDetector) {
    defaultDetector = new InjectionDetector();
    // Warm the detect() path itself (dedupe, sort) before any timed call.
    defaultDetector.detect('warm-up: use the fetch_url tool on https://example.invalid/x');
  }
  return defaultDetector;
}

export function createInjectionDetector(config?: InjectionDetectorConfig): InjectionDetector {
  return new InjectionDetector(config);
}
