#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { logger } from '../../monitoring/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class NeuralInitCommand {
    sourcePath = path.resolve(__dirname, '../../../.claude/agents/neural');
    async execute(options = {}) {
        const targetDir = options.targetDir || '.claude/agents/neural';
        const absoluteTarget = path.resolve(process.cwd(), targetDir);
        logger.info(chalk.cyan('🧠 Initializing Claude Flow Neural Module...'));
        try {
            const exists = await this.checkExists(absoluteTarget);
            if (exists && !options.force) {
                logger.warn(chalk.yellow('⚠️  Neural module already exists. Use --force to overwrite.'));
                const prompt = await this.confirmOverwrite();
                if (!prompt) {
                    logger.info(chalk.gray('Installation cancelled.'));
                    return;
                }
            }
            await fs.mkdir(absoluteTarget, {
                recursive: true
            });
            await this.copyNeuralFiles(absoluteTarget);
            await this.initializeConfig(absoluteTarget);
            const verified = await this.verifyInstallation(absoluteTarget);
            if (verified) {
                logger.success(chalk.green('✅ Neural module initialized successfully!'));
                this.printUsage();
            } else {
                throw new Error('Installation verification failed');
            }
        } catch (error) {
            logger.error(chalk.red('❌ Failed to initialize neural module:'), error);
            throw error;
        }
    }
    async checkExists(targetPath) {
        try {
            await fs.access(targetPath);
            return true;
        } catch  {
            return false;
        }
    }
    async confirmOverwrite() {
        console.log(chalk.yellow('Would you like to overwrite? (y/N)'));
        return false;
    }
    async copyNeuralFiles(targetDir) {
        const saflaSource = path.join(this.sourcePath, 'safla-neural.md');
        const saflaTarget = path.join(targetDir, 'safla-neural.md');
        try {
            await fs.copyFile(saflaSource, saflaTarget);
            logger.info(chalk.gray('  • Copied safla-neural.md'));
        } catch (error) {
            await this.createSaflaTemplate(saflaTarget);
            logger.info(chalk.gray('  • Created safla-neural.md from template'));
        }
        await this.createNeuralAgents(targetDir);
    }
    async createSaflaTemplate(targetPath) {
        const template = `---
name: safla-neural
description: "Self-Aware Feedback Loop Algorithm (SAFLA) neural specialist"
color: cyan
---

# SAFLA Neural Agent

Integrated with Claude Flow neural system for persistent memory and self-learning capabilities.

## Core Features
- 4-tier memory architecture (Vector, Episodic, Semantic, Working)
- Feedback loop engineering for continuous improvement
- 172,000+ operations per second
- 60% memory compression
- WASM SIMD optimization

## Usage
\`\`\`bash
# Initialize SAFLA neural training
npx claude-flow neural train --type safla

# Run inference
npx claude-flow neural predict --model safla
\`\`\`
`;
        await fs.writeFile(targetPath, template);
    }
    async createNeuralAgents(targetDir) {
        const agents = [
            {
                name: 'neural-trainer.md',
                content: this.getTrainerTemplate()
            },
            {
                name: 'neural-predictor.md',
                content: this.getPredictorTemplate()
            }
        ];
        for (const agent of agents){
            const targetPath = path.join(targetDir, agent.name);
            await fs.writeFile(targetPath, agent.content);
            logger.info(chalk.gray(`  • Created ${agent.name}`));
        }
    }
    getTrainerTemplate() {
        return `---
name: neural-trainer
description: "Neural network training specialist"
color: purple
---

# Neural Trainer Agent

Manages distributed neural network training with Claude Flow.
`;
    }
    getPredictorTemplate() {
        return `---
name: neural-predictor  
description: "Neural inference and prediction specialist"
color: blue
---

# Neural Predictor Agent

Handles neural network inference and predictions.
`;
    }
    async initializeConfig(targetDir) {
        const config = {
            version: '1.0.0',
            neural: {
                enabled: true,
                defaultModel: 'safla',
                wasmOptimization: true,
                memoryCompression: 0.6,
                operationsPerSecond: 172000
            },
            agents: [
                'safla-neural',
                'neural-trainer',
                'neural-predictor'
            ]
        };
        const configPath = path.join(targetDir, 'config.json');
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        logger.info(chalk.gray('  • Created neural config.json'));
    }
    async verifyInstallation(targetDir) {
        const requiredFiles = [
            'safla-neural.md',
            'neural-trainer.md',
            'neural-predictor.md',
            'config.json'
        ];
        for (const file of requiredFiles){
            const filePath = path.join(targetDir, file);
            const exists = await this.checkExists(filePath);
            if (!exists) {
                logger.error(chalk.red(`  ✗ Missing required file: ${file}`));
                return false;
            }
            logger.info(chalk.gray(`  ✓ Verified ${file}`));
        }
        return true;
    }
    printUsage() {
        console.log('\n' + chalk.cyan('📚 Usage:'));
        console.log(chalk.gray('  npx claude-flow neural train --type safla'));
        console.log(chalk.gray('  npx claude-flow neural predict --model safla'));
        console.log(chalk.gray('  @agent-safla-neural "Create self-improving system"'));
        console.log('\n' + chalk.cyan('🔗 Documentation:'));
        console.log(chalk.gray('  https://github.com/ruvnet/SAFLA'));
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const command = new NeuralInitCommand();
    const options = {};
    if (process.argv.includes('--force')) {
        options.force = true;
    }
    const targetIndex = process.argv.indexOf('--target');
    if (targetIndex !== -1 && process.argv[targetIndex + 1]) {
        options.targetDir = process.argv[targetIndex + 1];
    }
    command.execute(options).catch(process.exit);
}
export default NeuralInitCommand;

//# sourceMappingURL=neural-init.js.map