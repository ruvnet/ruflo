/**
 * Suggestion Engine Tests
 *
 * Tests the suggest module (Levenshtein, similarity, suggestion helpers):
 *   - levenshteinDistance: empty strings, identical, basic edits, longer strings
 *   - similarityScore: identical, empty, different lengths
 *   - findSimilar: prefix boost, threshold filtering, maxSuggestions
 *   - formatSuggestion: empty suggestions, single, multiple, different contexts
 *   - getTypoCorrection: known typos, unknown inputs
 *   - suggestCommand: typo correction, similarity, no matches
 *   - COMMON_TYPOS dictionary validation
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  similarityScore,
  findSimilar,
  formatSuggestion,
  getTypoCorrection,
  suggestCommand,
  COMMON_TYPOS,
} from '../src/suggest.js';

// ===========================================================================
// levenshteinDistance
// ===========================================================================
describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('should return length of b when a is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('should return length of a when b is empty', () => {
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('should return 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('should return 1 for single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('should return 1 for single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('should return 1 for single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('should handle completely different strings', () => {
    const distance = levenshteinDistance('abc', 'xyz');
    expect(distance).toBe(3);
  });

  it('should be symmetric', () => {
    expect(levenshteinDistance('agent', 'agnet')).toBe(
      levenshteinDistance('agnet', 'agent')
    );
  });

  it('should handle longer strings correctly', () => {
    const d = levenshteinDistance('kitten', 'sitting');
    expect(d).toBe(3); // k->s, e->i, +g
  });
});

// ===========================================================================
// similarityScore
// ===========================================================================
describe('similarityScore', () => {
  it('should return 1 for identical strings', () => {
    expect(similarityScore('hello', 'hello')).toBe(1);
  });

  it('should return 1 for two empty strings', () => {
    expect(similarityScore('', '')).toBe(1);
  });

  it('should return 0 for completely different single chars', () => {
    expect(similarityScore('a', 'b')).toBe(0);
  });

  it('should be case-insensitive', () => {
    expect(similarityScore('Hello', 'hello')).toBe(1);
  });

  it('should return a value between 0 and 1', () => {
    const score = similarityScore('agent', 'agnet');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should give higher score for more similar strings', () => {
    const close = similarityScore('agent', 'agnet');
    const far = similarityScore('agent', 'zzzzz');
    expect(close).toBeGreaterThan(far);
  });
});

// ===========================================================================
// findSimilar
// ===========================================================================
describe('findSimilar', () => {
  const candidates = ['agent', 'swarm', 'memory', 'config', 'status', 'hooks', 'neural'];

  it('should find exact prefix matches with boost', () => {
    const results = findSimilar('mem', candidates);
    expect(results[0]).toBe('memory');
  });

  it('should find similar commands for typos', () => {
    const results = findSimilar('agnet', candidates);
    expect(results).toContain('agent');
  });

  it('should return empty array for very different input', () => {
    const results = findSimilar('xyzxyzxyz', candidates, {
      maxDistance: 2,
      minSimilarity: 0.8,
    });
    expect(results).toEqual([]);
  });

  it('should respect maxSuggestions', () => {
    const results = findSimilar('s', candidates, { maxSuggestions: 2, minSimilarity: 0.1 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should use default options when none provided', () => {
    const results = findSimilar('memry', candidates);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3); // default maxSuggestions
  });

  it('should handle empty candidates', () => {
    const results = findSimilar('test', []);
    expect(results).toEqual([]);
  });

  it('should handle empty input', () => {
    const results = findSimilar('', candidates);
    // Empty string has high distance, might not match depending on thresholds
    expect(Array.isArray(results)).toBe(true);
  });
});

// ===========================================================================
// formatSuggestion
// ===========================================================================
describe('formatSuggestion', () => {
  it('should return empty string for no suggestions', () => {
    const result = formatSuggestion('xyz', []);
    expect(result).toBe('');
  });

  it('should format single suggestion', () => {
    const result = formatSuggestion('agnet', ['agent']);
    expect(result).toContain('Did you mean');
    expect(result).toContain('agent');
  });

  it('should format multiple suggestions as a list', () => {
    const result = formatSuggestion('s', ['status', 'swarm', 'session']);
    expect(result).toContain('status');
    expect(result).toContain('swarm');
    expect(result).toContain('session');
    expect(result).toContain('-');
  });

  it('should use "Available subcommands" for subcommand context', () => {
    const result = formatSuggestion('spwn', ['spawn', 'stop'], 'subcommand');
    expect(result).toContain('Available subcommands');
  });

  it('should use "Did you mean" for option context', () => {
    const result = formatSuggestion('--verbos', ['--verbose'], 'option');
    expect(result).toContain('Did you mean');
  });

  it('should use "Valid values" for value context', () => {
    const result = formatSuggestion('jsom', ['json', 'text'], 'value');
    expect(result).toContain('Valid values');
  });
});

// ===========================================================================
// getTypoCorrection
// ===========================================================================
describe('getTypoCorrection', () => {
  it('should correct known typos', () => {
    expect(getTypoCorrection('agnet')).toBe('agent');
    expect(getTypoCorrection('memroy')).toBe('memory');
    expect(getTypoCorrection('confg')).toBe('config');
    expect(getTypoCorrection('swarrm')).toBe('swarm');
    expect(getTypoCorrection('staus')).toBe('status');
  });

  it('should be case-insensitive', () => {
    expect(getTypoCorrection('AGNET')).toBe('agent');
    expect(getTypoCorrection('Memroy')).toBe('memory');
  });

  it('should return undefined for unknown input', () => {
    expect(getTypoCorrection('zzzzz')).toBeUndefined();
    expect(getTypoCorrection('foobar')).toBeUndefined();
  });

  it('should correct common shortcuts', () => {
    expect(getTypoCorrection('mem')).toBe('memory');
    expect(getTypoCorrection('perf')).toBe('performance');
    expect(getTypoCorrection('sec')).toBe('security');
    expect(getTypoCorrection('doc')).toBe('doctor');
    expect(getTypoCorrection('wf')).toBe('workflow');
  });

  it('should handle exact matches (identity typos)', () => {
    expect(getTypoCorrection('init')).toBe('init');
    expect(getTypoCorrection('task')).toBe('task');
    expect(getTypoCorrection('daemon')).toBe('daemon');
  });
});

// ===========================================================================
// COMMON_TYPOS dictionary
// ===========================================================================
describe('COMMON_TYPOS', () => {
  it('should have all expected entries', () => {
    expect(Object.keys(COMMON_TYPOS).length).toBeGreaterThan(30);
  });

  it('should have string values for all keys', () => {
    for (const [key, value] of Object.entries(COMMON_TYPOS)) {
      expect(typeof key).toBe('string');
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('should include hive-mind typos', () => {
    expect(COMMON_TYPOS['hive']).toBe('hive-mind');
    expect(COMMON_TYPOS['hivemind']).toBe('hive-mind');
    expect(COMMON_TYPOS['hive_mind']).toBe('hive-mind');
  });
});

// ===========================================================================
// suggestCommand
// ===========================================================================
describe('suggestCommand', () => {
  const commands = [
    'init', 'agent', 'swarm', 'memory', 'mcp', 'task', 'session',
    'config', 'status', 'start', 'workflow', 'hooks', 'hive-mind',
    'daemon', 'neural', 'security', 'performance', 'providers',
    'plugins', 'deployment', 'embeddings', 'claims', 'migrate',
    'doctor', 'completions',
  ];

  it('should correct a common typo with correction field', () => {
    const result = suggestCommand('agnet', commands);
    expect(result.correction).toBe('agent');
    expect(result.suggestions).toContain('agent');
    expect(result.message).toContain('agent');
  });

  it('should find similar commands when no typo match', () => {
    const result = suggestCommand('agentt', commands);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions).toContain('agent');
  });

  it('should return help message when no matches found', () => {
    const result = suggestCommand('zzzzzzzzzzzzz', commands);
    expect(result.suggestions).toEqual([]);
    expect(result.message).toContain('help');
  });

  it('should handle single suggestion', () => {
    // "memroy" is a known typo
    const result = suggestCommand('memroy', commands);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.message).toContain('memory');
  });

  it('should handle multiple suggestions', () => {
    // "st" is close to "start", "status"
    const result = suggestCommand('st', commands);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('should not return correction when typo maps to unavailable command', () => {
    // Use a small command list without "agent"
    const result = suggestCommand('agnet', ['swarm', 'memory']);
    // correction should be undefined since "agent" is not in availableCommands
    expect(result.correction).toBeUndefined();
  });
});
