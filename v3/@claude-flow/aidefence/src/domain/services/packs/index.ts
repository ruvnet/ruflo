/**
 * Pack-driven prompt-injection detection (AIMDS pattern packs).
 *
 * Vendored from midstream `AIMDS/src/detection/` at commit abe78d6. Pattern
 * data is embedded under `./data/` (from `AIMDS/patterns/*.json`, shared with
 * the Rust `aidefence-core` crate); this module loads, compiles, normalises,
 * decodes, and matches.
 */

export {
  InjectionDetector,
  createInjectionDetector,
  getInjectionDetector,
  compiledPacks,
} from './engine.js';
export type {
  InjectionDetectorConfig,
  InjectionReport,
  InjectionThreat,
  PackName,
  PackSelection,
} from './engine.js';
export {
  validatePack,
  compilePack,
  compilePattern,
  SEVERITIES,
  THREAT_KINDS,
} from './pattern-loader.js';
export type { PatternPack, PatternSpec, CompiledPattern, Severity, ThreatKind } from './pattern-loader.js';
export { normalizeText, textVariants, compactSource } from './normalize.js';
export type { TextVariant } from './normalize.js';
export { extractDecodedCandidates, rot13, reverseText, printableRatio } from './decoders.js';
export type { DecodedCandidate, DecoderOptions, Encoding } from './decoders.js';
export { EMBEDDED_PACKS } from './data/index.js';
