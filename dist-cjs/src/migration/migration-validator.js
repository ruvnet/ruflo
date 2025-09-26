import * as fs from 'fs-extra';
import * as path from 'path';
import * as chalk from 'chalk';
import { glob } from 'glob';
export class MigrationValidator {
    requiredFiles = [
        '.claude/commands/sparc.md',
        '.claude/commands/claude-flow-help.md',
        '.claude/commands/claude-flow-memory.md',
        '.claude/BATCHTOOLS_GUIDE.md',
        '.claude/BATCHTOOLS_BEST_PRACTICES.md'
    ];
    requiredCommands = [
        'sparc',
        'sparc-architect',
        'sparc-code',
        'sparc-tdd',
        'claude-flow-help',
        'claude-flow-memory',
        'claude-flow-swarm'
    ];
    async validate(projectPath) {
        const result = {
            valid: true,
            checks: [],
            errors: [],
            warnings: []
        };
        await this.validateFileStructure(projectPath, result);
        await this.validateCommandFiles(projectPath, result);
        await this.validateConfiguration(projectPath, result);
        await this.validateFileIntegrity(projectPath, result);
        await this.validateFunctionality(projectPath, result);
        result.valid = result.errors.length === 0;
        return result;
    }
    async validateFileStructure(projectPath, result) {
        const check = {
            name: 'File Structure',
            passed: true
        };
        const claudePath = path.join(projectPath, '.claude');
        if (!await fs.pathExists(claudePath)) {
            check.passed = false;
            result.errors.push('.claude directory not found');
        }
        const commandsPath = path.join(claudePath, 'commands');
        if (!await fs.pathExists(commandsPath)) {
            check.passed = false;
            result.errors.push('.claude/commands directory not found');
        }
        for (const file of this.requiredFiles){
            const filePath = path.join(projectPath, file);
            if (!await fs.pathExists(filePath)) {
                check.passed = false;
                result.errors.push(`Required file missing: ${file}`);
            }
        }
        result.checks.push(check);
    }
    async validateCommandFiles(projectPath, result) {
        const check = {
            name: 'Command Files',
            passed: true
        };
        const commandsPath = path.join(projectPath, '.claude/commands');
        if (await fs.pathExists(commandsPath)) {
            for (const command of this.requiredCommands){
                const commandFile = path.join(commandsPath, `${command}.md`);
                const sparcCommandFile = path.join(commandsPath, 'sparc', `${command.replace('sparc-', '')}.md`);
                const hasMainFile = await fs.pathExists(commandFile);
                const hasSparcFile = await fs.pathExists(sparcCommandFile);
                if (!hasMainFile && !hasSparcFile) {
                    check.passed = false;
                    result.errors.push(`Command file missing: ${command}.md`);
                } else {
                    const filePath = hasMainFile ? commandFile : sparcCommandFile;
                    await this.validateCommandFileContent(filePath, command, result);
                }
            }
        } else {
            check.passed = false;
            result.errors.push('Commands directory not found');
        }
        result.checks.push(check);
    }
    async validateCommandFileContent(filePath, command, result) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const hasDescription = content.includes("description") || content.includes("Description");
            const hasInstructions = content.length > 100;
            if (!hasDescription) {
                result.warnings.push(`Command ${command} may be missing description`);
            }
            if (!hasInstructions) {
                result.warnings.push(`Command ${command} may have insufficient content`);
            }
            const hasOptimizedContent = content.includes('optimization') || content.includes('performance') || content.includes('efficient');
            if (!hasOptimizedContent && command.includes('sparc')) {
                result.warnings.push(`SPARC command ${command} may not be optimized`);
            }
        } catch (error) {
            result.errors.push(`Failed to validate ${command}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async validateConfiguration(projectPath, result) {
        const check = {
            name: 'Configuration Files',
            passed: true
        };
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        if (await fs.pathExists(claudeMdPath)) {
            const content = await fs.readFile(claudeMdPath, 'utf-8');
            if (!content.includes('SPARC')) {
                result.warnings.push('CLAUDE.md may not include SPARC configuration');
            }
            const requiredSections = [
                'Project Overview',
                'SPARC Development',
                'Memory Integration'
            ];
            for (const section of requiredSections){
                if (!content.includes(section)) {
                    result.warnings.push(`CLAUDE.md missing section: ${section}`);
                }
            }
        } else {
            result.warnings.push('CLAUDE.md not found');
        }
        const roomodesPath = path.join(projectPath, '.roomodes');
        if (await fs.pathExists(roomodesPath)) {
            try {
                const roomodes = await fs.readJson(roomodesPath);
                const requiredModes = [
                    'architect',
                    'code',
                    'tdd',
                    'debug'
                ];
                for (const mode of requiredModes){
                    if (!roomodes[mode]) {
                        result.warnings.push(`Missing SPARC mode: ${mode}`);
                    }
                }
            } catch (error) {
                result.errors.push(`Invalid .roomodes file: ${error instanceof Error ? error.message : String(error)}`);
                check.passed = false;
            }
        }
        result.checks.push(check);
    }
    async validateFileIntegrity(projectPath, result) {
        const check = {
            name: 'File Integrity',
            passed: true
        };
        const claudePath = path.join(projectPath, '.claude');
        if (await fs.pathExists(claudePath)) {
            const files = await glob('**/*.md', {
                cwd: claudePath
            });
            for (const file of files){
                try {
                    const content = await fs.readFile(path.join(claudePath, file), 'utf-8');
                    if (content.length === 0) {
                        result.errors.push(`Empty file: ${file}`);
                        check.passed = false;
                    }
                    if (content.includes('\0')) {
                        result.errors.push(`Corrupted text file: ${file}`);
                        check.passed = false;
                    }
                } catch (error) {
                    result.errors.push(`Cannot read file ${file}: ${error instanceof Error ? error.message : String(error)}`);
                    check.passed = false;
                }
            }
        }
        result.checks.push(check);
    }
    async validateFunctionality(projectPath, result) {
        const check = {
            name: 'Functionality',
            passed: true
        };
        const claudePath = path.join(projectPath, '.claude');
        if (await fs.pathExists(claudePath)) {
            try {
                const testFile = path.join(claudePath, '.test-write');
                await fs.writeFile(testFile, 'test');
                await fs.remove(testFile);
            } catch (error) {
                result.warnings.push('.claude directory may not be writable');
            }
        }
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
            try {
                const packageJson = await fs.readJson(packageJsonPath);
                const scripts = packageJson.scripts || {};
                const conflictingScripts = Object.keys(scripts).filter((script)=>script.startsWith('claude-flow') || script.startsWith('sparc'));
                if (conflictingScripts.length > 0) {
                    result.warnings.push(`Potential script conflicts: ${conflictingScripts.join(', ')}`);
                }
            } catch (error) {
                result.warnings.push('Could not validate package.json');
            }
        }
        result.checks.push(check);
    }
    printValidation(validation) {
        console.log(chalk.bold('\n✅ Migration Validation Report'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`\n${chalk.bold('Overall Status:')} ${validation.valid ? chalk.green('✓ Valid') : chalk.red('✗ Invalid')}`);
        console.log(chalk.bold('\n📋 Validation Checks:'));
        validation.checks.forEach((check)=>{
            const status = check.passed ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${status} ${check.name}`);
            if (check.message) {
                console.log(`     ${chalk.gray(check.message)}`);
            }
        });
        if (validation.errors.length > 0) {
            console.log(chalk.bold('\n❌ Errors:'));
            validation.errors.forEach((error)=>{
                console.log(`  • ${chalk.red(error)}`);
            });
        }
        if (validation.warnings.length > 0) {
            console.log(chalk.bold('\n⚠️  Warnings:'));
            validation.warnings.forEach((warning)=>{
                console.log(`  • ${chalk.yellow(warning)}`);
            });
        }
        console.log(chalk.gray('\n' + '─'.repeat(50)));
        if (validation.valid) {
            console.log(chalk.green('\n🎉 Migration validation passed! Your project is ready to use optimized prompts.'));
        } else {
            console.log(chalk.red('\n⚠️  Migration validation failed. Please address the errors above.'));
        }
    }
}

//# sourceMappingURL=migration-validator.js.map