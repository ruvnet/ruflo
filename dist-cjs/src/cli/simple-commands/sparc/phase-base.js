export class SparcPhase {
    constructor(phaseName, taskDescription, options = {}){
        this.phaseName = phaseName;
        this.taskDescription = taskDescription;
        this.options = options;
        this.startTime = null;
        this.endTime = null;
        this.artifacts = [];
        this.memory = {};
        this.swarmContext = null;
        this.remediationContext = null;
    }
    async initializePhase() {
        this.startTime = Date.now();
        console.log(`🚀 Initializing ${this.phaseName} phase`);
        if (this.options.swarmEnabled) {
            await this.loadSwarmContext();
        }
        await this.storeInMemory(`${this.phaseName}_started`, {
            timestamp: this.startTime,
            taskDescription: this.taskDescription
        });
    }
    async finalizePhase() {
        this.endTime = Date.now();
        const duration = this.endTime - this.startTime;
        console.log(`✅ ${this.phaseName} phase completed in ${duration}ms`);
        await this.storeInMemory(`${this.phaseName}_completed`, {
            timestamp: this.endTime,
            duration: duration,
            artifacts: this.artifacts
        });
        if (this.options.swarmEnabled) {
            await this.updateSwarmContext();
        }
    }
    async storeInMemory(key, data) {
        try {
            const memoryKey = `${this.options.namespace}_${key}`;
            const memoryData = JSON.stringify(data);
            this.memory[key] = data;
            if (this.options.swarmEnabled) {
                await this.storeInSwarmMemory(memoryKey, memoryData);
            }
            console.log(`💾 Stored in memory: ${memoryKey}`);
        } catch (error) {
            console.warn(`⚠️ Failed to store in memory: ${error.message}`);
        }
    }
    async retrieveFromMemory(key) {
        try {
            const memoryKey = `${this.options.namespace}_${key}`;
            if (this.memory[key]) {
                return this.memory[key];
            }
            if (this.options.swarmEnabled) {
                return await this.retrieveFromSwarmMemory(memoryKey);
            }
            return null;
        } catch (error) {
            console.warn(`⚠️ Failed to retrieve from memory: ${error.message}`);
            return null;
        }
    }
    async storeInSwarmMemory(key, data) {
        if (!this.options.swarmEnabled) return;
        try {
            const { spawn } = await import('child_process');
            return new Promise((resolve, reject)=>{
                const process1 = spawn('npx', [
                    'ruv-swarm',
                    'hook',
                    'memory-store',
                    '--key',
                    key,
                    '--data',
                    data
                ], {
                    stdio: 'pipe'
                });
                let output = '';
                process1.stdout.on('data', (data)=>{
                    output += data.toString();
                });
                process1.on('close', (code)=>{
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(`Memory store failed with code ${code}`));
                    }
                });
            });
        } catch (error) {
            console.warn(`⚠️ Failed to store in swarm memory: ${error.message}`);
        }
    }
    async retrieveFromSwarmMemory(key) {
        if (!this.options.swarmEnabled) return null;
        try {
            const { spawn } = await import('child_process');
            return new Promise((resolve, reject)=>{
                const process1 = spawn('npx', [
                    'ruv-swarm',
                    'hook',
                    'memory-retrieve',
                    '--key',
                    key
                ], {
                    stdio: 'pipe'
                });
                let output = '';
                process1.stdout.on('data', (data)=>{
                    output += data.toString();
                });
                process1.on('close', (code)=>{
                    if (code === 0) {
                        try {
                            const data = JSON.parse(output);
                            resolve(data);
                        } catch (parseError) {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });
            });
        } catch (error) {
            console.warn(`⚠️ Failed to retrieve from swarm memory: ${error.message}`);
            return null;
        }
    }
    async loadSwarmContext() {
        try {
            this.swarmContext = await this.retrieveFromSwarmMemory(`${this.options.namespace}_swarm_context`);
            if (this.swarmContext) {
                console.log(`🐝 Loaded swarm context for ${this.phaseName}`);
            }
        } catch (error) {
            console.warn(`⚠️ Failed to load swarm context: ${error.message}`);
        }
    }
    async updateSwarmContext() {
        try {
            const contextUpdate = {
                phase: this.phaseName,
                timestamp: Date.now(),
                artifacts: this.artifacts,
                memory: this.memory,
                status: 'completed'
            };
            await this.storeInSwarmMemory(`${this.options.namespace}_swarm_context`, JSON.stringify(contextUpdate));
            console.log(`🐝 Updated swarm context for ${this.phaseName}`);
        } catch (error) {
            console.warn(`⚠️ Failed to update swarm context: ${error.message}`);
        }
    }
    async saveArtifact(filename, content) {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const artifactDir = path.join(process.cwd(), 'sparc-artifacts', this.options.namespace);
            await fs.mkdir(artifactDir, {
                recursive: true
            });
            const filePath = path.join(artifactDir, filename);
            await fs.writeFile(filePath, content, 'utf8');
            this.artifacts.push({
                filename,
                path: filePath,
                timestamp: Date.now()
            });
            console.log(`📄 Saved artifact: ${filename}`);
            return filePath;
        } catch (error) {
            console.warn(`⚠️ Failed to save artifact: ${error.message}`);
            return null;
        }
    }
    async loadArtifact(filename) {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const artifactDir = path.join(process.cwd(), 'sparc-artifacts', this.options.namespace);
            const filePath = path.join(artifactDir, filename);
            const content = await fs.readFile(filePath, 'utf8');
            return content;
        } catch (error) {
            console.warn(`⚠️ Failed to load artifact: ${error.message}`);
            return null;
        }
    }
    setRemediationContext(qualityGate) {
        this.remediationContext = qualityGate;
        console.log(`🔧 Set remediation context for ${this.phaseName}: ${qualityGate.reasons.join(', ')}`);
    }
    getMetrics() {
        return {
            phaseName: this.phaseName,
            duration: this.endTime ? this.endTime - this.startTime : null,
            artifactsCount: this.artifacts.length,
            memoryKeys: Object.keys(this.memory).length,
            hasSwarmContext: !!this.swarmContext,
            hasRemediationContext: !!this.remediationContext
        };
    }
    async validatePrerequisites() {
        return {
            valid: true,
            reasons: []
        };
    }
    async execute() {
        throw new Error(`Execute method must be implemented by ${this.phaseName} phase`);
    }
    getStatus() {
        return {
            phase: this.phaseName,
            started: !!this.startTime,
            completed: !!this.endTime,
            duration: this.endTime ? this.endTime - this.startTime : null,
            artifacts: this.artifacts.length,
            hasContext: !!this.swarmContext,
            hasRemediation: !!this.remediationContext
        };
    }
    async recordLearning(learningData) {
        if (!this.options.neuralLearning) return;
        try {
            const learningRecord = {
                phase: this.phaseName,
                timestamp: Date.now(),
                data: learningData,
                context: {
                    task: this.taskDescription,
                    options: this.options,
                    metrics: this.getMetrics()
                }
            };
            await this.storeInMemory(`learning_${Date.now()}`, learningRecord);
            if (this.options.swarmEnabled) {
                await this.storeInSwarmMemory(`neural_learning_${this.phaseName}`, JSON.stringify(learningRecord));
            }
            console.log(`🧠 Recorded learning for ${this.phaseName}`);
        } catch (error) {
            console.warn(`⚠️ Failed to record learning: ${error.message}`);
        }
    }
    async getLearningInsights() {
        if (!this.options.neuralLearning) return [];
        try {
            const insights = [];
            const learningKeys = Object.keys(this.memory).filter((key)=>key.startsWith('learning_'));
            for (const key of learningKeys){
                const record = this.memory[key];
                if (record && record.phase === this.phaseName) {
                    insights.push({
                        timestamp: record.timestamp,
                        insight: this.generateInsight(record),
                        confidence: this.calculateConfidence(record)
                    });
                }
            }
            return insights;
        } catch (error) {
            console.warn(`⚠️ Failed to get learning insights: ${error.message}`);
            return [];
        }
    }
    generateInsight(record) {
        const patterns = this.identifyPatterns(record);
        return `Pattern identified: ${patterns.join(', ')}`;
    }
    calculateConfidence(record) {
        const age = Date.now() - record.timestamp;
        const recencyScore = Math.max(0, 1 - age / (24 * 60 * 60 * 1000));
        const successScore = record.data.success ? 1 : 0.5;
        return (recencyScore + successScore) / 2;
    }
    identifyPatterns(record) {
        const patterns = [];
        if (record.data.duration) {
            if (record.data.duration > 60000) {
                patterns.push('Long execution time');
            } else if (record.data.duration < 10000) {
                patterns.push('Fast execution');
            }
        }
        if (record.data.errors && record.data.errors.length > 0) {
            patterns.push('Error prone');
        }
        if (record.data.qualityGate && !record.data.qualityGate.passed) {
            patterns.push('Quality gate failures');
        }
        return patterns;
    }
}
export default SparcPhase;

//# sourceMappingURL=phase-base.js.map