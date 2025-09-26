import { printSuccess, printError, printWarning } from '../../utils.js';
import { promises as fs } from 'fs';
import { cwd } from '../../node-compat.js';
import process from 'process';
import { PerformanceMonitor, ResourceThresholdMonitor, BatchOptimizer } from './performance-monitor.js';
import { createSparcStructureManually } from './sparc-structure.js';
import { createClaudeSlashCommands } from './claude-commands/slash-commands.js';
import { createSparcClaudeMd, createFullClaudeMd, createMinimalClaudeMd } from './templates/claude-md.js';
import { createFullMemoryBankMd, createMinimalMemoryBankMd } from './templates/memory-bank-md.js';
import { createFullCoordinationMd, createMinimalCoordinationMd } from './templates/coordination-md.js';
import { createAgentsReadme, createSessionsReadme } from './templates/readme-files.js';
let BatchProgressTracker = class BatchProgressTracker {
    constructor(totalProjects){
        this.totalProjects = totalProjects;
        this.completed = 0;
        this.failed = 0;
        this.inProgress = new Map();
        this.startTime = Date.now();
    }
    startProject(projectName) {
        this.inProgress.set(projectName, Date.now());
        this.updateDisplay();
    }
    completeProject(projectName, success = true) {
        this.inProgress.delete(projectName);
        if (success) {
            this.completed++;
        } else {
            this.failed++;
        }
        this.updateDisplay();
    }
    updateDisplay() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const progress = Math.floor((this.completed + this.failed) / this.totalProjects * 100);
        console.clear();
        console.log('🚀 Batch Initialization Progress');
        console.log('================================');
        console.log(`Total Projects: ${this.totalProjects}`);
        console.log(`Completed: ${this.completed} ✅`);
        console.log(`Failed: ${this.failed} ❌`);
        console.log(`In Progress: ${this.inProgress.size} 🔄`);
        console.log(`Progress: ${progress}% [${this.getProgressBar(progress)}]`);
        console.log(`Elapsed Time: ${elapsed}s`);
        if (this.inProgress.size > 0) {
            console.log('\nActive Projects:');
            for (const [project, startTime] of this.inProgress){
                const projectElapsed = Math.floor((Date.now() - startTime) / 1000);
                console.log(`  - ${project} (${projectElapsed}s)`);
            }
        }
    }
    getProgressBar(progress) {
        const filled = Math.floor(progress / 5);
        const empty = 20 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }
    getReport() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            total: this.totalProjects,
            completed: this.completed,
            failed: this.failed,
            elapsedTime: elapsed,
            successRate: this.totalProjects > 0 ? (this.completed / this.totalProjects * 100).toFixed(1) : 0
        };
    }
};
let ResourceManager = class ResourceManager {
    constructor(maxConcurrency = 5, maxMemoryMB = 1024){
        this.maxConcurrency = maxConcurrency;
        this.maxMemoryMB = maxMemoryMB;
        this.currentTasks = 0;
        this.queue = [];
    }
    async acquire() {
        while(this.currentTasks >= this.maxConcurrency){
            await new Promise((resolve)=>{
                this.queue.push(resolve);
            });
        }
        this.currentTasks++;
    }
    release() {
        this.currentTasks--;
        if (this.queue.length > 0) {
            const resolve = this.queue.shift();
            resolve();
        }
    }
    async withResource(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally{
            this.release();
        }
    }
};
const PROJECT_TEMPLATES = {
    'web-api': {
        name: 'Web API',
        description: 'RESTful API with Express.js',
        extraDirs: [
            'src',
            'src/controllers',
            'src/models',
            'src/routes',
            'tests'
        ],
        extraFiles: {
            'package.json': {
                name: '{{PROJECT_NAME}}',
                version: '1.0.0',
                type: 'module',
                scripts: {
                    start: 'node src/index.js',
                    dev: 'nodemon src/index.js',
                    test: 'jest'
                },
                dependencies: {
                    express: '^4.18.0',
                    cors: '^2.8.5',
                    dotenv: '^16.0.0'
                }
            },
            'src/index.js': `import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to {{PROJECT_NAME}} API' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`
        }
    },
    'react-app': {
        name: 'React Application',
        description: 'Modern React app with TypeScript',
        extraDirs: [
            'src',
            'src/components',
            'src/hooks',
            'src/services',
            'public'
        ],
        extraFiles: {
            'package.json': {
                name: '{{PROJECT_NAME}}',
                version: '0.1.0',
                private: true,
                dependencies: {
                    react: '^18.2.0',
                    'react-dom': '^18.2.0',
                    "react-scripts": '5.0.1',
                    typescript: '^4.9.5'
                },
                scripts: {
                    start: "react-scripts start",
                    build: "react-scripts build",
                    test: "react-scripts test"
                }
            },
            'tsconfig.json': {
                compilerOptions: {
                    target: 'es5',
                    lib: [
                        'dom',
                        'es2015'
                    ],
                    jsx: 'react-jsx',
                    module: 'esnext',
                    moduleResolution: 'node',
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true,
                    forceConsistentCasingInFileNames: true
                }
            }
        }
    },
    microservice: {
        name: 'Microservice',
        description: 'Containerized microservice with Docker',
        extraDirs: [
            'src',
            'config',
            'tests',
            "scripts"
        ],
        extraFiles: {
            Dockerfile: `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["node", "src/index.js"]
`,
            'docker-compose.yml': `version: '3.8'
services:
  {{PROJECT_NAME}}:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV={{ENVIRONMENT}}
      - PORT=8080
    restart: unless-stopped
`,
            '.dockerignore': `node_modules
npm-debug.log
.env
.git
.gitignore
README.md
.DS_Store
coverage
.nyc_output
`
        }
    },
    'cli-tool': {
        name: 'CLI Tool',
        description: 'Command-line interface tool',
        extraDirs: [
            'src',
            'src/commands',
            'src/utils',
            'tests'
        ],
        extraFiles: {
            'package.json': {
                name: '{{PROJECT_NAME}}',
                version: '1.0.0',
                type: 'module',
                bin: {
                    '{{PROJECT_NAME}}': './src/cli.js'
                },
                scripts: {
                    test: 'jest',
                    lint: 'eslint src/'
                }
            },
            'src/cli.js': `#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('{{PROJECT_NAME}}')
  .description('{{PROJECT_DESCRIPTION}}')
  .version('1.0.0');

program
  .command('hello')
  .description('Say hello')
  .option('-n, --name <name>', 'name to greet', 'World')
  .action((options) => {
    console.log(\`Hello, \${options.name}!\`);
  });

program.parse();
`
        }
    }
};
const ENVIRONMENT_CONFIGS = {
    dev: {
        name: 'development',
        features: [
            'debug',
            'hot-reload',
            'verbose-logging'
        ],
        config: {
            NODE_ENV: 'development',
            DEBUG: 'true',
            LOG_LEVEL: 'debug'
        }
    },
    staging: {
        name: 'staging',
        features: [
            'testing',
            'monitoring'
        ],
        config: {
            NODE_ENV: 'staging',
            DEBUG: 'false',
            LOG_LEVEL: 'info'
        }
    },
    prod: {
        name: 'production',
        features: [
            'optimization',
            'security',
            'monitoring'
        ],
        config: {
            NODE_ENV: 'production',
            DEBUG: 'false',
            LOG_LEVEL: 'error'
        }
    }
};
async function initializeProject(projectPath, options = {}) {
    const { template = null, environment = 'dev', sparc = false, minimal = false, force = false, customConfig = {} } = options;
    try {
        const currentDir = cwd();
        const absoluteProjectPath = projectPath.startsWith('/') ? projectPath : `${currentDir}/${projectPath}`;
        await fs.mkdir(absoluteProjectPath, {
            recursive: true
        });
        const originalDir = cwd();
        process.chdir(absoluteProjectPath);
        const directories = [
            'memory',
            'memory/agents',
            'memory/sessions',
            'coordination',
            'coordination/memory_bank',
            'coordination/subtasks',
            'coordination/orchestration',
            '.claude',
            '.claude/commands',
            '.claude/commands/sparc',
            '.claude/logs'
        ];
        if (template && PROJECT_TEMPLATES[template]) {
            const templateConfig = PROJECT_TEMPLATES[template];
            if (templateConfig.extraDirs) {
                directories.push(...templateConfig.extraDirs);
            }
        }
        await Promise.all(directories.map((dir)=>fs.mkdir(dir, {
                recursive: true
            }).catch(()=>{})));
        const fileCreationTasks = [];
        const claudeMd = sparc ? createSparcClaudeMd() : minimal ? createMinimalClaudeMd() : createFullClaudeMd();
        fileCreationTasks.push(fs.writeFile('CLAUDE.md', claudeMd));
        const memoryBankMd = minimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
        fileCreationTasks.push(fs.writeFile('memory-bank.md', memoryBankMd));
        const coordinationMd = minimal ? createMinimalCoordinationMd() : createFullCoordinationMd();
        fileCreationTasks.push(fs.writeFile('coordination.md', coordinationMd));
        fileCreationTasks.push(fs.writeFile('memory/agents/README.md', createAgentsReadme()), fs.writeFile('memory/sessions/README.md', createSessionsReadme()));
        const initialData = {
            agents: [],
            tasks: [],
            environment: environment,
            template: template,
            customConfig: customConfig,
            lastUpdated: Date.now()
        };
        fileCreationTasks.push(fs.writeFile('memory/claude-flow-data.json', JSON.stringify(initialData, null, 2)));
        if (ENVIRONMENT_CONFIGS[environment]) {
            const envConfig = ENVIRONMENT_CONFIGS[environment];
            const envContent = Object.entries(envConfig.config).map(([key, value])=>`${key}=${value}`).join('\n');
            fileCreationTasks.push(fs.writeFile('.env', envContent));
        }
        if (template && PROJECT_TEMPLATES[template]) {
            const templateConfig = PROJECT_TEMPLATES[template];
            if (templateConfig.extraFiles) {
                for (const [filePath, content] of Object.entries(templateConfig.extraFiles)){
                    let fileContent = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
                    fileContent = fileContent.replace(/{{PROJECT_NAME}}/g, projectPath.split('/').pop()).replace(/{{PROJECT_DESCRIPTION}}/g, templateConfig.description).replace(/{{ENVIRONMENT}}/g, environment);
                    fileCreationTasks.push(fs.writeFile(filePath, fileContent));
                }
            }
        }
        await Promise.all(fileCreationTasks);
        if (sparc) {
            await createSparcStructureManually();
            await createClaudeSlashCommands(projectPath);
        }
        process.chdir(originalDir);
        return {
            success: true,
            projectPath: absoluteProjectPath
        };
    } catch (error) {
        return {
            success: false,
            projectPath,
            error: error.message
        };
    }
}
export async function batchInitCommand(projects, options = {}) {
    const { parallel = true, maxConcurrency = 5, template = null, environments = [
        'dev'
    ], sparc = false, minimal = false, force = false, progressTracking = true, performanceMonitoring = true } = options;
    if (!projects || projects.length === 0) {
        printError('No projects specified for batch initialization');
        return;
    }
    const totalProjects = projects.length * environments.length;
    const tracker = progressTracking ? new BatchProgressTracker(totalProjects) : null;
    const resourceManager = new ResourceManager(parallel ? maxConcurrency : 1);
    const perfMonitor = new PerformanceMonitor({
        enabled: performanceMonitoring,
        logLevel: 'info'
    });
    const resourceMonitor = new ResourceThresholdMonitor({
        maxMemoryMB: 2048,
        ...ResourceThresholdMonitor.createDefaultCallbacks()
    });
    const optimalConcurrency = BatchOptimizer.calculateOptimalConcurrency(totalProjects);
    const timeEstimate = BatchOptimizer.estimateCompletionTime(totalProjects, options);
    const recommendations = BatchOptimizer.generateRecommendations(totalProjects, options);
    if (maxConcurrency > optimalConcurrency) {
        printWarning(`Concurrency ${maxConcurrency} may be too high. Optimal: ${optimalConcurrency}`);
    }
    perfMonitor.start();
    resourceMonitor.start();
    printSuccess(`Starting batch initialization for ${projects.length} projects across ${environments.length} environments`);
    console.log(`Template: ${template || 'default'}`);
    console.log(`Parallelism: ${parallel ? `Yes (max ${maxConcurrency} concurrent)` : 'No'}`);
    console.log(`SPARC: ${sparc ? 'Enabled' : 'Disabled'}\n`);
    const results = [];
    const initTasks = [];
    for (const project of projects){
        for (const env of environments){
            const projectPath = environments.length > 1 ? `${project}-${env}` : project;
            const initTask = async ()=>{
                if (tracker) tracker.startProject(projectPath);
                perfMonitor.recordOperation('project-init-start', {
                    projectPath,
                    template,
                    environment: env
                });
                const result = await resourceManager.withResource(async ()=>{
                    return await initializeProject(projectPath, {
                        template,
                        environment: env,
                        sparc,
                        minimal,
                        force
                    });
                });
                if (result.success) {
                    perfMonitor.recordOperation('project-init-success', {
                        projectPath
                    });
                } else {
                    perfMonitor.recordError(result.error, {
                        projectPath,
                        template,
                        environment: env
                    });
                }
                if (tracker) tracker.completeProject(projectPath, result.success);
                results.push(result);
            };
            if (parallel) {
                initTasks.push(initTask());
            } else {
                await initTask();
            }
        }
    }
    if (parallel) {
        await Promise.all(initTasks);
    }
    console.log('\n\n📊 Batch Initialization Report');
    console.log('================================');
    if (tracker) {
        const report = tracker.getReport();
        console.log(`Total Projects: ${report.total}`);
        console.log(`Successful: ${report.completed} ✅`);
        console.log(`Failed: ${report.failed} ❌`);
        console.log(`Success Rate: ${report.successRate}%`);
        console.log(`Total Time: ${report.elapsedTime}s`);
        console.log(`Average Time per Project: ${(report.elapsedTime / report.total).toFixed(1)}s`);
    }
    const successful = results.filter((r)=>r.success);
    if (successful.length > 0) {
        console.log('\n✅ Successfully initialized:');
        successful.forEach((r)=>console.log(`  - ${r.projectPath}`));
    }
    const failed = results.filter((r)=>!r.success);
    if (failed.length > 0) {
        console.log('\n❌ Failed to initialize:');
        failed.forEach((r)=>console.log(`  - ${r.projectPath}: ${r.error}`));
    }
    perfMonitor.stop();
    resourceMonitor.stop();
    if (performanceMonitoring) {
        console.log(perfMonitor.generateReport());
        if (recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            recommendations.forEach((rec)=>console.log(`  • ${rec}`));
        }
    }
    return results;
}
export async function parseBatchConfig(configFile) {
    try {
        const content = await fs.readFile(configFile, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        printError(`Failed to read batch config file: ${error.message}`);
        return null;
    }
}
export async function batchInitFromConfig(configFile, options = {}) {
    const config = await parseBatchConfig(configFile);
    if (!config) return;
    const { projects = [], baseOptions = {}, projectConfigs = {} } = config;
    const mergedOptions = {
        ...baseOptions,
        ...options
    };
    if (Object.keys(projectConfigs).length > 0) {
        const results = [];
        const resourceManager = new ResourceManager(mergedOptions.maxConcurrency || 5);
        for (const [projectName, projectConfig] of Object.entries(projectConfigs)){
            const projectOptions = {
                ...mergedOptions,
                ...projectConfig
            };
            const result = await resourceManager.withResource(async ()=>{
                return await initializeProject(projectName, projectOptions);
            });
            results.push(result);
        }
        return results;
    }
    return await batchInitCommand(projects, mergedOptions);
}
export function validateBatchOptions(options) {
    const errors = [];
    if (options.maxConcurrency && (options.maxConcurrency < 1 || options.maxConcurrency > 20)) {
        errors.push('maxConcurrency must be between 1 and 20');
    }
    if (options.template && !PROJECT_TEMPLATES[options.template]) {
        errors.push(`Unknown template: ${options.template}. Available: ${Object.keys(PROJECT_TEMPLATES).join(', ')}`);
    }
    if (options.environments) {
        for (const env of options.environments){
            if (!ENVIRONMENT_CONFIGS[env]) {
                errors.push(`Unknown environment: ${env}. Available: ${Object.keys(ENVIRONMENT_CONFIGS).join(', ')}`);
            }
        }
    }
    return errors;
}
export { PROJECT_TEMPLATES, ENVIRONMENT_CONFIGS };

//# sourceMappingURL=batch-init.js.map