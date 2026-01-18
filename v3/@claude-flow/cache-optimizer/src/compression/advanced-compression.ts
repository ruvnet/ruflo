/**
 * Advanced Token Compression Strategies
 *
 * Provides multiple compression methods for cache optimization:
 * 1. Summary Compression - LLM-based semantic summarization
 * 2. Quantized Compression - Bit-level quantization (Int8/Int4)
 * 3. Delta Compression - Store differences from base entries
 * 4. Semantic Deduplication - Remove redundant semantic content
 * 5. Structural Compression - Extract and compress code structure
 */

import type { CacheEntry, CompressedEntry, CompressionMethod } from '../types.js';

// ============================================================================
// Compression Strategy Interface
// ============================================================================

export interface CompressionStrategy {
  name: string;
  method: CompressionMethod;
  compress(content: string, context?: CompressionContext): Promise<CompressionResult>;
  estimateRatio(content: string): number;
}

export interface CompressionContext {
  entryType: string;
  filePath?: string;
  baseEntries?: CacheEntry[];
  semanticIndex?: Map<string, string>;
}

export interface CompressionResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Token Estimation
// ============================================================================

function estimateTokens(text: string): number {
  // Approximate GPT tokenization: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Summary Compression
// ============================================================================

/**
 * Rule-based summary compression (no LLM dependency)
 * Extracts key information while reducing token count
 */
export class SummaryCompression implements CompressionStrategy {
  name = 'Summary Compression';
  method: CompressionMethod = 'summary';

  async compress(content: string, context?: CompressionContext): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    let summary: string;

    if (context?.entryType === 'file_read' || context?.entryType === 'file_write') {
      summary = this.summarizeCode(content);
    } else if (context?.entryType === 'tool_result') {
      summary = this.summarizeToolResult(content);
    } else if (context?.entryType === 'bash_output') {
      summary = this.summarizeBashOutput(content);
    } else {
      summary = this.summarizeGeneral(content);
    }

    const compressedTokens = estimateTokens(summary);

    return {
      compressed: summary,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
      metadata: { method: 'rule-based-summary' },
    };
  }

  estimateRatio(_content: string): number {
    // Summary typically achieves 15-30% of original
    const lines = _content.split('\n').length;
    if (lines > 50) return 0.15;
    if (lines > 20) return 0.25;
    return 0.35;
  }

  private summarizeCode(content: string): string {
    const lines = content.split('\n');
    const summary: string[] = [];

    // Extract file header/comment
    for (const line of lines.slice(0, 5)) {
      if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
        summary.push(line.trim());
      }
    }

    // Extract exports, class, function definitions
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('export ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('interface ') ||
          trimmed.startsWith('type ') ||
          trimmed.match(/^(async\s+)?function\s+/) ||
          trimmed.match(/^(public|private|protected)\s+\w+\s*\(/)) {
        summary.push(trimmed.split('{')[0].trim());
      }
    }

    return summary.slice(0, 10).join('\n') || '[Code structure extracted]';
  }

  private summarizeToolResult(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const summary: string[] = [`Tool: ${parsed.tool || 'unknown'}`];

      if (parsed.matches && Array.isArray(parsed.matches)) {
        summary.push(`Matches: ${parsed.matches.length}`);
      }
      if (parsed.results && Array.isArray(parsed.results)) {
        summary.push(`Results: ${parsed.results.length}`);
      }
      if (parsed.error) {
        summary.push(`Error: ${parsed.error}`);
      }

      return summary.join(', ');
    } catch {
      // Not JSON, extract key info
      return content.slice(0, 100) + (content.length > 100 ? '...' : '');
    }
  }

  private summarizeBashOutput(content: string): string {
    const lines = content.split('\n');
    const summary: string[] = [];

    // Get command
    const cmdLine = lines.find(l => l.trim().startsWith('$'));
    if (cmdLine) summary.push(cmdLine.trim());

    // Get status/errors
    for (const line of lines) {
      if (line.includes('error') || line.includes('Error') ||
          line.includes('failed') || line.includes('Failed') ||
          line.includes('passed') || line.includes('success')) {
        summary.push(line.trim());
      }
    }

    // Get last meaningful line
    const lastLine = lines[lines.length - 1]?.trim();
    if (lastLine && !summary.includes(lastLine)) {
      summary.push(lastLine);
    }

    return summary.slice(0, 5).join('\n') || '[Bash output summarized]';
  }

  private summarizeGeneral(content: string): string {
    const lines = content.split('\n');
    const meaningful: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and common filler
      if (trimmed.length > 10 &&
          !trimmed.startsWith('import ') &&
          !trimmed.startsWith('//') &&
          trimmed !== '{' && trimmed !== '}') {
        meaningful.push(trimmed);
      }
    }

    // Take first and last few lines
    const selected = [
      ...meaningful.slice(0, 3),
      meaningful.length > 6 ? '...' : '',
      ...meaningful.slice(-2),
    ].filter(Boolean);

    return selected.join('\n') || content.slice(0, 100);
  }
}

