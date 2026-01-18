#!/usr/bin/env npx tsx
/**
 * Compaction Comparison Test
 *
 * Demonstrates:
 * 1. WITHOUT optimization - cache grows unbounded, compaction would trigger
 * 2. WITH optimization - proactive pruning prevents compaction
 * 3. Optimization strategies in action
 */

import { CacheOptimizer } from '../src/core/orchestrator.js';
import type { CacheOptimizerConfig, CacheEntryType, ScoringContext } from '../src/types.js';

process.env.CLAUDE_FLOW_HEADLESS = 'true';

// Small context window to trigger thresholds quickly
const CONTEXT_WINDOW = 15000; // 15k tokens

const BASE_CONFIG: Partial<CacheOptimizerConfig> = {
  contextWindowSize: CONTEXT_WINDOW,
  targetUtilization: 0.60,
  pruning: {
    softThreshold: 0.45,
    hardThreshold: 0.55,
    emergencyThreshold: 0.65,
    minRelevanceScore: 0.25,
    strategy: 'adaptive',
    preservePatterns: ['system_prompt'],
    preserveRecentCount: 3,
  },
  temporal: {
    tiers: {
      hot: { maxAge: 200, compressionRatio: 1.0 },
      warm: { maxAge: 1000, compressionRatio: 0.25 },
      cold: { maxAge: Infinity, compressionRatio: 0.03 },
    },
    compressionStrategy: 'hybrid',
    promoteOnAccess: true,
    decayRate: 0.2,
  },
};

function generateContent(index: number): string {
  return `// Code block ${index}\n` +
    Array.from({ length: 30 }, (_, i) =>
      `  const value${i} = process("data_${index}_${i}"); // Line ${i}`
    ).join('\n');
}

// ============================================================================
// TEST 1: Without Optimization (Passive Mode)
// ============================================================================
async function runWithoutOptimization(): Promise<{
  finalUtilization: number;
  entriesCount: number;
  wouldCompact: boolean;
  utilizationHistory: number[];
}> {
  console.log('\n' + '═'.repeat(70));
  console.log('  TEST 1: WITHOUT OPTIMIZATION (Passive - No Pruning)');
  console.log('═'.repeat(70));

  const optimizer = new CacheOptimizer({
    ...BASE_CONFIG,
    // Disable pruning by setting very high thresholds
    pruning: {
      ...BASE_CONFIG.pruning!,
      softThreshold: 10.0,    // Never trigger
      hardThreshold: 10.0,
      emergencyThreshold: 10.0,
    },
  });

  const utilizationHistory: number[] = [];
  const entryTypes: CacheEntryType[] = ['file_read', 'tool_result', 'bash_output'];

  console.log(`\n  Context Window: ${CONTEXT_WINDOW} tokens`);
  console.log(`  Compaction Threshold: 75% (${CONTEXT_WINDOW * 0.75} tokens)`);
  console.log(`  Emergency Threshold: 65% (${CONTEXT_WINDOW * 0.65} tokens)\n`);

  console.log('  Adding entries without pruning...\n');
  console.log('  ┌────────┬──────────────┬──────────────┬────────────────────┐');
  console.log('  │ Entry  │ Tokens       │ Utilization  │ Status             │');
  console.log('  ├────────┼──────────────┼──────────────┼────────────────────┤');

  for (let i = 0; i < 50; i++) {
    const type = entryTypes[i % entryTypes.length];
    await optimizer.add(generateContent(i), type, { source: `test:${type}` });

    const metrics = optimizer.getMetrics();
    utilizationHistory.push(metrics.utilization);

    if ((i + 1) % 5 === 0) {
      const status = metrics.utilization >= 0.75
        ? '🔴 COMPACTION ZONE!'
        : metrics.utilization >= 0.65
          ? '🟠 EMERGENCY ZONE'
          : metrics.utilization >= 0.45
            ? '🟡 Soft threshold'
            : '🟢 Normal';

      console.log(`  │ ${(i + 1).toString().padStart(6)} │ ${metrics.currentTokens.toString().padStart(12)} │ ${(metrics.utilization * 100).toFixed(1).padStart(10)}% │ ${status.padEnd(18)} │`);
    }
  }

  console.log('  └────────┴──────────────┴──────────────┴────────────────────┘');

  const finalMetrics = optimizer.getMetrics();
  const wouldCompact = finalMetrics.utilization >= 0.75;

  console.log(`\n  📊 Final State:`);
  console.log(`     Entries: ${optimizer.getEntries().length}`);
  console.log(`     Tokens: ${finalMetrics.currentTokens}`);
  console.log(`     Utilization: ${(finalMetrics.utilization * 100).toFixed(1)}%`);
  console.log(`     Would Compact: ${wouldCompact ? '❌ YES - COMPACTION REQUIRED!' : '✅ No'}`);

  return {
    finalUtilization: finalMetrics.utilization,
    entriesCount: optimizer.getEntries().length,
    wouldCompact,
    utilizationHistory,
  };
}

