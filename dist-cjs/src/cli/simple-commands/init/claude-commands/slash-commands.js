import { createSparcSlashCommand, createMainSparcCommand } from './sparc-commands.js';
import { createClaudeFlowCommands } from './claude-flow-commands.js';
import { copyTemplates } from '../template-copier.js';
import { promises as fs } from 'fs';
import { join } from 'path';
export async function createClaudeSlashCommands(workingDir) {
    try {
        console.log('\n📝 Creating Claude Code slash commands...');
        const slashCommandOptions = {
            sparc: true,
            force: true,
            dryRun: false
        };
        const roomodesPath = `${workingDir}/.roomodes`;
        try {
            const roomodesContent = await fs.readFile(roomodesPath, 'utf8');
            const roomodes = JSON.parse(roomodesContent);
            for (const mode of roomodes.customModes){
                const commandPath = join(workingDir, '.claude', 'commands', 'sparc', `${mode.slug}.md`);
                const commandContent = createSparcSlashCommand(mode);
                await fs.mkdir(join(workingDir, '.claude', 'commands', 'sparc'), {
                    recursive: true
                });
                await fs.writeFile(commandPath, commandContent);
                console.log(`  ✓ Created slash command: /sparc-${mode.slug}`);
            }
            const mainSparcCommand = createMainSparcCommand(roomodes.customModes);
            await fs.writeFile(join(workingDir, '.claude', 'commands', 'sparc.md'), mainSparcCommand);
            console.log('  ✓ Created main slash command: /sparc');
        } catch (err) {
            console.log('  🔄 Using template copier for SPARC commands...');
            const copyResults = await copyTemplates(workingDir, slashCommandOptions);
            if (!copyResults.success) {
                console.log(`  ⚠️  Template copier failed: ${copyResults.errors.join(', ')}`);
            }
        }
        await createClaudeFlowCommands(workingDir);
    } catch (err) {}
}

//# sourceMappingURL=slash-commands.js.map