// ============================================================================
// Quantized Compression (Int8/Int4 simulation)
// ============================================================================

/**
 * Quantized compression using character-level encoding
 * Simulates Int8/Int4 quantization for text
 */
export class QuantizedCompression implements CompressionStrategy {
  name = 'Quantized Compression';
  method: CompressionMethod = 'quantized';
  private bitLevel: 8 | 4;

  constructor(bitLevel: 8 | 4 = 8) {
    this.bitLevel = bitLevel;
  }

  async compress(content: string, _context?: CompressionContext): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    // Quantization replaces repeated patterns with shorter codes
    let compressed = content;

    // Common code patterns -> short codes
    const patterns: [RegExp, string][] = [
      [/function\s+/g, 'ƒ'],
      [/return\s+/g, '↵'],
      [/const\s+/g, '©'],
      [/export\s+/g, '⤴'],
      [/import\s+/g, '⤵'],
      [/async\s+/g, 'ⓐ'],
      [/await\s+/g, 'ⓦ'],
      [/\s{2,}/g, ' '],           // Multiple spaces -> single
      [/\n{3,}/g, '\n\n'],       // Multiple newlines -> double
    ];

    for (const [pattern, replacement] of patterns) {
      compressed = compressed.replace(pattern, replacement);
    }

    // Int4 mode: more aggressive compression
    if (this.bitLevel === 4) {
      const morePatterns: [RegExp, string][] = [
        [/console\.log/g, '⌘'],
        [/Promise/g, 'Ⓟ'],
        [/string/g, '§'],
        [/number/g, '#'],
        [/boolean/g, '⊨'],
        [/undefined/g, '∅'],
        [/null/g, '○'],
      ];
      for (const [pattern, replacement] of morePatterns) {
        compressed = compressed.replace(pattern, replacement);
      }
    }

    const compressedTokens = estimateTokens(compressed);

    return {
      compressed,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
      metadata: {
        method: `quantized-int${this.bitLevel}`,
        reductionRate: 1 - (compressedTokens / originalTokens),
      },
    };
  }

  estimateRatio(content: string): number {
    // Int8: ~70-85% of original, Int4: ~50-70%
    return this.bitLevel === 8 ? 0.75 : 0.55;
  }
}

// ============================================================================
// Delta Compression
// ============================================================================

/**
 * Delta compression stores differences from base entries
 * Useful for incremental file changes
 */
export class DeltaCompression implements CompressionStrategy {
  name = 'Delta Compression';
  method: CompressionMethod = 'summary'; // Uses summary type for storage

  async compress(content: string, context?: CompressionContext): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    if (!context?.baseEntries || context.baseEntries.length === 0) {
      // No base to compare against
      return {
        compressed: content,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
        metadata: { method: 'delta-no-base' },
      };
    }

    // Find most similar base entry
    const lines = new Set(content.split('\n'));
    let bestBase: CacheEntry | null = null;
    let bestOverlap = 0;

    for (const base of context.baseEntries) {
      const baseLines = new Set(base.content.split('\n'));
      const overlap = [...lines].filter(l => baseLines.has(l)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestBase = base;
      }
    }

    if (!bestBase || bestOverlap < lines.size * 0.3) {
      // Not enough overlap
      return {
        compressed: content,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
        metadata: { method: 'delta-low-overlap' },
      };
    }

