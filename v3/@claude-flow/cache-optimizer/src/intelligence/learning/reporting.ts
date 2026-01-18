/**
 * @claude-flow/cache-optimizer - Reporting Functionality
 *
 * Comprehensive reporting for GNN/GRNN intelligence layer performance,
 * learning progress, and cache optimization effectiveness.
 */

import type { TemporalTier, CacheEntryType } from '../../types.js';
import type { MetricSnapshot, LearningMetrics, MetricAlert, TimeSeriesMetric } from './measurement.js';
import type { TuningTrial, RefinementResult, RefinementRecommendation } from './refinement.js';

// ============================================================================
// Types
// ============================================================================

export type ReportFormat = 'json' | 'markdown' | 'html' | 'terminal';
export type ReportLevel = 'summary' | 'detailed' | 'full';

export interface ReportConfig {
  format: ReportFormat;
  level: ReportLevel;
  includeCharts: boolean;
  includeRecommendations: boolean;
  includeHistory: boolean;
  historyWindow: number;          // ms of history to include
  outputPath?: string;
}

export interface ReportSection {
  title: string;
  content: string | Record<string, unknown>;
  level: 'h1' | 'h2' | 'h3';
  charts?: ChartData[];
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'heatmap';
  title: string;
  data: Array<{ label: string; value: number; color?: string }>;
  xLabel?: string;
  yLabel?: string;
}

export interface PerformanceReport {
  timestamp: number;
  sessionId: string;
  duration: number;
  summary: PerformanceSummary;
  gnn: GNNReport;
  grnn: GRNNReport;
  cache: CacheReport;
  refinement: RefinementReport;
  alerts: AlertReport;
  recommendations: RefinementRecommendation[];
}

export interface PerformanceSummary {
  overallScore: number;           // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  highlights: string[];
  concerns: string[];
  keyMetrics: {
    hitRate: number;
    tokenSavings: number;
    avgLatency: number;
    errorRate: number;
    learningProgress: number;
  };
}

export interface GNNReport {
  status: 'healthy' | 'degraded' | 'failed';
  nodeCount: number;
  edgeCount: number;
  graphDensity: number;
  clusteringQuality: number;
  layerEfficiency: number[];
  forwardPassStats: {
    avgLatency: number;
    p95Latency: number;
    throughput: number;
  };
  topPatterns: Array<{
    pattern: string;
    confidence: number;
    occurrences: number;
  }>;
}

export interface GRNNReport {
  status: 'healthy' | 'degraded' | 'failed';
  sequenceStats: {
    avgLength: number;
    maxLength: number;
    totalEvents: number;
  };
  learningProgress: {
    currentLoss: number;
    lossTrend: 'improving' | 'stable' | 'degrading';
    epochsCompleted: number;
    convergencePercent: number;
  };
  predictionAccuracy: {
    overall: number;
    byEventType: Record<string, number>;
    confusionMatrix?: number[][];
  };
  ewcStatus: {
    fisherSum: number;
    regularizationStrength: number;
    tasksRemembered: number;
  };
}

export interface CacheReport {
  efficiency: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
    avgRelevance: number;
  };
  tokenEconomics: {
    totalSaved: number;
    avgSavingsPerHit: number;
    projectedDailySavings: number;
  };
  tierAnalysis: {
    distribution: Record<TemporalTier, number>;
    transitionRates: Record<string, number>;
    tierHealth: Record<TemporalTier, 'optimal' | 'underutilized' | 'overloaded'>;
  };
  typeBreakdown: Record<CacheEntryType, {
    count: number;
    hitRate: number;
    avgRelevance: number;
  }>;
}

export interface RefinementReport {
  status: 'active' | 'converged' | 'idle';
  trialsCompleted: number;
  bestScore: number;
  improvementPercent: number;
  topHyperparameters: Array<{
    name: string;
    value: number | string;
    impact: number;
  }>;
  convergenceEstimate: number;    // trials to convergence
}

