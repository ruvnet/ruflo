import { existsSync } from '../../node-compat.js';
import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export async function copyTemplates(targetDir, options = {}) {
    const results = {
        success: true,
        copiedFiles: [],
        errors: []
    };
    try {
        const templatesDir = join(__dirname, 'templates');
        const templateVariant = options.verify || options.pair ? 'verification' : options.optimized ? 'optimized' : options.enhanced ? 'enhanced' : options.minimal ? 'minimal' : options.sparc ? 'sparc' : 'full';
        const coreFiles = [
            {
                source: 'CLAUDE.md',
                destination: 'CLAUDE.md',
                useVariant: true
            },
            {
                source: 'memory-bank.md',
                destination: 'memory-bank.md',
                useVariant: true
            },
            {
                source: 'coordination.md',
                destination: 'coordination.md',
                useVariant: true
            }
        ];
        for (const file of coreFiles){
            if (options.skipClaudeMd && file.destination === 'CLAUDE.md') continue;
            if (options.skipSettings && file.destination.includes('settings')) continue;
            const sourceFile = file.useVariant && existsSync(join(templatesDir, `${file.source}.${templateVariant}`)) ? `${file.source}.${templateVariant}` : file.source;
            const sourcePath = join(templatesDir, sourceFile);
            const destPath = join(targetDir, file.destination);
            if (await copyFile(sourcePath, destPath, options)) {
                results.copiedFiles.push(file.destination);
            } else if (!options.dryRun) {
                results.errors.push(`Failed to copy ${file.destination}`);
            }
        }
        if (options.enhanced || !options.minimal) {
            const claudeDir = join(targetDir, '.claude');
            if (!options.skipSettings) {
                const settingsSource = options.verify || options.pair ? 'settings.json.verification' : options.enhanced ? 'settings.json.enhanced' : 'settings.json';
                const settingsPath = join(templatesDir, settingsSource);
                const settingsDest = join(claudeDir, 'settings.json');
                if (!options.dryRun) {
                    await fs.mkdir(claudeDir, {
                        recursive: true
                    });
                }
                if (await copyFile(settingsPath, settingsDest, options)) {
                    results.copiedFiles.push('.claude/settings.json');
                }
            } else if (!options.dryRun) {
                await fs.mkdir(claudeDir, {
                    recursive: true
                });
            }
            if (options.sparc || options.enhanced) {
                await copyCommandTemplates(templatesDir, targetDir, options, results);
            }
            if (options.enhanced) {
                await copyHelperScripts(templatesDir, targetDir, options, results);
            }
        }
        if (options.sparc) {
            await copySparcTemplates(templatesDir, targetDir, options, results);
        }
        await copyWrapperScripts(templatesDir, targetDir, options, results);
        await createDirectoryStructure(targetDir, options);
        await createMemoryReadmeFiles(targetDir, options, results);
    } catch (err) {
        results.success = false;
        results.errors.push(`Template copy failed: ${err.message}`);
    }
    return results;
}
async function copyFile(source, destination, options) {
    try {
        if (!existsSync(source)) {
            const templateContent = await getTemplateContent(source);
            if (templateContent) {
                if (!options.dryRun) {
                    await fs.writeFile(destination, templateContent);
                }
                console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} ${relative(process.cwd(), destination)}`);
                return true;
            }
            console.log(`  ⚠️  Template not found: ${relative(process.cwd(), source)}`);
            return false;
        }
        if (existsSync(destination) && !options.force) {
            console.log(`  ⚠️  File already exists: ${relative(process.cwd(), destination)} (use --force to overwrite)`);
            return false;
        }
        if (!options.dryRun) {
            await fs.mkdir(dirname(destination), {
                recursive: true
            });
            const content = await fs.readFile(source, 'utf8');
            await fs.writeFile(destination, content);
            if (source.endsWith('.sh') || source.includes('claude-flow')) {
                await fs.chmod(destination, 0o755);
            }
        }
        console.log(`  ${options.dryRun ? '[DRY RUN] Would copy' : '✓ Copied'} ${relative(process.cwd(), destination)}`);
        return true;
    } catch (err) {
        console.log(`  ❌ Failed to copy ${relative(process.cwd(), destination)}: ${err.message}`);
        return false;
    }
}
async function copyCommandTemplates(templatesDir, targetDir, options, results) {
    const commandsSourceDir = join(templatesDir, 'commands');
    const commandsDestDir = join(targetDir, '.claude', 'commands');
    if (!existsSync(commandsSourceDir)) {
        return await generateCommandTemplates(targetDir, options, results);
    }
    try {
        if (!options.dryRun) {
            await fs.mkdir(commandsDestDir, {
                recursive: true
            });
        }
        const categories = await fs.readdir(commandsSourceDir);
        for (const category of categories){
            const categoryPath = join(commandsSourceDir, category);
            const stat = await fs.stat(categoryPath);
            if (stat.isDirectory()) {
                const destCategoryPath = join(commandsDestDir, category);
                if (!options.dryRun) {
                    await fs.mkdir(destCategoryPath, {
                        recursive: true
                    });
                }
                const files = await fs.readdir(categoryPath);
                for (const file of files){
                    const sourcePath = join(categoryPath, file);
                    const destPath = join(destCategoryPath, file);
                    if (await copyFile(sourcePath, destPath, options)) {
                        results.copiedFiles.push(join('.claude', 'commands', category, file));
                    }
                }
            }
        }
    } catch (err) {
        results.errors.push(`Failed to copy command templates: ${err.message}`);
    }
}
async function copySparcTemplates(templatesDir, targetDir, options, results) {
    const sparcDir = join(targetDir, '.claude', 'commands', 'sparc');
    try {
        if (!options.dryRun) {
            await fs.mkdir(sparcDir, {
                recursive: true
            });
        }
        const { createSparcModeTemplates, createSparcModesOverview } = await import('./templates/sparc-modes.js');
        const sparcTemplates = createSparcModeTemplates();
        const templatesToCreate = options.selectedModes ? Object.entries(sparcTemplates).filter(([filename])=>{
            const mode = filename.replace('.md', '');
            return options.selectedModes.includes(mode);
        }) : Object.entries(sparcTemplates);
        for (const [filename, content] of templatesToCreate){
            const destPath = join(sparcDir, filename);
            if (!options.dryRun) {
                await fs.writeFile(destPath, content);
            }
            console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} .claude/commands/sparc/${filename}`);
            results.copiedFiles.push(join('.claude', 'commands', 'sparc', filename));
        }
        const overviewPath = join(sparcDir, 'sparc-modes.md');
        if (!options.dryRun) {
            await fs.writeFile(overviewPath, createSparcModesOverview());
        }
        console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} .claude/commands/sparc/sparc-modes.md`);
        results.copiedFiles.push('.claude/commands/sparc/sparc-modes.md');
        await copySwarmTemplates(templatesDir, targetDir, options, results);
    } catch (err) {
        results.errors.push(`Failed to copy SPARC templates: ${err.message}`);
    }
}
async function copySwarmTemplates(templatesDir, targetDir, options, results) {
    const swarmDir = join(targetDir, '.claude', 'commands', 'swarm');
    try {
        if (!options.dryRun) {
            await fs.mkdir(swarmDir, {
                recursive: true
            });
        }
        const { createSwarmStrategyTemplates } = await import('./templates/sparc-modes.js');
        const swarmTemplates = createSwarmStrategyTemplates();
        for (const [filename, content] of Object.entries(swarmTemplates)){
            const destPath = join(swarmDir, filename);
            if (!options.dryRun) {
                await fs.writeFile(destPath, content);
            }
            console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} .claude/commands/swarm/${filename}`);
            results.copiedFiles.push(join('.claude', 'commands', 'swarm', filename));
        }
    } catch (err) {
        results.errors.push(`Failed to copy swarm templates: ${err.message}`);
    }
}
async function copyHelperScripts(templatesDir, targetDir, options, results) {
    const helpersDir = join(targetDir, '.claude', 'helpers');
    try {
        if (!options.dryRun) {
            await fs.mkdir(helpersDir, {
                recursive: true
            });
        }
        const helpers = [
            'setup-mcp.sh',
            'quick-start.sh',
            'github-setup.sh',
            'github-safe.js',
            'checkpoint-manager.sh',
            'standard-checkpoint-hooks.sh'
        ];
        const { createHelperScript } = await import('./templates/enhanced-templates.js');
        for (const helper of helpers){
            const content = createHelperScript(helper);
            if (content) {
                const destPath = join(helpersDir, helper);
                if (!options.dryRun) {
                    await fs.writeFile(destPath, content);
                    await fs.chmod(destPath, 0o755);
                }
                console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} .claude/helpers/${helper}`);
                results.copiedFiles.push(join('.claude', 'helpers', helper));
            }
        }
    } catch (err) {
        results.errors.push(`Failed to copy helper scripts: ${err.message}`);
    }
}
async function copyWrapperScripts(templatesDir, targetDir, options, results) {
    try {
        const unixWrapperPath = join(targetDir, 'claude-flow');
        const unixWrapperSource = join(templatesDir, 'claude-flow-universal');
        if (await copyFile(unixWrapperSource, unixWrapperPath, options)) {
            if (!options.dryRun) {
                await fs.chmod(unixWrapperPath, 0o755);
            }
            results.copiedFiles.push('claude-flow');
        }
        const batchWrapperPath = join(targetDir, 'claude-flow.bat');
        const batchWrapperSource = join(templatesDir, 'claude-flow.bat');
        if (await copyFile(batchWrapperSource, batchWrapperPath, options)) {
            results.copiedFiles.push('claude-flow.bat');
        }
        const psWrapperPath = join(targetDir, 'claude-flow.ps1');
        const psWrapperSource = join(templatesDir, 'claude-flow.ps1');
        if (await copyFile(psWrapperSource, psWrapperPath, options)) {
            results.copiedFiles.push('claude-flow.ps1');
        }
    } catch (err) {
        results.errors.push(`Failed to copy wrapper scripts: ${err.message}`);
    }
}
async function createDirectoryStructure(targetDir, options) {
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
        '.claude/logs',
        '.swarm'
    ];
    if (options.sparc) {
        directories.push('.claude/commands/sparc', '.claude/commands/swarm');
    }
    for (const dir of directories){
        const dirPath = join(targetDir, dir);
        try {
            if (!options.dryRun) {
                await fs.mkdir(dirPath, {
                    recursive: true
                });
            }
            console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} ${dir}/ directory`);
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.log(`  ❌ Failed to create ${dir}/: ${err.message}`);
            }
        }
    }
}
async function createMemoryReadmeFiles(targetDir, options, results) {
    const { createAgentsReadme, createSessionsReadme } = await import('./templates/readme-files.js');
    const readmeFiles = [
        {
            path: 'memory/agents/README.md',
            content: createAgentsReadme()
        },
        {
            path: 'memory/sessions/README.md',
            content: createSessionsReadme()
        }
    ];
    for (const { path, content } of readmeFiles){
        const fullPath = join(targetDir, path);
        try {
            if (!options.dryRun) {
                await fs.mkdir(dirname(fullPath), {
                    recursive: true
                });
                await fs.writeFile(fullPath, content);
            }
            console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} ${path}`);
            results.copiedFiles.push(path);
        } catch (err) {
            results.errors.push(`Failed to create ${path}: ${err.message}`);
        }
    }
    const dbPath = join(targetDir, 'memory', 'claude-flow-data.json');
    const initialData = {
        agents: [],
        tasks: [],
        lastUpdated: Date.now()
    };
    try {
        if (!options.dryRun) {
            await fs.writeFile(dbPath, JSON.stringify(initialData, null, 2));
        }
        console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} memory/claude-flow-data.json (persistence database)`);
        results.copiedFiles.push('memory/claude-flow-data.json');
    } catch (err) {
        results.errors.push(`Failed to create persistence database: ${err.message}`);
    }
}
async function getTemplateContent(templatePath) {
    const filename = templatePath.split('/').pop();
    const templateGenerators = {
        'CLAUDE.md': async ()=>{
            const { createFullClaudeMd } = await import('./templates/claude-md.js');
            return createFullClaudeMd();
        },
        'CLAUDE.md.sparc': async ()=>{
            const { createSparcClaudeMd } = await import('./templates/claude-md.js');
            return createSparcClaudeMd();
        },
        'CLAUDE.md.minimal': async ()=>{
            const { createMinimalClaudeMd } = await import('./templates/claude-md.js');
            return createMinimalClaudeMd();
        },
        'CLAUDE.md.optimized': async ()=>{
            const { createOptimizedSparcClaudeMd } = await import('./templates/claude-md.js');
            return createOptimizedSparcClaudeMd();
        },
        'CLAUDE.md.enhanced': async ()=>{
            const { createEnhancedClaudeMd } = await import('./templates/enhanced-templates.js');
            return createEnhancedClaudeMd();
        },
        'CLAUDE.md.verification': async ()=>{
            const { createVerificationClaudeMd } = await import('./templates/verification-claude-md.js');
            return createVerificationClaudeMd();
        },
        'memory-bank.md': async ()=>{
            const { createFullMemoryBankMd } = await import('./templates/memory-bank-md.js');
            return createFullMemoryBankMd();
        },
        'memory-bank.md.minimal': async ()=>{
            const { createMinimalMemoryBankMd } = await import('./templates/memory-bank-md.js');
            return createMinimalMemoryBankMd();
        },
        'memory-bank.md.optimized': async ()=>{
            const { createOptimizedMemoryBankMd } = await import('./templates/memory-bank-md.js');
            return createOptimizedMemoryBankMd();
        },
        'coordination.md': async ()=>{
            const { createFullCoordinationMd } = await import('./templates/coordination-md.js');
            return createFullCoordinationMd();
        },
        'coordination.md.minimal': async ()=>{
            const { createMinimalCoordinationMd } = await import('./templates/coordination-md.js');
            return createMinimalCoordinationMd();
        },
        'coordination.md.optimized': async ()=>{
            const { createOptimizedCoordinationMd } = await import('./templates/coordination-md.js');
            return createOptimizedCoordinationMd();
        },
        'settings.json': async ()=>{
            return await fs.readFile(join(__dirname, 'templates', 'settings.json'), 'utf8');
        },
        'settings.json.enhanced': async ()=>{
            const { createEnhancedSettingsJson } = await import('./templates/enhanced-templates.js');
            return createEnhancedSettingsJson();
        },
        'settings.json.verification': async ()=>{
            const { createVerificationSettingsJson } = await import('./templates/verification-claude-md.js');
            return createVerificationSettingsJson();
        },
        'claude-flow-universal': async ()=>{
            return await fs.readFile(join(__dirname, 'templates', 'claude-flow-universal'), 'utf8');
        }
    };
    const generator = templateGenerators[filename] || templateGenerators[filename.replace(/\.(sparc|minimal|optimized|enhanced)$/, '')];
    if (generator) {
        try {
            return await generator();
        } catch (err) {
            console.log(`  ⚠️  Failed to generate template content for ${filename}: ${err.message}`);
            return null;
        }
    }
    return null;
}
async function generateCommandTemplates(targetDir, options, results) {
    const { COMMAND_STRUCTURE, createCommandDoc } = await import('./templates/enhanced-templates.js');
    for (const [category, commands] of Object.entries(COMMAND_STRUCTURE)){
        const categoryDir = join(targetDir, '.claude', 'commands', category);
        try {
            if (!options.dryRun) {
                await fs.mkdir(categoryDir, {
                    recursive: true
                });
                const categoryReadme = `# ${category.charAt(0).toUpperCase() + category.slice(1)} Commands

Commands for ${category} operations in Claude Flow.

## Available Commands

${commands.map((cmd)=>`- [${cmd}](./${cmd}.md)`).join('\n')}
`;
                await fs.writeFile(join(categoryDir, 'README.md'), categoryReadme);
            }
            for (const command of commands){
                const doc = createCommandDoc(category, command);
                if (doc) {
                    const docPath = join(categoryDir, `${command}.md`);
                    if (!options.dryRun) {
                        await fs.writeFile(docPath, doc);
                    }
                    results.copiedFiles.push(join('.claude', 'commands', category, `${command}.md`));
                }
            }
            console.log(`  ${options.dryRun ? '[DRY RUN] Would create' : '✓ Created'} ${commands.length} ${category} command docs`);
        } catch (err) {
            results.errors.push(`Failed to generate ${category} command templates: ${err.message}`);
        }
    }
}

//# sourceMappingURL=template-copier.js.map