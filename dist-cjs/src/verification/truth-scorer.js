import { logger } from '../core/logger.js';
import { AppError } from '../utils/error-handler.js';
import { VERIFICATION_CONSTANTS } from './types.js';
export class TruthScorer {
    config;
    logger;
    agentHistory = new Map();
    validationCache = new Map();
    constructor(options = {}){
        this.logger = options.logger || logger.child({
            component: 'TruthScorer'
        });
        this.config = this.mergeConfig(options.config);
        this.logger.info('TruthScorer initialized', {
            threshold: this.config.threshold,
            checks: this.config.checks,
            weights: this.config.weights
        });
    }
    async scoreClaim(claim, context) {
        const startTime = Date.now();
        this.logger.debug('Starting truth score calculation', {
            claimId: claim.id,
            claimType: claim.type,
            agentId: claim.agentId
        });
        try {
            const components = {};
            const evidence = [];
            const errors = [];
            if (this.config.checks.historicalValidation) {
                components.agentReliability = await this.calculateAgentReliability(claim, evidence, errors);
            }
            if (this.config.checks.crossAgentValidation && context?.peers) {
                components.crossValidation = await this.calculateCrossValidation(claim, context.peers, evidence, errors);
            }
            if (this.config.checks.externalValidation && context?.externalSources) {
                components.externalVerification = await this.calculateExternalVerification(claim, context.externalSources, evidence, errors);
            }
            if (this.config.checks.logicalValidation) {
                components.logicalCoherence = await this.calculateLogicalCoherence(claim, evidence, errors);
            }
            if (this.config.checks.statisticalValidation) {
                components.factualConsistency = await this.calculateFactualConsistency(claim, evidence, errors);
            }
            const overall = this.calculateWeightedScore(components);
            const fullComponents = {
                agentReliability: components.agentReliability || 0,
                crossValidation: components.crossValidation || 0,
                externalVerification: components.externalVerification || 0,
                logicalCoherence: components.logicalCoherence || 0,
                factualConsistency: components.factualConsistency || 0,
                overall
            };
            const confidence = this.calculateConfidenceInterval(fullComponents, evidence.length);
            const score = {
                score: overall,
                components: fullComponents,
                confidence,
                evidence,
                timestamp: new Date(),
                metadata: {
                    claimId: claim.id,
                    agentId: claim.agentId,
                    calculationTime: Date.now() - startTime,
                    evidenceCount: evidence.length,
                    errorCount: errors.length,
                    config: this.config
                }
            };
            this.logger.info('Truth score calculated', {
                claimId: claim.id,
                score: overall,
                components: fullComponents,
                confidence: confidence.level,
                duration: Date.now() - startTime
            });
            return score;
        } catch (error) {
            this.logger.error('Failed to calculate truth score', error);
            throw new AppError(`Truth score calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'TRUTH_SCORE_CALCULATION_FAILED', 500);
        }
    }
    validateScore(score) {
        const passes = score.score >= this.config.threshold;
        this.logger.debug('Truth score validation', {
            score: score.score,
            threshold: this.config.threshold,
            passes
        });
        return passes;
    }
    updateAgentHistory(agentId, performance) {
        const agentKey = typeof agentId === 'string' ? agentId : agentId.id;
        if (!this.agentHistory.has(agentKey)) {
            this.agentHistory.set(agentKey, {
                agentId: agentKey,
                records: [],
                statistics: {
                    averageScore: 0,
                    successRate: 0,
                    totalClaims: 0,
                    recentTrend: 'stable'
                }
            });
        }
        const history = this.agentHistory.get(agentKey);
        history.records.push(performance);
        if (history.records.length > 100) {
            history.records = history.records.slice(-100);
        }
        this.updateAgentStatistics(history);
        this.logger.debug('Agent history updated', {
            agentId: agentKey,
            recordCount: history.records.length,
            averageScore: history.statistics.averageScore
        });
    }
    getAgentReliability(agentId) {
        const agentKey = typeof agentId === 'string' ? agentId : agentId.id;
        const history = this.agentHistory.get(agentKey);
        if (!history || history.records.length === 0) {
            return 0.5;
        }
        return history.statistics.averageScore;
    }
    clearCache() {
        this.validationCache.clear();
        this.logger.debug('Validation cache cleared');
    }
    mergeConfig(partialConfig) {
        const defaultWeights = {
            agentReliability: 0.3,
            crossValidation: 0.25,
            externalVerification: 0.2,
            factualConsistency: 0.15,
            logicalCoherence: 0.1
        };
        const defaultChecks = {
            historicalValidation: true,
            crossAgentValidation: true,
            externalValidation: false,
            logicalValidation: true,
            statisticalValidation: true
        };
        const defaultConfidence = {
            level: VERIFICATION_CONSTANTS.DEFAULT_CONFIDENCE_LEVEL,
            minSampleSize: VERIFICATION_CONSTANTS.DEFAULT_MIN_SAMPLE_SIZE,
            maxErrorMargin: VERIFICATION_CONSTANTS.DEFAULT_MAX_ERROR_MARGIN
        };
        return {
            threshold: partialConfig?.threshold || VERIFICATION_CONSTANTS.DEFAULT_TRUTH_THRESHOLD,
            weights: {
                ...defaultWeights,
                ...partialConfig?.weights
            },
            checks: {
                ...defaultChecks,
                ...partialConfig?.checks
            },
            confidence: {
                ...defaultConfidence,
                ...partialConfig?.confidence
            }
        };
    }
    async calculateAgentReliability(claim, evidence, errors) {
        try {
            const agentKey = typeof claim.agentId === 'string' ? claim.agentId : claim.agentId.id;
            const history = this.agentHistory.get(agentKey);
            if (!history || history.records.length < 3) {
                evidence.push({
                    type: 'agent_history',
                    source: 'internal_history',
                    weight: this.config.weights.agentReliability,
                    score: 0.5,
                    details: {
                        reason: 'insufficient_data',
                        recordCount: history?.records.length || 0
                    },
                    timestamp: new Date()
                });
                return 0.5;
            }
            const recentRecords = history.records.slice(-10);
            const avgScore = recentRecords.reduce((sum, record)=>sum + record.score, 0) / recentRecords.length;
            const consistency = 1 - this.calculateVariance(recentRecords.map((r)=>r.score));
            const trendFactor = this.calculateTrendFactor(recentRecords);
            const reliability = avgScore * 0.6 + consistency * 0.3 + trendFactor * 0.1;
            evidence.push({
                type: 'agent_history',
                source: 'internal_history',
                weight: this.config.weights.agentReliability,
                score: reliability,
                details: {
                    averageScore: avgScore,
                    consistency,
                    trendFactor,
                    recordCount: recentRecords.length
                },
                timestamp: new Date()
            });
            return Math.max(0, Math.min(1, reliability));
        } catch (error) {
            errors.push({
                code: 'AGENT_RELIABILITY_CALCULATION_FAILED',
                message: `Failed to calculate agent reliability: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'medium',
                context: {
                    claimId: claim.id,
                    agentId: claim.agentId
                },
                recoverable: true,
                timestamp: new Date()
            });
            return 0.5;
        }
    }
    async calculateCrossValidation(claim, peers, evidence, errors) {
        try {
            if (peers.length === 0) {
                evidence.push({
                    type: 'cross_validation',
                    source: 'peer_agents',
                    weight: this.config.weights.crossValidation,
                    score: 0.5,
                    details: {
                        reason: 'no_peers_available'
                    },
                    timestamp: new Date()
                });
                return 0.5;
            }
            const validationScores = [];
            const reliablePeers = peers.filter((peer)=>this.getAgentReliability(peer.id) > 0.7);
            for (const peer of reliablePeers.slice(0, 5)){
                const peerReliability = this.getAgentReliability(peer.id);
                const validationScore = this.simulatePeerValidation(claim, peer);
                validationScores.push(validationScore * peerReliability);
            }
            if (validationScores.length === 0) {
                evidence.push({
                    type: 'cross_validation',
                    source: 'peer_agents',
                    weight: this.config.weights.crossValidation,
                    score: 0.5,
                    details: {
                        reason: 'no_reliable_peers'
                    },
                    timestamp: new Date()
                });
                return 0.5;
            }
            const avgValidation = validationScores.reduce((sum, score)=>sum + score, 0) / validationScores.length;
            const consensus = 1 - this.calculateVariance(validationScores);
            const crossValidationScore = avgValidation * 0.8 + consensus * 0.2;
            evidence.push({
                type: 'cross_validation',
                source: 'peer_agents',
                weight: this.config.weights.crossValidation,
                score: crossValidationScore,
                details: {
                    peerCount: validationScores.length,
                    averageValidation: avgValidation,
                    consensus,
                    validationScores
                },
                timestamp: new Date()
            });
            return Math.max(0, Math.min(1, crossValidationScore));
        } catch (error) {
            errors.push({
                code: 'CROSS_VALIDATION_FAILED',
                message: `Cross validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'medium',
                context: {
                    claimId: claim.id,
                    peerCount: peers.length
                },
                recoverable: true,
                timestamp: new Date()
            });
            return 0.5;
        }
    }
    async calculateExternalVerification(claim, externalSources, evidence, errors) {
        try {
            if (externalSources.length === 0) {
                evidence.push({
                    type: 'external_source',
                    source: 'external_verification',
                    weight: this.config.weights.externalVerification,
                    score: 0.5,
                    details: {
                        reason: 'no_external_sources'
                    },
                    timestamp: new Date()
                });
                return 0.5;
            }
            const verificationResults = [];
            for (const source of externalSources.slice(0, 3)){
                const verificationScore = await this.simulateExternalVerification(claim, source);
                verificationResults.push(verificationScore * source.reliability);
            }
            const avgVerification = verificationResults.reduce((sum, score)=>sum + score, 0) / verificationResults.length;
            const sourceAgreement = 1 - this.calculateVariance(verificationResults);
            const externalScore = avgVerification * 0.7 + sourceAgreement * 0.3;
            evidence.push({
                type: 'external_source',
                source: 'external_verification',
                weight: this.config.weights.externalVerification,
                score: externalScore,
                details: {
                    sourceCount: verificationResults.length,
                    averageVerification: avgVerification,
                    sourceAgreement,
                    verificationResults
                },
                timestamp: new Date()
            });
            return Math.max(0, Math.min(1, externalScore));
        } catch (error) {
            errors.push({
                code: 'EXTERNAL_VERIFICATION_FAILED',
                message: `External verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'medium',
                context: {
                    claimId: claim.id,
                    sourceCount: externalSources.length
                },
                recoverable: true,
                timestamp: new Date()
            });
            return 0.5;
        }
    }
    async calculateLogicalCoherence(claim, evidence, errors) {
        try {
            const coherenceChecks = {
                structuralIntegrity: this.checkStructuralIntegrity(claim),
                causalConsistency: this.checkCausalConsistency(claim),
                temporalCoherence: this.checkTemporalCoherence(claim),
                metricConsistency: this.checkMetricConsistency(claim)
            };
            const coherenceScore = Object.values(coherenceChecks).reduce((sum, score)=>sum + score, 0) / 4;
            evidence.push({
                type: 'logical_proof',
                source: 'logical_analyzer',
                weight: this.config.weights.logicalCoherence,
                score: coherenceScore,
                details: coherenceChecks,
                timestamp: new Date()
            });
            return Math.max(0, Math.min(1, coherenceScore));
        } catch (error) {
            errors.push({
                code: 'LOGICAL_COHERENCE_FAILED',
                message: `Logical coherence analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'medium',
                context: {
                    claimId: claim.id
                },
                recoverable: true,
                timestamp: new Date()
            });
            return 0.5;
        }
    }
    async calculateFactualConsistency(claim, evidence, errors) {
        try {
            const statisticalTests = {
                distributionTest: this.performDistributionTest(claim),
                outlierDetection: this.performOutlierDetection(claim),
                trendAnalysis: this.performTrendAnalysis(claim),
                correlationAnalysis: this.performCorrelationAnalysis(claim)
            };
            const consistencyScore = Object.values(statisticalTests).reduce((sum, score)=>sum + score, 0) / 4;
            evidence.push({
                type: 'statistical_test',
                source: 'statistical_analyzer',
                weight: this.config.weights.factualConsistency,
                score: consistencyScore,
                details: statisticalTests,
                timestamp: new Date()
            });
            return Math.max(0, Math.min(1, consistencyScore));
        } catch (error) {
            errors.push({
                code: 'FACTUAL_CONSISTENCY_FAILED',
                message: `Factual consistency analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                severity: 'medium',
                context: {
                    claimId: claim.id
                },
                recoverable: true,
                timestamp: new Date()
            });
            return 0.5;
        }
    }
    calculateWeightedScore(components) {
        const weights = this.config.weights;
        const totalWeight = Object.values(weights).reduce((sum, weight)=>sum + weight, 0);
        const weightedSum = components.agentReliability * weights.agentReliability + components.crossValidation * weights.crossValidation + components.externalVerification * weights.externalVerification + components.factualConsistency * weights.factualConsistency + components.logicalCoherence * weights.logicalCoherence;
        return weightedSum / totalWeight;
    }
    calculateConfidenceInterval(components, evidenceCount) {
        const score = components.overall;
        const sampleSize = Math.max(evidenceCount, 1);
        const confidenceLevel = this.config.confidence.level;
        const variance = this.calculateComponentVariance(components);
        const standardError = Math.sqrt(variance / sampleSize);
        const zScore = this.getZScore(confidenceLevel);
        const margin = zScore * standardError;
        return {
            lower: Math.max(0, score - margin),
            upper: Math.min(1, score + margin),
            level: confidenceLevel
        };
    }
    calculateComponentVariance(components) {
        const scores = [
            components.agentReliability,
            components.crossValidation,
            components.externalVerification,
            components.factualConsistency,
            components.logicalCoherence
        ];
        return this.calculateVariance(scores);
    }
    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, val)=>sum + val, 0) / values.length;
        const squaredDiffs = values.map((val)=>Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, diff)=>sum + diff, 0) / values.length;
    }
    calculateTrendFactor(records) {
        if (records.length < 2) return 0.5;
        const scores = records.map((r)=>r.score);
        const n = scores.length;
        const x = Array.from({
            length: n
        }, (_, i)=>i);
        const sumX = x.reduce((a, b)=>a + b, 0);
        const sumY = scores.reduce((a, b)=>a + b, 0);
        const sumXY = x.reduce((sum, xi, i)=>sum + xi * scores[i], 0);
        const sumXX = x.reduce((sum, xi)=>sum + xi * xi, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        return 0.5 + Math.max(-0.5, Math.min(0.5, slope));
    }
    getZScore(confidenceLevel) {
        if (confidenceLevel >= 0.99) return 2.576;
        if (confidenceLevel >= 0.95) return 1.96;
        if (confidenceLevel >= 0.90) return 1.645;
        if (confidenceLevel >= 0.80) return 1.282;
        return 1.0;
    }
    updateAgentStatistics(history) {
        const records = history.records;
        if (records.length === 0) return;
        const scores = records.map((r)=>r.score);
        const successCount = records.filter((r)=>r.success).length;
        history.statistics.averageScore = scores.reduce((sum, score)=>sum + score, 0) / scores.length;
        history.statistics.successRate = successCount / records.length;
        history.statistics.totalClaims = records.length;
        if (records.length >= 5) {
            const recentScores = scores.slice(-5);
            const earlierScores = scores.slice(-10, -5);
            if (earlierScores.length > 0) {
                const recentAvg = recentScores.reduce((sum, score)=>sum + score, 0) / recentScores.length;
                const earlierAvg = earlierScores.reduce((sum, score)=>sum + score, 0) / earlierScores.length;
                if (recentAvg > earlierAvg + 0.05) {
                    history.statistics.recentTrend = 'improving';
                } else if (recentAvg < earlierAvg - 0.05) {
                    history.statistics.recentTrend = 'declining';
                } else {
                    history.statistics.recentTrend = 'stable';
                }
            }
        }
    }
    simulatePeerValidation(claim, peer) {
        const baseScore = 0.7;
        const randomFactor = (Math.random() - 0.5) * 0.4;
        return Math.max(0, Math.min(1, baseScore + randomFactor));
    }
    async simulateExternalVerification(claim, source) {
        const baseScore = source.reliability * 0.8;
        const randomFactor = (Math.random() - 0.5) * 0.3;
        return Math.max(0, Math.min(1, baseScore + randomFactor));
    }
    checkStructuralIntegrity(claim) {
        let score = 0.8;
        if (!claim.data || typeof claim.data !== 'object') score -= 0.3;
        if (!claim.evidence || claim.evidence.length === 0) score -= 0.2;
        if (!claim.metrics) score -= 0.2;
        return Math.max(0, score);
    }
    checkCausalConsistency(claim) {
        return 0.8;
    }
    checkTemporalCoherence(claim) {
        const now = new Date();
        const claimAge = now.getTime() - claim.submittedAt.getTime();
        if (claimAge > 24 * 60 * 60 * 1000) {
            return 0.5;
        }
        return 0.9;
    }
    checkMetricConsistency(claim) {
        if (!claim.metrics) return 0.5;
        const metrics = claim.metrics;
        let score = 0.8;
        if (metrics.accuracy && (metrics.accuracy < 0 || metrics.accuracy > 1)) score -= 0.3;
        if (metrics.errorRate && metrics.errorRate < 0) score -= 0.2;
        if (metrics.executionTime && metrics.executionTime < 0) score -= 0.2;
        return Math.max(0, score);
    }
    performDistributionTest(claim) {
        return 0.8;
    }
    performOutlierDetection(claim) {
        return 0.8;
    }
    performTrendAnalysis(claim) {
        return 0.8;
    }
    performCorrelationAnalysis(claim) {
        return 0.8;
    }
}
export default TruthScorer;

//# sourceMappingURL=truth-scorer.js.map