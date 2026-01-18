#!/usr/bin/env npx tsx
/**
 * Advanced Compression Strategies Demo
 *
 * Demonstrates the different compression strategies:
 * 1. Summary Compression - Rule-based semantic summarization
 * 2. Quantized Compression - Int8/Int4 pattern encoding
 * 3. Delta Compression - Diff-based compression
 * 4. Semantic Deduplication - Remove redundant content
 * 5. Structural Compression - AST-like code extraction
 */

import {
  SummaryCompression,
  QuantizedCompression,
  DeltaCompression,
  SemanticDeduplication,
  StructuralCompression,
  CompressionManager,
} from '../src/compression/advanced-compression.js';
import type { CacheEntry } from '../src/types.js';

// Sample content for testing
const CODE_SAMPLE = `/**
 * UserAuthenticationService
 * Handles user login, logout, and session management
 */
import { hashPassword, verifyPassword } from './crypto';
import { SessionStore } from './session';
import { User, Session } from './types';

export class UserAuthenticationService {
  private sessionStore: SessionStore;
  private readonly SESSION_TTL = 24 * 60 * 60 * 1000;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  async login(email: string, password: string): Promise<Session | null> {
    const user = await this.findUserByEmail(email);
    if (!user) {
      console.log('User not found:', email);
      return null;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      console.log('Invalid password for:', email);
      return null;
    }

    const session = await this.createSession(user);
    console.log('Login successful for:', email);
    return session;
  }

  async logout(sessionId: string): Promise<boolean> {
    return await this.sessionStore.delete(sessionId);
  }

  private async findUserByEmail(email: string): Promise<User | null> {
    // Implementation
    return null;
  }

  private async createSession(user: User): Promise<Session> {
    const session: Session = {
      id: crypto.randomUUID(),
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.SESSION_TTL,
    };
    await this.sessionStore.set(session.id, session);
    return session;
  }
}`;

const TOOL_RESULT_SAMPLE = JSON.stringify({
  tool: 'grep',
  pattern: 'authentication',
  matches: [
    { file: 'src/auth/login.ts', line: 15, match: 'export function authenticate(user: User)' },
    { file: 'src/auth/session.ts', line: 23, match: 'async validateAuthentication(token: string)' },
    { file: 'src/middleware/auth.ts', line: 8, match: 'const authenticationMiddleware = async (req, res, next)' },
    { file: 'tests/auth.test.ts', line: 42, match: 'describe("authentication flow", () => {' },
    { file: 'docs/README.md', line: 56, match: '## Authentication' },
  ],
}, null, 2);

const BASH_OUTPUT_SAMPLE = `$ npm run test:auth
> @myapp/core@1.0.0 test:auth
> jest --testPathPattern=auth

 PASS  tests/auth/login.test.ts (2.541 s)
  Login Flow
    ✓ should login with valid credentials (45 ms)
    ✓ should reject invalid password (12 ms)
    ✓ should reject unknown user (8 ms)
    ✓ should create session on success (23 ms)
    ✓ should rate limit after 5 failures (156 ms)

 PASS  tests/auth/session.test.ts (1.234 s)
  Session Management
    ✓ should create session with TTL (15 ms)
    ✓ should expire session after TTL (1012 ms)
    ✓ should refresh session on activity (18 ms)

Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        3.891 s
Ran all test suites matching /auth/i.`;

