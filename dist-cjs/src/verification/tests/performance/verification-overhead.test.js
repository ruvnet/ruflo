import { performance } from 'perf_hooks';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import TruthScoreCalculator from '../../../../.claude/helpers/truth-score.js';
describe('Verification System Performance Benchmarks', ()=>{
    let tempDir;
    let calculator;
    let performanceResults = [];
    beforeAll(async ()=>{
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-perf-'));
        calculator = new TruthScoreCalculator();
        calculator.configPath = path.join(tempDir, 'verification.json');
        calculator.memoryPath = path.join(tempDir, 'truth-scores');
        await calculator.init();
    });
    afterAll(async ()=>{
        await fs.rm(tempDir, {
            recursive: true,
            force: true
        });
        await generatePerformanceReport(performanceResults);
    });
    describe('Truth Score Calculation Performance', ()=>{
        test('should calculate truth scores efficiently at scale', async ()=>{
            const thresholds = {
                maxAverageTime: 5,
                minThroughput: 200,
                maxMemoryDelta: 50 * 1024 * 1024,
                maxP99Latency: 20
            };
            const operations = 1000;
            const evidenceVariants = generateEvidenceVariants(10);
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            let peakMemory = initialMemory;
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const evidence = evidenceVariants[i % evidenceVariants.length];
                const operationStart = performance.now();
                const score = calculator.calculateScore(evidence);
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
                const currentMemory = process.memoryUsage().heapUsed;
                peakMemory = Math.max(peakMemory, currentMemory);
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1);
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: peakMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Truth Score Calculation Performance',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
            expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
            expect(metrics.p99).toBeLessThanOrEqual(thresholds.maxP99Latency);
        });
        test('should handle concurrent truth score calculations efficiently', async ()=>{
            const thresholds = {
                maxAverageTime: 8,
                minThroughput: 150,
                maxMemoryDelta: 100 * 1024 * 1024,
                maxP99Latency: 30
            };
            const concurrency = 10;
            const operationsPerWorker = 100;
            const totalOperations = concurrency * operationsPerWorker;
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            const workerPromises = Array.from({
                length: concurrency
            }, async (_, workerIndex)=>{
                const workerDurations = [];
                const evidenceVariants = generateEvidenceVariants(5);
                for(let i = 0; i < operationsPerWorker; i++){
                    const evidence = evidenceVariants[i % evidenceVariants.length];
                    const operationStart = performance.now();
                    const score = calculator.calculateScore(evidence);
                    const operationEnd = performance.now();
                    workerDurations.push(operationEnd - operationStart);
                    expect(score).toBeGreaterThanOrEqual(0);
                    expect(score).toBeLessThanOrEqual(1);
                    if (i % 10 === 0) {
                        await new Promise((resolve)=>setTimeout(resolve, 1));
                    }
                }
                return workerDurations;
            });
            const allDurations = (await Promise.all(workerPromises)).flat();
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(totalOperations, allDurations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Concurrent Truth Score Calculation',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
            expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
        }, 30000);
    });
    describe('Memory Usage Optimization', ()=>{
        test('should maintain stable memory usage during extended operations', async ()=>{
            const thresholds = {
                maxAverageTime: 10,
                minThroughput: 100,
                maxMemoryDelta: 20 * 1024 * 1024,
                maxP99Latency: 50
            };
            const operations = 2000;
            const evidenceVariants = generateEvidenceVariants(20);
            const durations = [];
            const memorySnapshots = [];
            const initialMemory = process.memoryUsage().heapUsed;
            memorySnapshots.push(initialMemory);
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const evidence = evidenceVariants[i % evidenceVariants.length];
                const operationStart = performance.now();
                const score1 = calculator.calculateScore(evidence);
                const comparison = calculator.compareClaimToReality({
                    tests_pass: true,
                    no_lint_errors: true
                }, {
                    tests_pass: score1 > 0.8,
                    lint_errors: score1 > 0.9 ? 0 : 2
                });
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
                if (i % 100 === 0) {
                    const currentMemory = process.memoryUsage().heapUsed;
                    memorySnapshots.push(currentMemory);
                    if (i % 500 === 0 && global.gc) {
                        global.gc();
                    }
                }
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const peakMemory = Math.max(...memorySnapshots);
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: peakMemory,
                final: finalMemory
            });
            const memoryGrowthRate = (finalMemory - initialMemory) / operations;
            expect(memoryGrowthRate).toBeLessThan(1000);
            const result = {
                testName: 'Extended Memory Usage Stability',
                metrics,
                passed: validateBenchmark(metrics, thresholds) && memoryGrowthRate < 1000,
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
        }, 45000);
        test('should efficiently handle large evidence datasets', async ()=>{
            const thresholds = {
                maxAverageTime: 15,
                minThroughput: 70,
                maxMemoryDelta: 150 * 1024 * 1024,
                maxP99Latency: 100
            };
            const operations = 500;
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const largeEvidence = generateLargeEvidence(i);
                const operationStart = performance.now();
                const score = calculator.calculateScore(largeEvidence);
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1);
                if (i % 50 === 0 && global.gc) {
                    global.gc();
                }
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Large Evidence Dataset Handling',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
        }, 30000);
    });
    describe('Truth Score Storage Performance', ()=>{
        test('should store truth scores efficiently at high volume', async ()=>{
            const thresholds = {
                maxAverageTime: 20,
                minThroughput: 50,
                maxMemoryDelta: 100 * 1024 * 1024,
                maxP99Latency: 100
            };
            const operations = 200;
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const agentId = `agent-${i % 10}`;
                const taskId = `task-${i}`;
                const score = Math.random();
                const evidence = generateEvidenceVariants(1)[0];
                const operationStart = performance.now();
                await calculator.storeTruthScore(agentId, taskId, score, evidence);
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'High Volume Truth Score Storage',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
            const files = await fs.readdir(calculator.memoryPath);
            expect(files.length).toBe(operations);
        }, 30000);
        test('should retrieve agent history efficiently', async ()=>{
            const thresholds = {
                maxAverageTime: 50,
                minThroughput: 20,
                maxMemoryDelta: 50 * 1024 * 1024,
                maxP99Latency: 200
            };
            const agents = Array.from({
                length: 10
            }, (_, i)=>`perf-agent-${i}`);
            for (const agentId of agents){
                for(let i = 0; i < 50; i++){
                    await calculator.storeTruthScore(agentId, `history-task-${i}`, Math.random(), {
                        test: `data-${i}`
                    });
                }
            }
            const operations = 100;
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const agentId = agents[i % agents.length];
                const limit = Math.floor(Math.random() * 20) + 5;
                const operationStart = performance.now();
                const history = await calculator.getAgentHistory(agentId, limit);
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
                expect(history.length).toBeLessThanOrEqual(limit);
                expect(history.length).toBeGreaterThan(0);
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Agent History Retrieval Performance',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
        }, 45000);
    });
    describe('Report Generation Performance', ()=>{
        test('should generate reports efficiently with large datasets', async ()=>{
            const thresholds = {
                maxAverageTime: 1000,
                minThroughput: 1,
                maxMemoryDelta: 200 * 1024 * 1024,
                maxP99Latency: 3000
            };
            const agents = Array.from({
                length: 50
            }, (_, i)=>`report-agent-${i}`);
            for (const agentId of agents){
                for(let i = 0; i < 100; i++){
                    await calculator.storeTruthScore(agentId, `report-task-${i}`, Math.random(), {
                        complexity: Math.random(),
                        quality: Math.random()
                    });
                }
            }
            const operations = 10;
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            for(let i = 0; i < operations; i++){
                const format = i % 2 === 0 ? 'json' : 'markdown';
                const operationStart = performance.now();
                const report = await calculator.generateReport(format);
                const operationEnd = performance.now();
                durations.push(operationEnd - operationStart);
                if (format === 'json') {
                    expect(typeof report).toBe('object');
                    expect(report.total_verifications).toBeGreaterThan(0);
                    expect(Object.keys(report.agents).length).toBe(agents.length);
                } else {
                    expect(typeof report).toBe('string');
                    expect(report).toContain('# Truth Score Report');
                    expect(report).toContain('Agent Performance');
                }
                if (global.gc) {
                    global.gc();
                }
            }
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Large Dataset Report Generation',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
        }, 60000);
    });
    describe('System Load Testing', ()=>{
        test('should maintain performance under sustained load', async ()=>{
            const thresholds = {
                maxAverageTime: 25,
                minThroughput: 40,
                maxMemoryDelta: 300 * 1024 * 1024,
                maxP99Latency: 150
            };
            const loadDuration = 15000;
            const batchSize = 10;
            const batchInterval = 100;
            const durations = [];
            const initialMemory = process.memoryUsage().heapUsed;
            const startTime = performance.now();
            let operationCount = 0;
            const evidenceVariants = generateEvidenceVariants(5);
            const loadTestPromise = new Promise((resolve)=>{
                const interval = setInterval(async ()=>{
                    if (performance.now() - startTime >= loadDuration) {
                        clearInterval(interval);
                        resolve();
                        return;
                    }
                    const batchPromises = Array.from({
                        length: batchSize
                    }, async (_, i)=>{
                        const evidence = evidenceVariants[(operationCount + i) % evidenceVariants.length];
                        const operationStart = performance.now();
                        if (i % 3 === 0) {
                            const score = calculator.calculateScore(evidence);
                            expect(score).toBeGreaterThanOrEqual(0);
                        } else if (i % 3 === 1) {
                            const comparison = calculator.compareClaimToReality({
                                tests_pass: true
                            }, {
                                tests_pass: Math.random() > 0.5
                            });
                            expect(comparison.truth_score).toBeGreaterThanOrEqual(0);
                        } else {
                            await calculator.storeTruthScore(`load-agent-${operationCount + i}`, `load-task-${operationCount + i}`, Math.random(), evidence);
                        }
                        const operationEnd = performance.now();
                        durations.push(operationEnd - operationStart);
                    });
                    await Promise.all(batchPromises);
                    operationCount += batchSize;
                }, batchInterval);
            });
            await loadTestPromise;
            const endTime = performance.now();
            const finalMemory = process.memoryUsage().heapUsed;
            const metrics = calculatePerformanceMetrics(operationCount, durations, startTime, endTime, {
                initial: initialMemory,
                peak: finalMemory,
                final: finalMemory
            });
            const result = {
                testName: 'Sustained Load Performance',
                metrics,
                passed: validateBenchmark(metrics, thresholds),
                thresholds
            };
            performanceResults.push(result);
            expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
            expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
            expect(operationCount).toBeGreaterThan(100);
        }, 20000);
    });
    function generateEvidenceVariants(count) {
        return Array.from({
            length: count
        }, (_, i)=>({
                test_results: {
                    passed: Math.floor(Math.random() * 20),
                    total: 20
                },
                lint_results: {
                    errors: Math.floor(Math.random() * 5)
                },
                type_results: {
                    errors: Math.floor(Math.random() * 3)
                },
                build_results: {
                    success: Math.random() > 0.2
                },
                performance_metrics: {
                    response_time: Math.random() * 500 + 50,
                    memory_usage: Math.random() * 100 + 50
                },
                complexity_score: Math.random(),
                variant_id: i
            }));
    }
    function generateLargeEvidence(index) {
        return {
            test_results: {
                passed: Math.floor(Math.random() * 100),
                total: 100,
                detailed_results: Array.from({
                    length: 100
                }, (_, i)=>({
                        test_name: `test_${i}`,
                        status: Math.random() > 0.1 ? 'passed' : 'failed',
                        duration: Math.random() * 1000,
                        memory_usage: Math.random() * 50
                    }))
            },
            lint_results: {
                errors: Math.floor(Math.random() * 10),
                warnings: Math.floor(Math.random() * 20),
                file_reports: Array.from({
                    length: 50
                }, (_, i)=>({
                        file: `file_${i}.js`,
                        issues: Math.floor(Math.random() * 5)
                    }))
            },
            build_results: {
                success: Math.random() > 0.1,
                build_log: 'x'.repeat(10000),
                dependencies: Array.from({
                    length: 200
                }, (_, i)=>`package_${i}`)
            },
            performance_data: {
                metrics: Array.from({
                    length: 1000
                }, ()=>Math.random() * 100),
                timestamps: Array.from({
                    length: 1000
                }, (_, i)=>Date.now() + i * 1000)
            },
            index
        };
    }
    function calculatePerformanceMetrics(operations, durations, startTime, endTime, memory) {
        const totalTime = endTime - startTime;
        const averageTime = durations.reduce((a, b)=>a + b, 0) / durations.length;
        const throughput = operations / totalTime * 1000;
        const sortedDurations = durations.sort((a, b)=>a - b);
        const p50 = sortedDurations[Math.floor(sortedDurations.length * 0.5)];
        const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
        const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)];
        return {
            operations,
            totalTime,
            averageTime,
            throughput,
            memoryUsage: {
                initial: memory.initial,
                peak: memory.peak,
                final: memory.final,
                delta: memory.final - memory.initial
            },
            p50,
            p95,
            p99
        };
    }
    function validateBenchmark(metrics, thresholds) {
        return metrics.averageTime <= thresholds.maxAverageTime && metrics.throughput >= thresholds.minThroughput && metrics.memoryUsage.delta <= thresholds.maxMemoryDelta && metrics.p99 <= thresholds.maxP99Latency;
    }
    async function generatePerformanceReport(results) {
        const reportPath = path.join(tempDir, 'performance-report.json');
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTests: results.length,
                passedTests: results.filter((r)=>r.passed).length,
                failedTests: results.filter((r)=>!r.passed).length
            },
            results: results.map((r)=>({
                    testName: r.testName,
                    passed: r.passed,
                    metrics: {
                        averageTime: `${r.metrics.averageTime.toFixed(2)}ms`,
                        throughput: `${r.metrics.throughput.toFixed(2)} ops/sec`,
                        memoryDelta: `${(r.metrics.memoryUsage.delta / 1024 / 1024).toFixed(2)}MB`,
                        p99Latency: `${r.metrics.p99.toFixed(2)}ms`
                    },
                    thresholds: {
                        maxAverageTime: `${r.thresholds.maxAverageTime}ms`,
                        minThroughput: `${r.thresholds.minThroughput} ops/sec`,
                        maxMemoryDelta: `${(r.thresholds.maxMemoryDelta / 1024 / 1024).toFixed(0)}MB`,
                        maxP99Latency: `${r.thresholds.maxP99Latency}ms`
                    }
                }))
        };
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(`Performance report generated: ${reportPath}`);
    }
});

//# sourceMappingURL=verification-overhead.test.js.map