// ============================================================================
// TEST 2: With Optimization (Active Pruning)
// ============================================================================
async function runWithOptimization(): Promise<{
  finalUtilization: number;
  entriesCount: number;
  compactionPrevented: boolean;
  tokensSaved: number;
  pruneEvents: number;
  compressionEvents: number;
  utilizationHistory: number[];
  optimizationDetails: string[];
}> {
  console.log('\n' + '═'.repeat(70));
  console.log('  TEST 2: WITH OPTIMIZATION (Active Pruning & Compression)');
  console.log('═'.repeat(70));

  const optimizer = new CacheOptimizer(BASE_CONFIG);
  const utilizationHistory: number[] = [];
  const optimizationDetails: string[] = [];
  const entryTypes: CacheEntryType[] = ['file_read', 'tool_result', 'bash_output'];

  let totalTokensSaved = 0;
  let pruneEvents = 0;
  let compressionEvents = 0;
  let compactionPrevented = false;

  console.log(`\n  Context Window: ${CONTEXT_WINDOW} tokens`);
  console.log(`  Soft Threshold: 45% (${CONTEXT_WINDOW * 0.45} tokens)`);
  console.log(`  Hard Threshold: 55% (${CONTEXT_WINDOW * 0.55} tokens)`);
  console.log(`  Emergency Threshold: 65% (${CONTEXT_WINDOW * 0.65} tokens)\n`);

  console.log('  Adding entries with active optimization...\n');
  console.log('  ┌────────┬──────────────┬──────────────┬───────────┬─────────────────────┐');
  console.log('  │ Entry  │ Tokens       │ Utilization  │ Saved     │ Action              │');
  console.log('  ├────────┼──────────────┼──────────────┼───────────┼─────────────────────┤');

  for (let i = 0; i < 50; i++) {
    const type = entryTypes[i % entryTypes.length];
    await optimizer.add(generateContent(i), type, {
      source: `test:${type}`,
      sessionId: 'optimization-test',
    });

    // Let entries age
    await new Promise(resolve => setTimeout(resolve, 20));

    // Check every 5 entries
    if ((i + 1) % 5 === 0) {
      const beforeMetrics = optimizer.getMetrics();

      // Trigger optimization via hook
      const context: ScoringContext = {
        currentQuery: `Query about entry ${i}`,
        activeFiles: [],
        activeTools: [],
        sessionId: 'optimization-test',
        timestamp: Date.now(),
      };

      await optimizer.scoreAll(context);
      const hookResult = await optimizer.onUserPromptSubmit(`Prompt ${i}`, 'optimization-test');

      // Process tier transitions
      const transResult = await optimizer.transitionTiers();

      const afterMetrics = optimizer.getMetrics();
      utilizationHistory.push(afterMetrics.utilization);

      let action = '—';
      if (hookResult.tokensFreed > 0) {
        totalTokensSaved += hookResult.tokensFreed;
        pruneEvents++;
        action = `✂️ Pruned ${hookResult.tokensFreed}`;
        if (hookResult.compactionPrevented) {
          compactionPrevented = true;
          action = `🛡️ PREVENTED!`;
          optimizationDetails.push(`Entry ${i+1}: Compaction prevented, freed ${hookResult.tokensFreed} tokens`);
        }
      }
      if (transResult.tokensSaved > 0) {
        totalTokensSaved += transResult.tokensSaved;
        compressionEvents += transResult.hotToWarm + transResult.warmToCold;
        if (action === '—') action = `📦 Compressed`;
        optimizationDetails.push(`Entry ${i+1}: Tier transitions (H→W:${transResult.hotToWarm}, W→C:${transResult.warmToCold})`);
      }

      console.log(`  │ ${(i + 1).toString().padStart(6)} │ ${afterMetrics.currentTokens.toString().padStart(12)} │ ${(afterMetrics.utilization * 100).toFixed(1).padStart(10)}% │ ${totalTokensSaved.toString().padStart(9)} │ ${action.padEnd(19)} │`);
    }
  }

  console.log('  └────────┴──────────────┴──────────────┴───────────┴─────────────────────┘');

  const finalMetrics = optimizer.getMetrics();
  const entries = optimizer.getEntries();
  const tierCounts = { hot: 0, warm: 0, cold: 0, archived: 0 };
  entries.forEach(e => tierCounts[e.tier]++);

  console.log(`\n  📊 Final State:`);
  console.log(`     Entries: ${entries.length}`);
  console.log(`     Tokens: ${finalMetrics.currentTokens}`);
  console.log(`     Utilization: ${(finalMetrics.utilization * 100).toFixed(1)}%`);
  console.log(`     Tokens Saved: ${totalTokensSaved}`);
  console.log(`     Prune Events: ${pruneEvents}`);
  console.log(`     Compression Events: ${compressionEvents}`);
  console.log(`\n  🌡️ Tier Distribution:`);
  console.log(`     Hot:  ${tierCounts.hot} entries`);
  console.log(`     Warm: ${tierCounts.warm} entries`);
  console.log(`     Cold: ${tierCounts.cold} entries`);

  return {
    finalUtilization: finalMetrics.utilization,
    entriesCount: entries.length,
    compactionPrevented: finalMetrics.utilization < 0.75,
    tokensSaved: totalTokensSaved,
    pruneEvents,
    compressionEvents,
    utilizationHistory,
    optimizationDetails,
  };
}

