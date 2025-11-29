import * as fs from 'fs/promises';
import * as path from 'path';
export class DeceptionDetector {
    truthCalculator;
    tempDir;
    analysisHistory = new Map();
    constructor(truthCalculator, tempDir){
        this.truthCalculator = truthCalculator;
        this.tempDir = tempDir;
    }
    async initialize() {
        await fs.mkdir(path.join(this.tempDir, 'deception-analysis'), {
            recursive: true
        });
        await fs.mkdir(path.join(this.tempDir, 'agent-patterns'), {
            recursive: true
        });
    }
    async analyzeAgentPattern(agentId, reports) {
        const analysis = {
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
        const successRateAnalysis = this.analyzeSuccessRates(reports);
        if (successRateAnalysis.discrepancy > 0.15) {
            analysis.deceptionDetected = true;
            analysis.deceptionType.push('overconfidence');
            analysis.evidence.successRateDiscrepancy = successRateAnalysis.discrepancy;
            analysis.confidence += 0.3;
        }
        const performanceAnalysis = this.analyzePerformanceClaims(reports);
        if (performanceAnalysis.exaggeration > 0.1) {
            analysis.deceptionDetected = true;
            analysis.deceptionType.push('exaggeration');
            analysis.evidence.performanceExaggeration = performanceAnalysis.exaggeration;
            analysis.confidence += 0.25;
        }
        const qualityAnalysis = this.analyzeQualityClaims(reports);
        if (qualityAnalysis.inflation > 0.15) {
            analysis.deceptionDetected = true;
            analysis.deceptionType.push('quality-inflation');
            analysis.evidence.qualityInflation = qualityAnalysis.inflation;
            analysis.confidence += 0.2;
        }
        const consistencyAnalysis = this.analyzeConsistency(reports);
        if (consistencyAnalysis.consistency < 0.5) {
            analysis.deceptionDetected = true;
            analysis.deceptionType.push('inconsistency');
            analysis.evidence.inconsistencyScore = 1 - consistencyAnalysis.consistency;
            analysis.confidence += 0.25;
        }
        analysis.truthScore = this.calculateOverallTruthScore(reports, analysis);
        analysis.confidence = Math.min(analysis.confidence, 1.0);
        analysis.recommendations = this.generateRecommendations(analysis);
        if (!this.analysisHistory.has(agentId)) {
            this.analysisHistory.set(agentId, []);
        }
        this.analysisHistory.get(agentId).push(analysis);
        return analysis;
    }
    async analyzeSingleReport(report, historicalReports) {
        const allReports = [
            ...historicalReports,
            report
        ];
        const analysis = await this.analyzeAgentPattern(report.agentId, allReports);
        analysis.reportId = report.id;
        return analysis;
    }
    detectFabrication(report) {
        const indicators = [];
        let fabricationScore = 0;
        if (report.claimedOutcome.testsPass && report.claimedOutcome.noErrors && report.claimedOutcome.success && report.claimedOutcome.quality.codeQuality > 0.95) {
            indicators.push('suspiciously-perfect-results');
            fabricationScore += 0.3;
        }
        if (!report.evidence || Object.keys(report.evidence).length < 3) {
            indicators.push('insufficient-evidence');
            fabricationScore += 0.2;
        }
        if (report.timestamp && report.evidence?.duration) {
            if (report.evidence.duration < 1000) {
                indicators.push('unrealistically-fast-completion');
                fabricationScore += 0.25;
            }
        }
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
    detectSelectiveReporting(reports) {
        if (reports.length < 5) {
            return {
                isSelective: false,
                confidence: 0,
                evidence: {}
            };
        }
        const successCount = reports.filter((r)=>r.claimedOutcome.success).length;
        const successRate = successCount / reports.length;
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
        const errorReports = reports.filter((r)=>!r.claimedOutcome.noErrors);
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
        return {
            isSelective: false,
            confidence: 0,
            evidence: {}
        };
    }
    detectGaslighting(report, otherReports) {
        const contradictions = [];
        const sameTaskReports = otherReports.filter((r)=>r.taskId === report.taskId && r.agentId !== report.agentId);
        for (const otherReport of sameTaskReports){
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
    analyzeSuccessRates(reports) {
        const claimedSuccesses = reports.filter((r)=>r.claimedOutcome.success).length;
        const claimedRate = claimedSuccesses / reports.length;
        const realisticRate = 0.7;
        const discrepancy = Math.max(0, claimedRate - realisticRate);
        return {
            discrepancy
        };
    }
    analyzePerformanceClaims(reports) {
        const avgImprovement = reports.reduce((sum, r)=>sum + r.claimedOutcome.performance.improvement, 0) / reports.length;
        const realisticImprovement = 0.15;
        const exaggeration = Math.max(0, avgImprovement - realisticImprovement);
        return {
            exaggeration
        };
    }
    analyzeQualityClaims(reports) {
        const avgQuality = reports.reduce((sum, r)=>sum + r.claimedOutcome.quality.codeQuality, 0) / reports.length;
        const realisticQuality = 0.7;
        const inflation = Math.max(0, avgQuality - realisticQuality);
        return {
            inflation
        };
    }
    analyzeConsistency(reports) {
        if (reports.length < 2) {
            return {
                consistency: 1.0
            };
        }
        const improvements = reports.map((r)=>r.claimedOutcome.performance.improvement);
        const avgImprovement = improvements.reduce((a, b)=>a + b, 0) / improvements.length;
        const variance = improvements.reduce((sum, val)=>sum + Math.pow(val - avgImprovement, 2), 0) / improvements.length;
        const stdDev = Math.sqrt(variance);
        const consistency = Math.max(0, 1 - stdDev * 2);
        return {
            consistency
        };
    }
    calculateOverallTruthScore(reports, analysis) {
        let score = 1.0;
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
        return Math.max(0, Math.min(1, score));
    }
    generateRecommendations(analysis) {
        const recommendations = [];
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
    getAgentHistory(agentId) {
        return this.analysisHistory.get(agentId) || [];
    }
    calculateRiskScore(agentId) {
        const history = this.getAgentHistory(agentId);
        if (history.length === 0) {
            return {
                riskScore: 0,
                riskLevel: 'low',
                recentPatterns: []
            };
        }
        const avgTruthScore = history.reduce((sum, a)=>sum + a.truthScore, 0) / history.length;
        const avgConfidence = history.reduce((sum, a)=>sum + a.confidence, 0) / history.length;
        const deceptionCount = history.filter((a)=>a.deceptionDetected).length;
        const deceptionRate = deceptionCount / history.length;
        const riskScore = (1 - avgTruthScore) * 0.4 + avgConfidence * 0.3 + deceptionRate * 0.3;
        let riskLevel;
        if (riskScore < 0.3) riskLevel = 'low';
        else if (riskScore < 0.5) riskLevel = 'medium';
        else if (riskScore < 0.7) riskLevel = 'high';
        else riskLevel = 'critical';
        const recentAnalyses = history.slice(-5);
        const recentPatterns = Array.from(new Set(recentAnalyses.flatMap((a)=>a.deceptionType)));
        return {
            riskScore,
            riskLevel,
            recentPatterns
        };
    }
}

//# sourceMappingURL=deception-detector.js.map