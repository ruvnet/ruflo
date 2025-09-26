import { cwd, exit } from '../node-compat.js';
import path from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { optimizeHiveMindDatabase, performMaintenance, generateOptimizationReport } from './hive-mind/db-optimizer.js';
function showOptimizeHelp() {
    console.log(`
${chalk.yellow('🔧 Hive Mind Database Optimization')}

${chalk.bold('USAGE:')}
  claude-flow hive-mind-optimize [options]

${chalk.bold('OPTIONS:')}
  --auto              Run optimization without prompts
  --vacuum            Vacuum database (requires exclusive access)
  --clean-memory      Clean old memory entries
  --archive-tasks     Archive completed tasks
  --check-integrity   Run integrity check
  --report            Generate optimization report only
  --memory-days <n>   Memory retention days (default: 30)
  --task-days <n>     Task retention days (default: 7)
  --verbose           Show detailed output

${chalk.bold('EXAMPLES:')}
  ${chalk.gray('# Interactive optimization')}
  claude-flow hive-mind-optimize

  ${chalk.gray('# Auto-optimize with all features')}
  claude-flow hive-mind-optimize --auto --vacuum --clean-memory --archive-tasks

  ${chalk.gray('# Generate report only')}
  claude-flow hive-mind-optimize --report

  ${chalk.gray('# Custom retention periods')}
  claude-flow hive-mind-optimize --clean-memory --memory-days 60 --task-days 14

${chalk.bold('FEATURES:')}
  ${chalk.cyan('🚀')} Performance indexes for faster queries
  ${chalk.cyan('📊')} Query optimization and statistics
  ${chalk.cyan('🧹')} Memory cleanup and archiving
  ${chalk.cyan('📈')} Performance tracking tables
  ${chalk.cyan('🔍')} Behavioral pattern analysis
  ${chalk.cyan('💾')} Backward-compatible upgrades

${chalk.bold('SAFETY:')}
  • All changes are backward-compatible
  • Existing data is preserved
  • Automatic backups before major operations
  • Rollback capability on errors
`);
}
export async function hiveMindOptimizeCommand(args, flags) {
    if (flags.help || flags.h) {
        showOptimizeHelp();
        return;
    }
    const hiveMindDir = path.join(cwd(), '.hive-mind');
    const dbPath = path.join(hiveMindDir, 'hive.db');
    if (!existsSync(dbPath)) {
        console.error(chalk.red('Error: Hive Mind database not found'));
        console.log('Run "claude-flow hive-mind init" first');
        exit(1);
    }
    if (flags.report) {
        await generateReport(dbPath);
        return;
    }
    if (flags.auto) {
        await runOptimization(dbPath, {
            vacuum: flags.vacuum || false,
            cleanMemory: flags['clean-memory'] || false,
            archiveTasks: flags['archive-tasks'] || false,
            checkIntegrity: flags['check-integrity'] || false,
            memoryRetentionDays: flags['memory-days'] || 30,
            taskRetentionDays: flags['task-days'] || 7,
            verbose: flags.verbose || false
        });
    } else {
        await interactiveOptimization(dbPath, flags);
    }
}
async function interactiveOptimization(dbPath, flags) {
    console.log(chalk.yellow('\n🔧 Hive Mind Database Optimization Wizard\n'));
    const report = await generateOptimizationReport(dbPath);
    if (report) {
        console.log(chalk.cyan('Current Database Status:'));
        console.log(`  Schema Version: ${report.schemaVersion}`);
        console.log(`  Tables: ${Object.keys(report.tables).length}`);
        console.log(`  Indexes: ${report.indexes.length}`);
        let totalSize = 0;
        let totalRows = 0;
        Object.entries(report.tables).forEach(([name, stats])=>{
            totalSize += stats.sizeBytes;
            totalRows += stats.rowCount;
        });
        console.log(`  Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Total Rows: ${totalRows.toLocaleString()}`);
        console.log('');
    }
    const schemaVersion = report?.schemaVersion || 1.0;
    const needsOptimization = schemaVersion < 1.5;
    if (!needsOptimization) {
        console.log(chalk.green('✓ Database is already fully optimized!\n'));
        const { maintenance } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'maintenance',
                message: 'Would you like to perform maintenance tasks?',
                default: true
            }
        ]);
        if (!maintenance) {
            console.log(chalk.gray('No changes made.'));
            return;
        }
    } else {
        console.log(chalk.yellow(`⚠ Database can be optimized from version ${schemaVersion} to 1.5\n`));
    }
    const answers = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'operations',
            message: 'Select operations to perform:',
            choices: [
                {
                    name: 'Apply performance optimizations',
                    value: 'optimize',
                    checked: needsOptimization,
                    disabled: !needsOptimization
                },
                {
                    name: 'Clean old memory entries',
                    value: 'cleanMemory',
                    checked: true
                },
                {
                    name: 'Archive completed tasks',
                    value: 'archiveTasks',
                    checked: true
                },
                {
                    name: 'Vacuum database (requires exclusive access)',
                    value: 'vacuum',
                    checked: false
                },
                {
                    name: 'Check database integrity',
                    value: 'checkIntegrity',
                    checked: true
                }
            ]
        },
        {
            type: 'number',
            name: 'memoryDays',
            message: 'Memory retention days:',
            default: 30,
            when: (answers)=>answers.operations.includes('cleanMemory')
        },
        {
            type: 'number',
            name: 'taskDays',
            message: 'Task retention days:',
            default: 7,
            when: (answers)=>answers.operations.includes('archiveTasks')
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Proceed with optimization?',
            default: true
        }
    ]);
    if (!answers.confirm) {
        console.log(chalk.gray('Optimization cancelled.'));
        return;
    }
    if (answers.operations.includes('optimize') || answers.operations.includes('vacuum')) {
        console.log(chalk.blue('\n📦 Creating backup...'));
        await createBackup(dbPath);
    }
    const options = {
        vacuum: answers.operations.includes('vacuum'),
        cleanMemory: answers.operations.includes('cleanMemory'),
        archiveTasks: answers.operations.includes('archiveTasks'),
        checkIntegrity: answers.operations.includes('checkIntegrity'),
        memoryRetentionDays: answers.memoryDays || 30,
        taskRetentionDays: answers.taskDays || 7,
        verbose: flags.verbose || false
    };
    await runOptimization(dbPath, options);
}
async function runOptimization(dbPath, options) {
    console.log(chalk.blue('\n🚀 Starting optimization...\n'));
    const result = await optimizeHiveMindDatabase(dbPath, options);
    if (!result.success) {
        console.error(chalk.red('\n❌ Optimization failed:', result.error));
        exit(1);
    }
    if (options.cleanMemory || options.archiveTasks || options.checkIntegrity) {
        console.log(chalk.blue('\n🧹 Running maintenance tasks...\n'));
        await performMaintenance(dbPath, options);
    }
    console.log(chalk.blue('\n📊 Generating optimization report...\n'));
    await generateReport(dbPath);
    console.log(chalk.green('\n✅ Optimization complete!\n'));
    console.log(chalk.bold('💡 Tips:'));
    console.log('  • Monitor performance with: claude-flow hive-mind metrics');
    console.log('  • Schedule regular maintenance: claude-flow hive-mind-optimize --auto');
    console.log('  • Check swarm status: claude-flow hive-mind status');
}
async function generateReport(dbPath) {
    const report = await generateOptimizationReport(dbPath);
    if (!report) {
        console.error(chalk.red('Failed to generate report'));
        return;
    }
    console.log(chalk.bold('\n📊 Database Optimization Report\n'));
    console.log(chalk.cyan('Schema Version:'), report.schemaVersion);
    console.log(chalk.cyan('Indexes:'), report.indexes.length);
    console.log(chalk.cyan('\nTable Statistics:'));
    Object.entries(report.tables).forEach(([name, stats])=>{
        const sizeMB = (stats.sizeBytes / 1024 / 1024).toFixed(2);
        console.log(`  ${name}: ${stats.rowCount.toLocaleString()} rows (${sizeMB} MB)`);
    });
    if (report.performance.avgTaskCompletionMinutes > 0) {
        console.log(chalk.cyan('\nPerformance Metrics:'));
        console.log(`  Avg Task Completion: ${report.performance.avgTaskCompletionMinutes.toFixed(1)} minutes`);
    }
    console.log(chalk.cyan('\nOptimization Status:'));
    if (report.schemaVersion >= 1.5) {
        console.log(chalk.green('  ✓ Database is fully optimized'));
    } else {
        console.log(chalk.yellow(`  ⚠ Can be upgraded from v${report.schemaVersion} to v1.5`));
        console.log(chalk.gray('    Run: claude-flow hive-mind-optimize'));
    }
    const largeMemoryTable = report.tables.collective_memory?.rowCount > 10000;
    const largeTaskTable = report.tables.tasks?.rowCount > 50000;
    if (largeMemoryTable || largeTaskTable) {
        console.log(chalk.cyan('\nMaintenance Recommendations:'));
        if (largeMemoryTable) {
            console.log(chalk.yellow('  • Consider cleaning old memory entries'));
        }
        if (largeTaskTable) {
            console.log(chalk.yellow('  • Consider archiving completed tasks'));
        }
    }
}
async function createBackup(dbPath) {
    try {
        const { execSync } = await import('child_process');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = dbPath.replace('.db', `-backup-${timestamp}.db`);
        execSync(`cp "${dbPath}" "${backupPath}"`);
        console.log(chalk.green(`✓ Backup created: ${path.basename(backupPath)}`));
        return backupPath;
    } catch (error) {
        console.error(chalk.yellow('⚠ Backup failed:', error.message));
        const { proceed } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'proceed',
                message: 'Continue without backup?',
                default: false
            }
        ]);
        if (!proceed) {
            exit(1);
        }
    }
}
export default hiveMindOptimizeCommand;

//# sourceMappingURL=hive-mind-optimize.js.map