    // Compute delta
    const baseLines = new Set(bestBase.content.split('\n'));
    const added: string[] = [];
    const removed: string[] = [];

    for (const line of lines) {
      if (!baseLines.has(line)) added.push(line);
    }
    for (const line of baseLines) {
      if (!lines.has(line)) removed.push(line);
    }

    const delta = [
      `[DELTA from ${bestBase.id}]`,
      added.length > 0 ? `+++ ${added.length} lines added` : '',
      ...added.map(l => `+ ${l}`),
      removed.length > 0 ? `--- ${removed.length} lines removed` : '',
      ...removed.map(l => `- ${l}`),
    ].filter(Boolean).join('\n');

    const compressedTokens = estimateTokens(delta);

    return {
      compressed: delta,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
      metadata: {
        method: 'delta',
        baseEntry: bestBase.id,
        addedLines: added.length,
        removedLines: removed.length,
      },
    };
  }

  estimateRatio(_content: string): number {
    // Delta can achieve 10-40% if good base exists
    return 0.3;
  }
}

// ============================================================================
// Semantic Deduplication
// ============================================================================

/**
 * Removes semantically redundant content across entries
 */
export class SemanticDeduplication implements CompressionStrategy {
  name = 'Semantic Deduplication';
  method: CompressionMethod = 'summary';

  async compress(content: string, context?: CompressionContext): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    if (!context?.semanticIndex) {
      return {
        compressed: content,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
        metadata: { method: 'dedup-no-index' },
      };
    }

    const lines = content.split('\n');
    const deduplicated: string[] = [];

    for (const line of lines) {
      const key = this.computeSemanticKey(line);
      if (!context.semanticIndex.has(key)) {
        deduplicated.push(line);
        context.semanticIndex.set(key, line);
      } else {
        // Line is semantically duplicate
        deduplicated.push(`[dup: ${key.slice(0, 8)}...]`);
      }
    }

    const compressed = deduplicated.join('\n');
    const compressedTokens = estimateTokens(compressed);