export interface AlertReport {
  active: MetricAlert[];
  resolved: number;
  total: number;
  byType: Record<string, number>;
  criticalCount: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ReportConfig = {
  format: 'markdown',
  level: 'detailed',
  includeCharts: true,
  includeRecommendations: true,
  includeHistory: true,
  historyWindow: 3600000, // 1 hour
};

// ============================================================================
// Report Generator
// ============================================================================

export class ReportGenerator {
  private config: ReportConfig;
  private snapshots: MetricSnapshot[] = [];
  private refinementHistory: TuningTrial[] = [];

  constructor(config: Partial<ReportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // Data Ingestion
  // --------------------------------------------------------------------------

  /**
   * Add metrics snapshot for reporting
   */
  addSnapshot(snapshot: MetricSnapshot): void {
    this.snapshots.push(snapshot);

    // Enforce history window
    const cutoff = Date.now() - this.config.historyWindow;
    this.snapshots = this.snapshots.filter(s => s.timestamp > cutoff);
  }

  /**
   * Add refinement trial
   */
  addRefinementTrial(trial: TuningTrial): void {
    this.refinementHistory.push(trial);
  }

  /**
   * Import refinement result
   */
  importRefinementResult(result: RefinementResult): void {
    this.refinementHistory = result.allTrials;
  }

  // --------------------------------------------------------------------------
  // Report Generation
  // --------------------------------------------------------------------------

  /**
   * Generate comprehensive performance report
   */
  generateReport(
    currentMetrics: MetricSnapshot,
    alerts: MetricAlert[] = [],
    recommendations: RefinementRecommendation[] = []
  ): PerformanceReport {
    const duration = this.snapshots.length > 0
      ? Date.now() - this.snapshots[0].timestamp
      : 0;

    return {
      timestamp: Date.now(),
      sessionId: currentMetrics.sessionId,
      duration,
      summary: this.generateSummary(currentMetrics),
      gnn: this.generateGNNReport(currentMetrics),
      grnn: this.generateGRNNReport(currentMetrics),
      cache: this.generateCacheReport(currentMetrics),
      refinement: this.generateRefinementReport(),
      alerts: this.generateAlertReport(alerts),
      recommendations: this.config.includeRecommendations ? recommendations : [],
    };
  }

  private generateSummary(metrics: MetricSnapshot): PerformanceSummary {
    const { cache, health, grnn } = metrics.metrics;

    // Calculate overall score (weighted)
    const hitRateScore = cache.hitRate.aggregations.mean * 30;
    const latencyScore = Math.max(0, 30 - (health.inferenceLatency.aggregations.mean / 10));
    const accuracyScore = grnn.predictionAccuracy.aggregations.mean * 20;
    const errorScore = Math.max(0, 20 - (health.errorRate * 200));

    const overallScore = Math.min(100, hitRateScore + latencyScore + accuracyScore + errorScore);

    // Determine grade
    let grade: PerformanceSummary['grade'] = 'F';
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';

    // Generate highlights and concerns
    const highlights: string[] = [];
    const concerns: string[] = [];

    if (cache.hitRate.aggregations.mean > 0.8) {
      highlights.push(`Excellent cache hit rate: ${(cache.hitRate.aggregations.mean * 100).toFixed(1)}%`);
    } else if (cache.hitRate.aggregations.mean < 0.5) {
      concerns.push(`Low cache hit rate: ${(cache.hitRate.aggregations.mean * 100).toFixed(1)}%`);
    }

    if (health.inferenceLatency.aggregations.mean < 10) {
      highlights.push(`Fast inference: ${health.inferenceLatency.aggregations.mean.toFixed(1)}ms avg`);
    } else if (health.inferenceLatency.aggregations.mean > 100) {
      concerns.push(`High latency: ${health.inferenceLatency.aggregations.mean.toFixed(1)}ms avg`);
    }

    if (grnn.predictionAccuracy.aggregations.mean > 0.8) {
      highlights.push(`High prediction accuracy: ${(grnn.predictionAccuracy.aggregations.mean * 100).toFixed(1)}%`);
    }

    if (health.errorRate > 0.05) {
      concerns.push(`Elevated error rate: ${(health.errorRate * 100).toFixed(2)}%`);
    }

    return {
      overallScore,
      grade,
      highlights,
      concerns,
      keyMetrics: {
        hitRate: cache.hitRate.aggregations.mean,
        tokenSavings: cache.tokenSavings.aggregations.mean,
        avgLatency: health.inferenceLatency.aggregations.mean,
        errorRate: health.errorRate,
        learningProgress: this.calculateLearningProgress(metrics),
      },
    };
  }

  private calculateLearningProgress(metrics: MetricSnapshot): number {
    const { grnn } = metrics.metrics;

    // Based on loss improvement and prediction accuracy
    const lossProgress = Math.max(0, 1 - grnn.trainingLoss.aggregations.mean);
    const accuracyProgress = grnn.predictionAccuracy.aggregations.mean;

    return (lossProgress + accuracyProgress) / 2;
  }

  private generateGNNReport(metrics: MetricSnapshot): GNNReport {
    const { gnn } = metrics.metrics;

    const graphDensity = gnn.nodeCount > 0
      ? gnn.edgeCount / (gnn.nodeCount * (gnn.nodeCount - 1))
      : 0;

    const status: GNNReport['status'] =
      gnn.forwardPassLatency.aggregations.mean < 50 ? 'healthy' :
      gnn.forwardPassLatency.aggregations.mean < 200 ? 'degraded' : 'failed';

    return {
      status,
      nodeCount: gnn.nodeCount,
      edgeCount: gnn.edgeCount,
      graphDensity,
      clusteringQuality: gnn.clusteringCoefficient,
      layerEfficiency: gnn.layerActivations.map((a, i) =>
        i > 0 ? a / gnn.layerActivations[i - 1] : 1
      ),
      forwardPassStats: {
        avgLatency: gnn.forwardPassLatency.aggregations.mean,
        p95Latency: gnn.forwardPassLatency.aggregations.p95,
        throughput: 1000 / Math.max(gnn.forwardPassLatency.aggregations.mean, 1),
      },
      topPatterns: [], // Would be populated from GNN pattern analysis
    };
  }

  private generateGRNNReport(metrics: MetricSnapshot): GRNNReport {
    const { grnn } = metrics.metrics;

    // Determine loss trend
    const recentLoss = grnn.trainingLoss.aggregations.mean;
    const lossChange = this.calculateTrend(
      this.snapshots.map(s => s.metrics.grnn.trainingLoss.aggregations.mean)
    );

    const lossTrend: GRNNReport['learningProgress']['lossTrend'] =
      lossChange < -0.01 ? 'improving' :
      lossChange > 0.01 ? 'degrading' : 'stable';

    const status: GRNNReport['status'] =
      grnn.predictionAccuracy.aggregations.mean > 0.7 ? 'healthy' :
      grnn.predictionAccuracy.aggregations.mean > 0.4 ? 'degraded' : 'failed';

    return {
      status,
      sequenceStats: {
        avgLength: grnn.sequenceLength,
        maxLength: grnn.sequenceLength * 2, // Estimate
        totalEvents: this.snapshots.length * grnn.sequenceLength,
      },
      learningProgress: {
        currentLoss: recentLoss,
        lossTrend,
        epochsCompleted: this.refinementHistory.length,
        convergencePercent: Math.min(100, grnn.predictionAccuracy.aggregations.mean * 100),
      },
      predictionAccuracy: {
        overall: grnn.predictionAccuracy.aggregations.mean,
        byEventType: {}, // Would be populated from detailed tracking
      },
      ewcStatus: {
        fisherSum: grnn.fisherInformationSum,
        regularizationStrength: grnn.ewcRegularization,
        tasksRemembered: Math.floor(grnn.fisherInformationSum / 100),
      },
    };
  }

  private generateCacheReport(metrics: MetricSnapshot): CacheReport {
    const { cache } = metrics.metrics;

    const tierHealth: Record<TemporalTier, 'optimal' | 'underutilized' | 'overloaded'> = {
      hot: 'optimal',
      warm: 'optimal',
      cold: 'optimal',
      archived: 'optimal',
    };

    const totalEntries = Object.values(cache.tierDistribution).reduce((a, b) => a + b, 0);
    const hotRatio = totalEntries > 0 ? cache.tierDistribution.hot / totalEntries : 0;
    const coldRatio = totalEntries > 0 ? cache.tierDistribution.cold / totalEntries : 0;

    if (hotRatio > 0.7) tierHealth.hot = 'overloaded';
    else if (hotRatio < 0.1) tierHealth.hot = 'underutilized';

    if (coldRatio > 0.5) tierHealth.cold = 'overloaded';

    // Calculate daily projections
    const msPerDay = 86400000;
    const currentRate = cache.tokenSavings.aggregations.mean;
    const samplesPerDay = msPerDay / 1000; // Assuming 1 sample/second

    return {
      efficiency: {
        hitRate: cache.hitRate.aggregations.mean,
        missRate: cache.missRate.aggregations.mean,
        evictionRate: cache.evictionRate.aggregations.mean,
        avgRelevance: cache.avgRelevanceScore,
      },
      tokenEconomics: {
        totalSaved: cache.tokenSavings.aggregations.mean * this.snapshots.length,
        avgSavingsPerHit: cache.tokenSavings.aggregations.mean / Math.max(cache.hitRate.aggregations.mean, 0.01),
        projectedDailySavings: currentRate * samplesPerDay,
      },
      tierAnalysis: {
        distribution: cache.tierDistribution,
        transitionRates: this.calculateTierTransitions(),
        tierHealth,
      },
      typeBreakdown: this.calculateTypeBreakdown(cache),
    };
  }

  private calculateTierTransitions(): Record<string, number> {
    // Placeholder - would calculate actual transition rates from history
    return {
      'hot→warm': 0.1,
      'warm→cold': 0.05,
      'cold→archived': 0.02,
      'warm→hot': 0.15,
      'cold→warm': 0.03,
    };
  }

  private calculateTypeBreakdown(cache: LearningMetrics['cache']): CacheReport['typeBreakdown'] {
    const breakdown: CacheReport['typeBreakdown'] = {
      context: { count: 0, hitRate: 0, avgRelevance: 0 },
      result: { count: 0, hitRate: 0, avgRelevance: 0 },
      embedding: { count: 0, hitRate: 0, avgRelevance: 0 },
      pattern: { count: 0, hitRate: 0, avgRelevance: 0 },
      decision: { count: 0, hitRate: 0, avgRelevance: 0 },
    };

    for (const type of Object.keys(breakdown) as CacheEntryType[]) {
      breakdown[type].count = cache.typeDistribution[type] || 0;
      breakdown[type].hitRate = cache.hitRate.aggregations.mean; // Simplified
      breakdown[type].avgRelevance = cache.avgRelevanceScore;
    }

    return breakdown;
  }

  private generateRefinementReport(): RefinementReport {
    if (this.refinementHistory.length === 0) {
      return {
        status: 'idle',
        trialsCompleted: 0,
        bestScore: 0,
        improvementPercent: 0,
        topHyperparameters: [],
        convergenceEstimate: 0,
      };
    }

    const bestTrial = this.refinementHistory.reduce(
      (best, trial) => trial.score > best.score ? trial : best
    );

    const firstTrial = this.refinementHistory[0];
    const improvementPercent = ((bestTrial.score - firstTrial.score) / Math.max(firstTrial.score, 0.001)) * 100;

    // Check convergence
    const recentTrials = this.refinementHistory.slice(-10);
    const recentScores = recentTrials.map(t => t.score);
    const scoreVariance = this.calculateVariance(recentScores);
    const isConverged = scoreVariance < 0.001;

    // Estimate trials to convergence
    const convergenceEstimate = isConverged ? 0 : Math.max(0, 50 - this.refinementHistory.length);

    // Top hyperparameters
    const topHyperparameters = Object.entries(bestTrial.hyperparameters)
      .map(([name, value]) => ({
        name,
        value,
        impact: this.estimateHyperparameterImpact(name),
      }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 5);

    return {
      status: isConverged ? 'converged' : 'active',
      trialsCompleted: this.refinementHistory.length,
      bestScore: bestTrial.score,
      improvementPercent,
      topHyperparameters,
      convergenceEstimate,
    };
  }

  private estimateHyperparameterImpact(name: string): number {
    // Simplified impact estimation based on parameter category
    if (name.includes('learning_rate')) return 0.9;
    if (name.includes('hidden')) return 0.7;
    if (name.includes('threshold')) return 0.6;
    if (name.includes('dropout')) return 0.5;
    return 0.3;
  }

  private generateAlertReport(alerts: MetricAlert[]): AlertReport {
    const active = alerts.filter(a => !a.resolved);
    const resolved = alerts.filter(a => a.resolved).length;

    const byType: Record<string, number> = {};
    for (const alert of alerts) {
      byType[alert.type] = (byType[alert.type] || 0) + 1;
    }

    return {
      active,
      resolved,
      total: alerts.length,
      byType,
      criticalCount: alerts.filter(a => a.type === 'critical' && !a.resolved).length,
    };
  }

  // --------------------------------------------------------------------------
  // Formatting
  // --------------------------------------------------------------------------

  /**
   * Format report for output
   */
  formatReport(report: PerformanceReport): string {
    switch (this.config.format) {
      case 'json':
        return this.formatJSON(report);
      case 'markdown':
        return this.formatMarkdown(report);
      case 'html':
        return this.formatHTML(report);
      case 'terminal':
        return this.formatTerminal(report);
      default:
        return this.formatJSON(report);
    }
  }

  private formatJSON(report: PerformanceReport): string {
    return JSON.stringify(report, null, 2);
  }

  private formatMarkdown(report: PerformanceReport): string {
    const lines: string[] = [];
    const { summary, gnn, grnn, cache, refinement, alerts } = report;

    // Header
    lines.push('# Cache Optimizer Intelligence Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date(report.timestamp).toISOString()}`);
    lines.push(`**Session:** ${report.sessionId}`);
    lines.push(`**Duration:** ${this.formatDuration(report.duration)}`);
    lines.push('');

    // Summary
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Overall Score | ${summary.overallScore.toFixed(1)}/100 (${summary.grade}) |`);
    lines.push(`| Hit Rate | ${(summary.keyMetrics.hitRate * 100).toFixed(1)}% |`);
    lines.push(`| Avg Latency | ${summary.keyMetrics.avgLatency.toFixed(1)}ms |`);
    lines.push(`| Token Savings | ${summary.keyMetrics.tokenSavings.toFixed(0)} |`);
    lines.push(`| Error Rate | ${(summary.keyMetrics.errorRate * 100).toFixed(2)}% |`);
    lines.push('');

    if (summary.highlights.length > 0) {
      lines.push('### Highlights');
      summary.highlights.forEach(h => lines.push(`- ✅ ${h}`));
      lines.push('');
    }

    if (summary.concerns.length > 0) {
      lines.push('### Concerns');
      summary.concerns.forEach(c => lines.push(`- ⚠️ ${c}`));
      lines.push('');
    }

    // GNN Section
    if (this.config.level !== 'summary') {
      lines.push('## GNN Performance');
      lines.push('');
      lines.push(`**Status:** ${this.formatStatus(gnn.status)}`);
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Nodes | ${gnn.nodeCount} |`);
      lines.push(`| Edges | ${gnn.edgeCount} |`);
      lines.push(`| Graph Density | ${(gnn.graphDensity * 100).toFixed(2)}% |`);
      lines.push(`| Clustering Coefficient | ${gnn.clusteringQuality.toFixed(3)} |`);
      lines.push(`| Avg Forward Pass | ${gnn.forwardPassStats.avgLatency.toFixed(2)}ms |`);
      lines.push(`| P95 Latency | ${gnn.forwardPassStats.p95Latency.toFixed(2)}ms |`);
      lines.push(`| Throughput | ${gnn.forwardPassStats.throughput.toFixed(1)} ops/s |`);
      lines.push('');

      // GRNN Section
      lines.push('## GRNN Learning');
      lines.push('');
      lines.push(`**Status:** ${this.formatStatus(grnn.status)}`);
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Current Loss | ${grnn.learningProgress.currentLoss.toFixed(4)} |`);
      lines.push(`| Loss Trend | ${grnn.learningProgress.lossTrend} |`);
      lines.push(`| Prediction Accuracy | ${(grnn.predictionAccuracy.overall * 100).toFixed(1)}% |`);
      lines.push(`| Convergence | ${grnn.learningProgress.convergencePercent.toFixed(1)}% |`);
      lines.push(`| EWC Regularization | ${grnn.ewcStatus.regularizationStrength.toFixed(4)} |`);
      lines.push(`| Tasks Remembered | ${grnn.ewcStatus.tasksRemembered} |`);
      lines.push('');
    }

    // Cache Section
    lines.push('## Cache Efficiency');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Hit Rate | ${(cache.efficiency.hitRate * 100).toFixed(1)}% |`);
    lines.push(`| Miss Rate | ${(cache.efficiency.missRate * 100).toFixed(1)}% |`);
    lines.push(`| Eviction Rate | ${cache.efficiency.evictionRate.toFixed(2)}/min |`);
    lines.push(`| Avg Relevance | ${cache.efficiency.avgRelevance.toFixed(3)} |`);
    lines.push('');

    lines.push('### Token Economics');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Saved | ${cache.tokenEconomics.totalSaved.toFixed(0)} tokens |`);
    lines.push(`| Avg per Hit | ${cache.tokenEconomics.avgSavingsPerHit.toFixed(1)} tokens |`);
    lines.push(`| Projected Daily | ${cache.tokenEconomics.projectedDailySavings.toFixed(0)} tokens |`);
    lines.push('');

    lines.push('### Tier Distribution');
    lines.push('');
    lines.push(`| Tier | Count | Health |`);
    lines.push(`|------|-------|--------|`);
    for (const tier of ['hot', 'warm', 'cold', 'archived'] as TemporalTier[]) {
      const count = cache.tierAnalysis.distribution[tier];
      const health = cache.tierAnalysis.tierHealth[tier];
      lines.push(`| ${tier} | ${count} | ${this.formatTierHealth(health)} |`);
    }
    lines.push('');

    // Refinement Section
    if (refinement.trialsCompleted > 0) {
      lines.push('## Auto-Tuning');
      lines.push('');
      lines.push(`**Status:** ${refinement.status}`);
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Trials Completed | ${refinement.trialsCompleted} |`);
      lines.push(`| Best Score | ${refinement.bestScore.toFixed(4)} |`);
      lines.push(`| Improvement | ${refinement.improvementPercent.toFixed(1)}% |`);
      lines.push(`| Est. Convergence | ${refinement.convergenceEstimate} trials |`);
      lines.push('');

      if (refinement.topHyperparameters.length > 0) {
        lines.push('### Top Hyperparameters');
        lines.push('');
        lines.push(`| Parameter | Value | Impact |`);
        lines.push(`|-----------|-------|--------|`);
        for (const hp of refinement.topHyperparameters) {
          lines.push(`| ${hp.name} | ${hp.value} | ${(hp.impact * 100).toFixed(0)}% |`);
        }
        lines.push('');
      }
    }

