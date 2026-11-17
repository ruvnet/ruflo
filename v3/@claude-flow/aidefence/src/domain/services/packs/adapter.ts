/**
 * Bridges the vendored AIMDS InjectionDetector onto this package's `Threat`
 * entity, so ThreatDetectionService can merge pack findings with its
 * built-in patterns without changing its result shape.
 */

import { Threat, ThreatType, createThreat } from '../../entities/threat.js';
import {
  InjectionDetector,
  PackSelection,
  createInjectionDetector,
  getInjectionDetector,
} from './engine.js';
import type { ThreatKind } from './pattern-loader.js';

/**
 * Every pack ThreatKind exists in ThreatType (the three pack-only kinds were
 * added to the union in 3.1.0); the map keeps that a compile-time fact.
 */
const KIND_TO_TYPE: Record<ThreatKind, ThreatType> = {
  prompt_injection: 'prompt_injection',
  jailbreak: 'jailbreak',
  instruction_override: 'instruction_override',
  role_switching: 'role_switching',
  context_manipulation: 'context_manipulation',
  encoding_attack: 'encoding_attack',
  tool_invocation: 'tool_invocation',
  data_exfiltration: 'data_exfiltration',
  markup_forgery: 'markup_forgery',
  unknown: 'unknown',
};

/**
 * Resolve a pack selection to a detector. Default-on selections share one
 * process-wide detector; `false` disables pack scanning entirely.
 */
export function resolvePackDetector(selection: PackSelection | undefined): InjectionDetector | null {
  if (selection === false) return null;
  if (selection === undefined || selection === true) return getInjectionDetector();
  const detector = createInjectionDetector({ packs: selection });
  return detector.patternCount() > 0 ? detector : null;
}

/**
 * Run the pack detector and map each finding to a Threat. Locations are
 * offsets into the pack engine's normalised text (NFKC, invisibles stripped,
 * whitespace collapsed), so they are approximate for obfuscated input; a
 * finding inside decoded content points at the encoded blob.
 */
export function detectPackThreats(detector: InjectionDetector, input: string): Threat[] {
  const report = detector.detect(input);
  return report.threats.map((t) =>
    createThreat({
      type: KIND_TO_TYPE[t.type],
      severity: t.severity,
      confidence: t.confidence,
      pattern: t.regex,
      description: t.decodedFrom
        ? `${t.description} [${t.id}, in ${t.decodedFrom}-decoded content]`
        : `${t.description} [${t.id}]`,
      ruleId: t.id,
      location: { start: t.offset, end: t.offset + t.matchLength },
    }),
  );
}