    return {
      compressed,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
      metadata: {
        method: 'semantic-dedup',
        duplicatesFound: lines.length - deduplicated.filter(l => !l.startsWith('[dup:')).length,
      },
    };
  }

  estimateRatio(_content: string): number {
    // Deduplication typically achieves 60-90% depending on redundancy
    return 0.7;
  }

  private computeSemanticKey(line: string): string {
    // Normalize and hash the semantic content
    const normalized = line
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/['"]/g, '')
      .replace(/\d+/g, 'N')
      .trim();

    // Simple hash
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

// ============================================================================
// Structural Compression (for code)
// ============================================================================

/**
 * Extracts and compresses code structure (AST-like)
 */
export class StructuralCompression implements CompressionStrategy {
  name = 'Structural Compression';
  method: CompressionMethod = 'summary';

  async compress(content: string, context?: CompressionContext): Promise<CompressionResult> {
    const originalTokens = estimateTokens(content);

    // Only apply to code files
    if (context?.entryType !== 'file_read' && context?.entryType !== 'file_write') {
      return {
        compressed: content,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 1.0,
        metadata: { method: 'structural-not-code' },
      };
    }

    const structure = this.extractStructure(content);
    const compressedTokens = estimateTokens(structure);

    return {
      compressed: structure,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
      metadata: { method: 'structural' },
    };
  }

  estimateRatio(_content: string): number {
    // Structural compression typically achieves 10-25% of original
    return 0.2;
  }

  private extractStructure(content: string): string {
    const lines = content.split('\n');
    const structure: string[] = [];
    let depth = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Track imports
      if (trimmed.startsWith('import ')) {
        structure.push(`I: ${trimmed.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '?'}`);
        continue;
      }

      // Track exports
      if (trimmed.startsWith('export ')) {
        const match = trimmed.match(/export\s+(default\s+)?(class|function|const|interface|type)\s+(\w+)/);
        if (match) {
          structure.push(`E: ${match[2]} ${match[3]}`);
        }
        continue;
      }

      // Track class/function declarations
      if (trimmed.match(/^(async\s+)?function\s+(\w+)/)) {
        const name = trimmed.match(/function\s+(\w+)/)?.[1];
        structure.push(`${'  '.repeat(depth)}F: ${name}`);
      }

      if (trimmed.startsWith('class ')) {
        const name = trimmed.match(/class\s+(\w+)/)?.[1];
        structure.push(`${'  '.repeat(depth)}C: ${name}`);
        depth++;
      }

      // Track method definitions
      if (trimmed.match(/^(public|private|protected|async)\s+\w+\s*\(/)) {
        const match = trimmed.match(/(public|private|protected|async)\s+(\w+)\s*\(/);
        if (match) {
          structure.push(`${'  '.repeat(depth)}M: ${match[2]}`);
        }
      }

      // Track brace depth
      if (trimmed.includes('{') && !trimmed.includes('}')) depth++;
      if (trimmed.includes('}') && !trimmed.includes('{')) depth = Math.max(0, depth - 1);
    }

    return structure.join('\n') || '[No structure extracted]';
  }
}

// ============================================================================
// Compression Manager
// ============================================================================

export interface CompressionConfig {
  defaultStrategy: string;
  minCompressionRatio: number;
  enabledStrategies: string[];
}

const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  defaultStrategy: 'summary',
  minCompressionRatio: 0.8, // Only compress if we achieve < 80%
  enabledStrategies: ['summary', 'quantized', 'delta', 'structural'],
};

/**
 * Manages multiple compression strategies and selects the best one
 */
export class CompressionManager {
  private strategies: Map<string, CompressionStrategy> = new Map();
  private config: CompressionConfig;

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

    // Register default strategies
    this.registerStrategy(new SummaryCompression());
    this.registerStrategy(new QuantizedCompression(8));
    this.registerStrategy(new QuantizedCompression(4));
    this.registerStrategy(new DeltaCompression());
    this.registerStrategy(new SemanticDeduplication());
    this.registerStrategy(new StructuralCompression());
  }

  registerStrategy(strategy: CompressionStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Compress content using the best strategy for the entry type
   */
  async compress(entry: CacheEntry, context?: CompressionContext): Promise<CompressedEntry> {
    const strategy = this.selectStrategy(entry, context);
    const result = await strategy.compress(entry.content, {
      entryType: entry.type,
      filePath: entry.metadata.filePath,
      ...context,
    });

    // Only use compression if it achieves meaningful reduction
    if (result.ratio > this.config.minCompressionRatio) {
      return {
        method: strategy.method,
        summary: entry.content, // Keep original if compression not worthwhile
        compressedTokens: entry.tokens,
        ratio: 1.0,
        originalTokens: entry.tokens,
        compressedAt: Date.now(),
      };
    }

    return {
      method: strategy.method,
      summary: result.compressed,
      compressedTokens: result.compressedTokens,
      ratio: result.ratio,
      originalTokens: result.originalTokens,
      compressedAt: Date.now(),
    };
  }

  /**
   * Select the best compression strategy for an entry
   */
  selectStrategy(entry: CacheEntry, _context?: CompressionContext): CompressionStrategy {
    // Strategy selection based on entry type
    switch (entry.type) {
      case 'file_read':
      case 'file_write':
        // Code files: use structural for big files, summary for small
        return entry.tokens > 200
          ? this.strategies.get('Structural Compression')!
          : this.strategies.get('Summary Compression')!;

      case 'tool_result':
      case 'mcp_context':
        // JSON results: quantized compression works well
        return this.strategies.get('Quantized Compression')!;

      case 'bash_output':
        // Bash output: summary extracts key info
        return this.strategies.get('Summary Compression')!;

      default:
        // Default to summary
        return this.strategies.get('Summary Compression')!;
    }
  }

  /**
   * Estimate compression ratio without actually compressing
   */
  estimateRatio(entry: CacheEntry): number {
    const strategy = this.selectStrategy(entry);
    return strategy.estimateRatio(entry.content);
  }

  /**
   * Get all available strategies
   */
  getStrategies(): CompressionStrategy[] {
    return Array.from(this.strategies.values());
  }
}

// Export singleton
export const compressionManager = new CompressionManager();