// ============================================================================
// TEST 3: Explain Optimization Strategies
// ============================================================================
function explainOptimizationStrategies(): void {
  console.log('\n' + '═'.repeat(70));
  console.log('  OPTIMIZATION STRATEGIES EXPLAINED');
  console.log('═'.repeat(70));

  console.log(`
  The cache optimizer uses multiple strategies to prevent compaction:

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 1. RELEVANCE-BASED SCORING                                          │
  ├─────────────────────────────────────────────────────────────────────┤
  │ Each entry gets a relevance score (0-1) based on:                   │
  │ • Temporal decay: Older entries score lower                         │
  │ • Type weights: system_prompt=1.0, file_read=0.8, bash_output=0.6  │
  │ • Recency: Recently accessed entries score higher                   │
  │ • Context: Entries matching current query/files score higher        │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 2. LRU EVICTION (Least Recently Used)                               │
  ├─────────────────────────────────────────────────────────────────────┤
  │ When relevance-based pruning isn't enough:                          │
  │ • Sort entries by lastAccessedAt (oldest first)                     │
  │ • Evict oldest entries until utilization target reached             │
  │ • Emergency mode: Even high-relevance old entries get evicted       │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 3. TIER COMPRESSION                                                 │
  ├─────────────────────────────────────────────────────────────────────┤
  │ Entries move through tiers as they age:                             │
  │                                                                      │
  │   HOT (100%)  ──[age]──>  WARM (25%)  ──[age]──>  COLD (3%)         │
  │                                                                      │
  │ Compression ratios:                                                  │
  │ • Hot: No compression (full content)                                │
  │ • Warm: 75% reduction (summaries, key points)                       │
  │ • Cold: 97% reduction (metadata only)                               │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 4. PROACTIVE THRESHOLD TRIGGERS                                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │ Optimization triggers at different utilization levels:              │
  │                                                                      │
  │   0%────45%────55%────65%────75%────100%                            │
  │         ↑      ↑      ↑      ↑                                      │
  │        SOFT   HARD  EMERG  COMPACT                                  │
  │                                                                      │
  │ • Soft (45%): Start gentle pruning of low-relevance entries         │
  │ • Hard (55%): Aggressive pruning + tier compression                 │
  │ • Emergency (65%): LRU eviction of any old entries                  │
  │ • Compact (75%): PREVENTED - never reaches this!                    │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │ 5. PRESERVATION RULES                                               │
  ├─────────────────────────────────────────────────────────────────────┤
  │ Some entries are NEVER pruned:                                      │
  │ • system_prompt: Always preserved                                   │
  │ • claude_md: Project instructions preserved                         │
  │ • Recent entries: Last N entries protected (configurable)           │
  └─────────────────────────────────────────────────────────────────────┘
`);
}

