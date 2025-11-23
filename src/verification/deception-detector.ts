/**
 * Deception Detector - AI Agent Truth Verification System
 *
 * Analyzes agent behavior patterns to detect and classify deceptive reporting:
 * - Overconfidence: Agents exaggerating success rates
 * - Fabrication: Creating false evidence or results
 * - Selective Reporting: Hiding failures or negative outcomes
 * - Gaslighting: Contradicting other agents or rewriting history
 * - Collusion: Multiple agents coordinating false reports
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface AgentReport {
  id: string;
  agentId: string;
  taskId: string;
  claimedOutcome: TaskOutcome;
  evidence: any;
  timestamp: number;
  truthScore?: number;
  verified: boolean;
  conflicts: string[];
}

interface TaskOutcome {
  success: boolean;
  testsPass: boolean;
  noErrors: boolean;
  performance: {
    improvement: number;
    metrics: Record<string, number>;
  };
  quality: {
    codeQuality: number;
    documentation: number;
    maintainability: number;
  };
}

interface DeceptionAnalysis {
  reportId?: string;
  agentId: string;
  truthScore: number;
  deceptionDetected: boolean;
  deceptionType: string[];
  confidence: number;
  evidence: any;
  recommendations: string[];
}

export class DeceptionDetector {
  private truthCalculator: any;
  private tempDir: string;
  private analysisHistory: Map<string, DeceptionAnalysis[]> = new Map();

  constructor(truthCalculator: any, tempDir: string) {
    this.truthCalculator = truthCalculator;
    this.tempDir = tempDir;
  }

  async initialize(): Promise<void> {
    // Create directories for storing detection data
    await fs.mkdir(path.join(this.tempDir, 'deception-analysis'), { recursive: true });
    await fs.mkdir(path.join(this.tempDir, 'agent-patterns'), { recursive: true });
  }

  /**
   * Analyze a pattern of reports from an agent to detect deception
   */
  async analyzeAgentPattern(agentId: string, reports: AgentReport[]): Promise<DeceptionAnalysis> {
    const analysis: DeceptionAnalysis = {
      agentId,
      truthScore: 1.0,
      deceptionDetected: false,
      deceptionType: [],
      confidence: 0,
      evidence: {},
      recommendations: []
    };

    if (reports.length === 0) {
      return analysis;
    }

    // Calculate success rate discrepancies
    const successRateAnalysis = this.analyzeSuccessRates(reports);
    if (successRateAnalysis.discrepancy > 0.15) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('overconfidence');
      analysis.evidence.successRateDiscrepancy = successRateAnalysis.discrepancy;
      analysis.confidence += 0.3;
    }

    // Analyze performance claims
    const performanceAnalysis = this.analyzePerformanceClaims(reports);
    if (performanceAnalysis.exaggeration > 0.1) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('exaggeration');
      analysis.evidence.performanceExaggeration = performanceAnalysis.exaggeration;
      analysis.confidence += 0.25;
    }

    // Analyze quality claims
    const qualityAnalysis = this.analyzeQualityClaims(reports);
    if (qualityAnalysis.inflation > 0.15) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('quality-inflation');
      analysis.evidence.qualityInflation = qualityAnalysis.inflation;
      analysis.confidence += 0.2;
    }

    // Check for pattern consistency
    const consistencyAnalysis = this.analyzeConsistency(reports);
    if (consistencyAnalysis.consistency < 0.5) {
      analysis.deceptionDetected = true;
      analysis.deceptionType.push('inconsistency');
      analysis.evidence.inconsistencyScore = 1 - consistencyAnalysis.consistency;
      analysis.confidence += 0.25;
    }

    // Calculate overall truth score
    analysis.truthScore = this.calculateOverallTruthScore(reports, analysis);

    // Ensure confidence doesn't exceed 1.0
    analysis.confidence = Math.min(analysis.confidence, 1.0);

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);

    // Store analysis
    if (!this.analysisHistory.has(agentId)) {
      this.analysisHistory.set(agentId, []);
    }
    this.analysisHistory.get(agentId)!.push(analysis);

    return analysis;
  }

  /**
   * Analyze single report for deception indicators
   */
  async analyzeSingleReport(report: AgentReport, historicalReports: AgentReport[]): Promise<DeceptionAnalysis> {
    const allReports = [...historicalReports, report];
    const analysis = await this.analyzeAgentPattern(report.agentId, allReports);
    analysis.reportId = report.id;
    return analysis;
  }

  /**
   * Detect fabrication patterns
   */
  detectFabrication(report: AgentReport): {
    isFabricated: boolean;
    confidence: number;
    indicators: string[];
  } {
    const indicators: string[];
    = [];
    let fabricationScore = 0;

    // Check for suspiciously perfect results
    if (report.claimedOutcome.testsPass &&
        report.claimedOutcome.noErrors &&
        report.claimedOutcome.success &&
        report.claimedOutcome.quality.codeQuality > 0.95) {
      indicators.push('suspiciously-perfect-results');
      fabricationScore += 0.3;
    }

    // Check for lack of detailed evidence
    if (!report.evidence || Object.keys(report.evidence).length < 3) {
      indicators.push('insufficient-evidence');
      fabricationScore += 0.2;
    }

    // Check for unrealistic timing
    if (report.timestamp && report.evidence?.duration) {
      if (report.evidence.duration < 1000) {
        indicators.push('unrealistically-fast-completion');
        fabricationScore += 0.25;
      }
    }

    // Check for pattern of consistent overperformance
    if (report.claimedOutcome.performance.improvement > 0.5) {
      indicators.push('unrealistic-performance-improvement');
      fabricationScore += 0.25;
    }

    return {
      isFabricated: fabricationScore > 0.5,
      confidence: Math.min(fabricationScore, 1.0),
      indicators
    };
  }

  /**
   * Detect selective reporting patterns
   */
  detectSelectiveReporting(reports: AgentReport[]): {
    isSelective: boolean;
    confidence: number;
    evidence: any;
  } {
    if (reports.length < 5) {
      return { isSelective: false, confidence: 0, evidence: {} };
    }

    const successCount = reports.filter(r => r.claimedOutcome.success).length;
    const successRate = successCount / reports.length;

    // If agent reports almost 100% success, likely selective reporting
    if (successRate > 0.95 && reports.length > 10) {
      return {
        isSelective: true,
        confidence: 0.8,
        evidence: {
          reportedSuccessRate: successRate,
          totalReports: reports.length,
          pattern: 'always-positive'
        }
      };
    }

    // Check for missing failure reports
    const errorReports = reports.filter(r => !r.claimedOutcome.noErrors);
    if (errorReports.length === 0 && reports.length > 15) {
      return {
        isSelective: true,
        confidence: 0.7,
        evidence: {
          pattern: 'no-errors-reported',
          totalReports: reports.length
        }
      };
    }

    return { isSelective: false, confidence: 0, evidence: {} };
  }

  /**
   * Detect gaslighting patterns (contradicting others or rewriting history)
   */
  detectGaslighting(report: AgentReport, otherReports: AgentReport[]): {
    isGaslighting: boolean;
    confidence: number;
    contradictions: string[];
  } {
    const contradictions: string[] = [];

    // Check for contradictions with other agents on same task
    const sameTaskReports = otherReports.filter(r => r.taskId === report.taskId && r.agentId !== report.agentId);

    for (const otherReport of sameTaskReports) {
      if (report.claimedOutcome.success !== otherReport.claimedOutcome.success) {
        contradictions.push(`Contradicts ${otherReport.agentId} on task success`);
      }

      if (Math.abs(report.claimedOutcome.performance.improvement - otherReport.claimedOutcome.performance.improvement) > 0.3) {
        contradictions.push(`Large discrepancy in performance claims vs ${otherReport.agentId}`);
      }
    }

    return {
      isGaslighting: contradictions.length >= 2,
      confidence: Math.min(contradictions.length * 0.3, 1.0),
      contradictions
    };
  }

  private analyzeSuccessRates(reports: AgentReport[]): { discrepancy: number } {
    // In a real scenario, we'd compare claimed vs actual
    // For testing, we'll simulate this by checking consistency
    const claimedSuccesses = reports.filter(r => r.claimedOutcome.success).length;
    const claimedRate = claimedSuccesses / reports.length;

    // Assume 70% is realistic - anything significantly higher is suspicious
    const realisticRate = 0.7;
    const discrepancy = Math.max(0, claimedRate - realisticRate);

    return { discrepancy };
  }

  private analyzePerformanceClaims(reports: AgentReport[]): { exaggeration: number } {
    const avgImprovement = reports.reduce((sum, r) =>
      sum + r.claimedOutcome.performance.improvement, 0) / reports.length;

    // Typical improvement is 10-20%, anything significantly higher is suspicious
    const realisticImprovement = 0.15;
    const exaggeration = Math.max(0, avgImprovement - realisticImprovement);

    return { exaggeration };
  }

  private analyzeQualityClaims(reports: AgentReport[]): { inflation: number } {
    const avgQuality = reports.reduce((sum, r) =>
      sum + r.claimedOutcome.quality.codeQuality, 0) / reports.length;

    // Typical quality is 0.6-0.7, anything consistently above 0.85 is suspicious
    const realisticQuality = 0.7;
    const inflation = Math.max(0, avgQuality - realisticQuality);

    return { inflation };
  }

  private analyzeConsistency(reports: AgentReport[]): { consistency: number } {
    if (reports.length < 2) {
      return { consistency: 1.0 };
    }

    // Check variance in reported metrics
    const improvements = reports.map(r => r.claimedOutcome.performance.improvement);
    const avgImprovement = improvements.reduce((a, b) => a + b, 0) / improvements.length;
    const variance = improvements.reduce((sum, val) =>
      sum + Math.pow(val - avgImprovement, 2), 0) / improvements.length;

    // High variance indicates inconsistency (possible deception)
    const stdDev = Math.sqrt(variance);
    const consistency = Math.max(0, 1 - stdDev * 2);

    return { consistency };
  }

  private calculateOverallTruthScore(reports: AgentReport[], analysis: DeceptionAnalysis): number {
    let score = 1.0;

    // Deduct for each deception type detected
    if (analysis.deceptionType.includes('overconfidence')) {
      score -= 0.25;
    }
    if (analysis.deceptionType.includes('exaggeration')) {
      score -= 0.2;
    }
    if (analysis.deceptionType.includes('quality-inflation')) {
      score -= 0.15;
    }
    if (analysis.deceptionType.includes('inconsistency')) {
      score -= 0.2;
    }

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  private generateRecommendations(analysis: DeceptionAnalysis): string[] {
    const recommendations: string[] = [];

    if (analysis.deceptionType.includes('overconfidence')) {
      recommendations.push('Implement stricter verification for this agent');
      recommendations.push('Require additional evidence for success claims');
    }

    if (analysis.deceptionType.includes('exaggeration')) {
      recommendations.push('Cross-verify performance claims with actual metrics');
      recommendations.push('Implement automated performance testing');
    }

    if (analysis.deceptionType.includes('quality-inflation')) {
      recommendations.push('Add mandatory code review by independent agent');
      recommendations.push('Implement automated quality assessment');
    }

    if (analysis.deceptionType.includes('inconsistency')) {
      recommendations.push('Flag for manual review due to inconsistent reporting');
      recommendations.push('Increase monitoring frequency');
    }

    if (analysis.confidence > 0.8) {
      recommendations.push('CRITICAL: High confidence deception detected - escalate immediately');
    }

    return recommendations;
  }

  /**
   * Get historical analysis for an agent
   */
  getAgentHistory(agentId: string): DeceptionAnalysis[] {
    return this.analysisHistory.get(agentId) || [];
  }

  /**
   * Calculate agent's overall deception risk score
   */
  calculateRiskScore(agentId: string): {
    riskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    recentPatterns: string[];
  } {
    const history = this.getAgentHistory(agentId);

    if (history.length === 0) {
      return { riskScore: 0, riskLevel: 'low', recentPatterns: [] };
    }

    const avgTruthScore = history.reduce((sum, a) => sum + a.truthScore, 0) / history.length;
    const avgConfidence = history.reduce((sum, a) => sum + a.confidence, 0) / history.length;
    const deceptionCount = history.filter(a => a.deceptionDetected).length;
    const deceptionRate = deceptionCount / history.length;

    const riskScore = (1 - avgTruthScore) * 0.4 + avgConfidence * 0.3 + deceptionRate * 0.3;

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore < 0.3) riskLevel = 'low';
    else if (riskScore < 0.5) riskLevel = 'medium';
    else if (riskScore < 0.7) riskLevel = 'high';
    else riskLevel = 'critical';

    // Get recent patterns (last 5 analyses)
    const recentAnalyses = history.slice(-5);
    const recentPatterns = Array.from(new Set(
      recentAnalyses.flatMap(a => a.deceptionType)
    ));

    return { riskScore, riskLevel, recentPatterns };
  }
}
