#!/usr/bin/env node
import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { HiveMind } from '../../../hive-mind/core/HiveMind.js';
import { formatSuccess, formatError, formatInfo, formatWarning } from '../../formatter.js';
const AGENT_TYPES = [
    'coordinator',
    'researcher',
    'coder',
    'analyst',
    'architect',
    'tester',
    'reviewer',
    'optimizer',
    'documenter',
    'monitor',
    'specialist',
    'requirements_analyst',
    'design_architect',
    'system-architect',
    'task_planner',
    'task-planner',
    'implementation_coder',
    'developer',
    'quality_reviewer',
    'steering_documenter'
];
const CAPABILITY_MAP = {
    coordinator: [
        'task_management',
        'resource_allocation',
        'consensus_building'
    ],
    researcher: [
        'information_gathering',
        'pattern_recognition',
        'knowledge_synthesis'
    ],
    coder: [
        'code_generation',
        'refactoring',
        'debugging'
    ],
    analyst: [
        'data_analysis',
        'performance_metrics',
        'bottleneck_detection'
    ],
    architect: [
        'system_design',
        'architecture_patterns',
        'integration_planning'
    ],
    tester: [
        'test_generation',
        'quality_assurance',
        'edge_case_detection'
    ],
    reviewer: [
        'code_review',
        'standards_enforcement',
        'best_practices'
    ],
    optimizer: [
        'performance_optimization',
        'resource_optimization',
        'algorithm_improvement'
    ],
    documenter: [
        'documentation_generation',
        'api_docs',
        'user_guides'
    ],
    monitor: [
        'system_monitoring',
        'health_checks',
        'alerting'
    ],
    specialist: [
        'domain_expertise',
        'custom_capabilities',
        'problem_solving'
    ],
    requirements_analyst: [
        'requirements_analysis',
        'user_story_creation',
        'acceptance_criteria'
    ],
    design_architect: [
        'system_design',
        'architecture',
        'specs_driven_design'
    ],
    'system-architect': [
        'system_design',
        'architecture_patterns',
        'integration_planning'
    ],
    task_planner: [
        'task_management',
        'workflow_orchestration'
    ],
    'task-planner': [
        'task_management',
        'workflow_orchestration'
    ],
    implementation_coder: [
        'code_generation',
        'implementation',
        'debugging'
    ],
    developer: [
        'code_generation',
        'implementation',
        'debugging'
    ],
    quality_reviewer: [
        'code_review',
        'quality_assurance',
        'testing'
    ],
    steering_documenter: [
        'documentation_generation',
        'governance'
    ]
};
export const spawnCommand = new Command('spawn').description('Spawn specialized agents into the Hive Mind').argument('[type]', 'Agent type to spawn').option('-n, --name <string>', 'Custom agent name').option('-c, --capabilities <items>', 'Additional capabilities (comma-separated)').option('-s, --swarm-id <id>', 'Target swarm ID').option('-i, --interactive', 'Interactive spawn mode', false).option('-b, --batch <number>', 'Spawn multiple agents of same type', '1').option('--auto-assign', 'Automatically assign to available tasks', false).action(async (type, options)=>{
    const spinner = ora('Spawning agent...').start();
    try {
        const swarmId = options.swarmId || await getActiveSwarmId();
        if (!swarmId) {
            throw new Error('No active swarm found. Initialize a Hive Mind first.');
        }
        if (options.interactive || !type) {
            const answers = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'type',
                    message: 'Select agent type:',
                    choices: AGENT_TYPES,
                    when: !type
                },
                {
                    type: 'checkbox',
                    name: 'additionalCapabilities',
                    message: 'Select additional capabilities:',
                    choices: getAllCapabilities(),
                    when: (answers)=>{
                        const agentType = type || answers.type;
                        return agentType === 'specialist';
                    }
                },
                {
                    type: 'input',
                    name: 'customName',
                    message: 'Enter custom agent name (optional):',
                    when: !options.name
                }
            ]);
            type = type || answers.type;
            options.name = options.name || answers.customName;
            if (answers.additionalCapabilities) {
                options.capabilities = answers.additionalCapabilities.join(',');
            }
        }
        if (!AGENT_TYPES.includes(type)) {
            throw new Error(`Invalid agent type: ${type}`);
        }
        const hiveMind = await HiveMind.load(swarmId);
        const baseCapabilities = CAPABILITY_MAP[type] || [];
        const additionalCapabilities = options.capabilities ? options.capabilities.split(',').map((c)=>c.trim()) : [];
        const capabilities = [
            ...baseCapabilities,
            ...additionalCapabilities
        ];
        const batchSize = parseInt(options.batch, 10);
        const spawnedAgents = [];
        for(let i = 0; i < batchSize; i++){
            const agentName = options.name || `${type}-${Date.now()}-${i}`;
            const agent = await hiveMind.spawnAgent({
                type: type,
                name: agentName,
                capabilities,
                autoAssign: options.autoAssign
            });
            spawnedAgents.push(agent);
            if (batchSize > 1) {
                spinner.text = `Spawning agents... (${i + 1}/${batchSize})`;
            }
        }
        spinner.succeed(formatSuccess(`Successfully spawned ${batchSize} ${type} agent(s)!`));
        console.log('\n' + chalk.bold('🤖 Spawned Agents:'));
        spawnedAgents.forEach((agent)=>{
            console.log(formatInfo(`${agent.name} (${agent.id})`));
            console.log(chalk.gray(`  Capabilities: ${agent.capabilities.join(', ')}`));
            if (agent.currentTask) {
                console.log(chalk.yellow(`  Assigned to: ${agent.currentTask}`));
            }
        });
        const stats = await hiveMind.getStats();
        console.log('\n' + chalk.bold('📊 Swarm Statistics:'));
        console.log(formatInfo(`Total Agents: ${stats.totalAgents}`));
        console.log(formatInfo(`Active Agents: ${stats.activeAgents}`));
        console.log(formatInfo(`Available Capacity: ${stats.availableCapacity}%`));
        if (options.autoAssign && stats.pendingTasks > 0) {
            console.log(formatWarning(`Auto-assigned to ${stats.pendingTasks} pending task(s)`));
        }
    } catch (error) {
        spinner.fail(formatError('Failed to spawn agent'));
        console.error(formatError(error.message));
        process.exit(1);
    }
});
async function getActiveSwarmId() {
    const { DatabaseManager } = await import('../../../hive-mind/core/DatabaseManager.js');
    const db = await DatabaseManager.getInstance();
    return db.getActiveSwarmId();
}
function getAllCapabilities() {
    const allCapabilities = new Set();
    Object.values(CAPABILITY_MAP).forEach((caps)=>{
        caps.forEach((cap)=>allCapabilities.add(cap));
    });
    return Array.from(allCapabilities);
}

//# sourceMappingURL=spawn.js.map