// ============================================================================
// Main
// ============================================================================
async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           COMPACTION COMPARISON: ENABLED vs DISABLED              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // Run without optimization
  const withoutResult = await runWithoutOptimization();

  // Run with optimization
  const withResult = await runWithOptimization();

  // Explain strategies
  explainOptimizationStrategies();

  // Final comparison
  console.log('\n' + '═'.repeat(70));
  console.log('  FINAL COMPARISON');
  console.log('═'.repeat(70));

  console.log(`
  ┌─────────────────────────────┬──────────────────┬──────────────────┐
  │ Metric                      │ WITHOUT Optimize │ WITH Optimize    │
  ├─────────────────────────────┼──────────────────┼──────────────────┤
  │ Final Utilization           │ ${(withoutResult.finalUtilization * 100).toFixed(1).padStart(14)}% │ ${(withResult.finalUtilization * 100).toFixed(1).padStart(14)}% │
  │ Entries Remaining           │ ${withoutResult.entriesCount.toString().padStart(16)} │ ${withResult.entriesCount.toString().padStart(16)} │
  │ Tokens Saved                │ ${(0).toString().padStart(16)} │ ${withResult.tokensSaved.toString().padStart(16)} │
  │ Compaction Would Occur      │ ${(withoutResult.wouldCompact ? '❌ YES' : '✅ NO').padStart(16)} │ ${(withResult.compactionPrevented ? '✅ NO' : '❌ YES').padStart(16)} │
  └─────────────────────────────┴──────────────────┴──────────────────┘
  `);

  if (withoutResult.wouldCompact && withResult.compactionPrevented) {
    console.log('  ✅ SUCCESS: Compaction was PREVENTED by optimization!');
    console.log(`     • Reduced utilization from ${(withoutResult.finalUtilization * 100).toFixed(1)}% to ${(withResult.finalUtilization * 100).toFixed(1)}%`);
    console.log(`     • Saved ${withResult.tokensSaved} tokens through pruning/compression`);
    console.log(`     • Maintained ${withResult.entriesCount} entries vs ${withoutResult.entriesCount} without optimization`);
  } else if (!withoutResult.wouldCompact) {
    console.log('  ℹ️ Note: Cache never reached compaction threshold in passive test.');
    console.log('     Increase entry count or decrease context window to see compaction.');
  } else {
    console.log('  ⚠️ Optimization did not fully prevent compaction.');
  }

  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