async function demonstrateStrategy(
  name: string,
  strategy: { compress: (content: string, context?: { entryType: string }) => Promise<{
    compressed: string;
    originalTokens: number;
    compressedTokens: number;
    ratio: number;
  }> },
  content: string,
  entryType: string
): Promise<void> {
  console.log(`\n  📦 ${name}`);
  console.log('  ' + '─'.repeat(60));

  const result = await strategy.compress(content, { entryType });

  console.log(`  Original tokens:   ${result.originalTokens}`);
  console.log(`  Compressed tokens: ${result.compressedTokens}`);
  console.log(`  Compression ratio: ${(result.ratio * 100).toFixed(1)}%`);
  console.log(`  Space saved:       ${((1 - result.ratio) * 100).toFixed(1)}%`);

  // Show preview of compressed content
  const preview = result.compressed.split('\n').slice(0, 5).join('\n');
  console.log(`\n  Preview:`);
  console.log(`  ${preview.split('\n').join('\n  ')}${result.compressed.split('\n').length > 5 ? '\n  ...' : ''}`);
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║            ADVANCED COMPRESSION STRATEGIES DEMO                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // ========================================
  // Code File Compression
  // ========================================
  console.log('\n' + '═'.repeat(70));
  console.log('  CODE FILE COMPRESSION (UserAuthenticationService.ts)');
  console.log('═'.repeat(70));

  await demonstrateStrategy(
    'Summary Compression',
    new SummaryCompression(),
    CODE_SAMPLE,
    'file_read'
  );

  await demonstrateStrategy(
    'Quantized Compression (Int8)',
    new QuantizedCompression(8),
    CODE_SAMPLE,
    'file_read'
  );

  await demonstrateStrategy(
    'Quantized Compression (Int4)',
    new QuantizedCompression(4),
    CODE_SAMPLE,
    'file_read'
  );

  await demonstrateStrategy(
    'Structural Compression',
    new StructuralCompression(),
    CODE_SAMPLE,
    'file_read'
  );

  // ========================================
  // Tool Result Compression
  // ========================================
  console.log('\n' + '═'.repeat(70));
  console.log('  TOOL RESULT COMPRESSION (grep output)');
  console.log('═'.repeat(70));

  await demonstrateStrategy(
    'Summary Compression',
    new SummaryCompression(),
    TOOL_RESULT_SAMPLE,
    'tool_result'
  );

  await demonstrateStrategy(
    'Quantized Compression (Int8)',
    new QuantizedCompression(8),
    TOOL_RESULT_SAMPLE,
    'tool_result'
  );

  // ========================================
  // Bash Output Compression
  // ========================================
  console.log('\n' + '═'.repeat(70));
  console.log('  BASH OUTPUT COMPRESSION (test results)');
  console.log('═'.repeat(70));

  await demonstrateStrategy(
    'Summary Compression',
    new SummaryCompression(),
    BASH_OUTPUT_SAMPLE,
    'bash_output'
  );

  // ========================================
  // Compression Manager (Auto-selection)
  // ========================================
  console.log('\n' + '═'.repeat(70));
  console.log('  COMPRESSION MANAGER (Auto-selects best strategy)');
  console.log('═'.repeat(70));

  const manager = new CompressionManager();

  // Create mock entries
  const entries: Array<{ name: string; entry: CacheEntry }> = [
    {
      name: 'Code File',
      entry: {
        id: 'entry-1',
        type: 'file_read',
        content: CODE_SAMPLE,
        tokens: Math.ceil(CODE_SAMPLE.length / 4),
        timestamp: Date.now(),
        metadata: {
          source: 'test',
          filePath: 'src/auth/service.ts',
          sessionId: 'demo',
          tags: [],
        },
        relevance: {
          overall: 0.8,
          components: { recency: 0.9, frequency: 0.7, semantic: 0.8, attention: 0.7, expert: 0.8 },
          scoredAt: Date.now(),
          confidence: 0.9,
        },
        tier: 'hot',
        accessCount: 1,
        lastAccessedAt: Date.now(),
      },
    },
    {
      name: 'Tool Result',
      entry: {
        id: 'entry-2',
        type: 'tool_result',
        content: TOOL_RESULT_SAMPLE,
        tokens: Math.ceil(TOOL_RESULT_SAMPLE.length / 4),
        timestamp: Date.now(),
        metadata: {
          source: 'test',
          toolName: 'grep',
          sessionId: 'demo',
          tags: [],
        },
        relevance: {
          overall: 0.6,
          components: { recency: 0.8, frequency: 0.5, semantic: 0.6, attention: 0.5, expert: 0.6 },
          scoredAt: Date.now(),
          confidence: 0.85,
        },
        tier: 'warm',
        accessCount: 0,
        lastAccessedAt: Date.now(),
      },
    },
    {
      name: 'Bash Output',
      entry: {
        id: 'entry-3',
        type: 'bash_output',
        content: BASH_OUTPUT_SAMPLE,
        tokens: Math.ceil(BASH_OUTPUT_SAMPLE.length / 4),
        timestamp: Date.now(),
        metadata: {
          source: 'test',
          sessionId: 'demo',
          tags: [],
        },
        relevance: {
          overall: 0.5,
          components: { recency: 0.7, frequency: 0.4, semantic: 0.5, attention: 0.4, expert: 0.5 },
          scoredAt: Date.now(),
          confidence: 0.8,
        },
        tier: 'cold',
        accessCount: 0,
        lastAccessedAt: Date.now(),
      },
    },
  ];

  console.log('\n  Auto-selected strategies and results:');
  console.log('  ' + '─'.repeat(60));

  let totalOriginal = 0;
  let totalCompressed = 0;

  for (const { name, entry } of entries) {
    const selectedStrategy = manager.selectStrategy(entry);
    const result = await manager.compress(entry);

    totalOriginal += result.originalTokens;
    totalCompressed += result.compressedTokens;

    console.log(`\n  ${name}:`);
    console.log(`    Strategy:   ${selectedStrategy.name}`);
    console.log(`    Original:   ${result.originalTokens} tokens`);
    console.log(`    Compressed: ${result.compressedTokens} tokens`);
    console.log(`    Saved:      ${((1 - result.ratio) * 100).toFixed(1)}%`);
  }

  console.log('\n  ' + '═'.repeat(60));
  console.log(`  TOTAL COMPRESSION RESULTS:`);
  console.log(`    Original tokens:   ${totalOriginal}`);
  console.log(`    Compressed tokens: ${totalCompressed}`);
  console.log(`    Overall savings:   ${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}%`);

  // ========================================
  // Summary
  // ========================================
  console.log('\n' + '═'.repeat(70));
  console.log('  COMPRESSION STRATEGY SUMMARY');
  console.log('═'.repeat(70));

  console.log(`
  ┌───────────────────────────────┬──────────────┬────────────────────────────┐
  │ Strategy                      │ Best For     │ Typical Savings            │
  ├───────────────────────────────┼──────────────┼────────────────────────────┤
  │ Summary Compression           │ All types    │ 65-85% (rule-based)        │
  │ Quantized Int8                │ Code/JSON    │ 15-30% (pattern encoding)  │
  │ Quantized Int4                │ Code/JSON    │ 30-45% (aggressive)        │
  │ Structural Compression        │ Large code   │ 75-90% (AST extraction)    │
  │ Delta Compression             │ Incremental  │ 60-90% (diff-based)        │
  │ Semantic Deduplication        │ Repeated     │ 10-40% (cross-entry)       │
  └───────────────────────────────┴──────────────┴────────────────────────────┘

  The CompressionManager automatically selects the best strategy based on:
  • Entry type (file_read, tool_result, bash_output, etc.)
  • Content size (structural for large files)
  • Available context (delta needs base entries)

  Combined with tier-based compression:
  • Hot tier:  100% (no compression)
  • Warm tier: ~25% of original (75% savings)
  • Cold tier: ~3% of original (97% savings)
`);

  console.log('═'.repeat(70));
}

main().catch(console.error);