    // Alerts Section
    if (alerts.total > 0) {
      lines.push('## Alerts');
      lines.push('');
      lines.push(`Active: ${alerts.active.length} | Resolved: ${alerts.resolved} | Total: ${alerts.total}`);
      lines.push('');

      if (alerts.active.length > 0) {
        lines.push('### Active Alerts');
        lines.push('');
        for (const alert of alerts.active) {
          const icon = alert.type === 'critical' ? '🚨' : alert.type === 'error' ? '❌' : '⚠️';
          lines.push(`- ${icon} **${alert.type.toUpperCase()}**: ${alert.message}`);
        }
        lines.push('');
      }
    }

    // Recommendations
    if (this.config.includeRecommendations && report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      for (const rec of report.recommendations.slice(0, 5)) {
        lines.push(`### ${rec.parameter}`);
        lines.push(`- **Current:** ${rec.currentValue}`);
        lines.push(`- **Suggested:** ${rec.suggestedValue}`);
        lines.push(`- **Expected Improvement:** ${(rec.expectedImprovement * 100).toFixed(1)}%`);
        lines.push(`- **Confidence:** ${(rec.confidence * 100).toFixed(0)}%`);
        lines.push(`- **Reason:** ${rec.reason}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private formatHTML(report: PerformanceReport): string {
    // Convert markdown to HTML (simplified)
    const md = this.formatMarkdown(report);
    const html = md
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$3</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\|/g, '</td><td>');

    return `<!DOCTYPE html>
<html>
<head>
  <title>Cache Optimizer Report</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .healthy { color: green; }
    .degraded { color: orange; }
    .failed { color: red; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
  }

  private formatTerminal(report: PerformanceReport): string {
    const lines: string[] = [];
    const { summary, cache, alerts } = report;

    // Box drawing
    lines.push('╔════════════════════════════════════════════════════════════╗');
    lines.push('║           CACHE OPTIMIZER INTELLIGENCE REPORT              ║');
    lines.push('╚════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Score bar
    const scoreBar = '█'.repeat(Math.floor(summary.overallScore / 5)) +
                     '░'.repeat(20 - Math.floor(summary.overallScore / 5));
    lines.push(`Score: [${scoreBar}] ${summary.overallScore.toFixed(0)}/100 (${summary.grade})`);
    lines.push('');

    // Key metrics
    lines.push('┌─────────────────────────────────────────────────────────────┐');
    lines.push('│ KEY METRICS                                                 │');
    lines.push('├─────────────────────────────────────────────────────────────┤');
    lines.push(`│ Hit Rate:      ${this.padRight(`${(cache.efficiency.hitRate * 100).toFixed(1)}%`, 44)}│`);
    lines.push(`│ Avg Latency:   ${this.padRight(`${summary.keyMetrics.avgLatency.toFixed(1)}ms`, 44)}│`);
    lines.push(`│ Token Savings: ${this.padRight(`${summary.keyMetrics.tokenSavings.toFixed(0)}`, 44)}│`);
    lines.push(`│ Error Rate:    ${this.padRight(`${(summary.keyMetrics.errorRate * 100).toFixed(2)}%`, 44)}│`);
    lines.push('└─────────────────────────────────────────────────────────────┘');
    lines.push('');

    // Alerts
    if (alerts.criticalCount > 0) {
      lines.push(`🚨 ${alerts.criticalCount} CRITICAL ALERT(S)`);
    }
    if (alerts.active.length > 0) {
      lines.push(`⚠️  ${alerts.active.length} active alert(s)`);
    }

    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;

    const n = values.length;
    const recent = values.slice(-Math.min(10, n));
    const first = recent[0];
    const last = recent[recent.length - 1];

    return (last - first) / Math.max(Math.abs(first), 0.001);
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatStatus(status: 'healthy' | 'degraded' | 'failed'): string {
    switch (status) {
      case 'healthy': return '✅ Healthy';
      case 'degraded': return '⚠️ Degraded';
      case 'failed': return '❌ Failed';
    }
  }

  private formatTierHealth(health: 'optimal' | 'underutilized' | 'overloaded'): string {
    switch (health) {
      case 'optimal': return '✅ Optimal';
      case 'underutilized': return '📉 Underutilized';
      case 'overloaded': return '📈 Overloaded';
    }
  }

  private padRight(str: string, len: number): string {
    return str + ' '.repeat(Math.max(0, len - str.length));
  }

  /**
   * Reset report history
   */
  reset(): void {
    this.snapshots = [];
    this.refinementHistory = [];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createReportGenerator(
  config?: Partial<ReportConfig>
): ReportGenerator {
  return new ReportGenerator(config);
}
