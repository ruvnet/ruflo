import { success, error, warning, info } from '../cli-core.js';
import { configManager } from '../../config/config-manager.js';
import { getRuvSwarmIntegration, RuvSwarmConfigHelpers, initializeRuvSwarmIntegration } from '../../config/ruv-swarm-integration.js';
export async function configIntegrationAction(ctx) {
    if (ctx.flags.help || ctx.flags.h || ctx.args.length === 0) {
        showConfigIntegrationHelp();
        return;
    }
    const subcommand = ctx.args[0];
    const subArgs = ctx.args.slice(1);
    try {
        switch(subcommand){
            case 'setup':
                await handleSetup(ctx);
                break;
            case 'sync':
                await handleSync(ctx);
                break;
            case 'status':
                await handleStatus(ctx);
                break;
            case 'validate':
                await handleValidate(ctx);
                break;
            case 'preset':
                await handlePreset(ctx);
                break;
            case 'export':
                await handleExport(ctx);
                break;
            case 'import':
                await handleImport(ctx);
                break;
            default:
                error(`Unknown config-integration subcommand: ${subcommand}`);
                showConfigIntegrationHelp();
                break;
        }
    } catch (err) {
        error(`Configuration integration command failed: ${err.message}`);
    }
}
function showConfigIntegrationHelp() {
    console.log('config-integration - Enhanced configuration management with ruv-swarm\\n');
    console.log('Usage:');
    console.log('  claude-flow config-integration <command> [options]\\n');
    console.log('Commands:');
    console.log('  setup                      Initialize ruv-swarm integration');
    console.log('  sync                       Synchronize configurations');
    console.log('  status                     Show integration status');
    console.log('  validate                   Validate all configurations');
    console.log('  preset <type>              Apply configuration preset');
    console.log('  export <file>              Export unified configuration');
    console.log('  import <file>              Import and apply configuration\\n');
    console.log('Presets:');
    console.log('  development                Optimized for development workflows');
    console.log('  research                   Optimized for research and analysis');
    console.log('  production                 Optimized for production environments\\n');
    console.log('Examples:');
    console.log('  claude-flow config-integration setup --enable-ruv-swarm');
    console.log('  claude-flow config-integration preset development');
    console.log('  claude-flow config-integration sync --force');
    console.log('  claude-flow config-integration export my-config.json');
    console.log('  claude-flow config-integration status --verbose');
}
async function handleSetup(ctx) {
    const enableRuvSwarm = ctx.flags.enableRuvSwarm || ctx.flags['enable-ruv-swarm'] || true;
    const force = ctx.flags.force || ctx.flags.f;
    info('Setting up ruv-swarm integration...');
    try {
        if (enableRuvSwarm) {
            configManager.setRuvSwarmConfig({
                enabled: true
            });
            await configManager.save();
            success('ruv-swarm enabled in main configuration');
        }
        const result = await initializeRuvSwarmIntegration();
        if (result.success) {
            success('ruv-swarm integration setup completed successfully!');
            console.log(`✅ ${result.message}`);
            const integration = getRuvSwarmIntegration();
            const status = integration.getStatus();
            console.log('\\n📋 Integration Status:');
            console.log(`  Enabled: ${status.enabled ? '✅' : '❌'}`);
            console.log(`  Synchronized: ${status.synchronized ? '✅' : '⚠️'}`);
            console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
            console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
            console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
        } else {
            error('ruv-swarm integration setup failed');
            console.log(`❌ ${result.message}`);
            if (force) {
                warning('Continuing despite errors due to --force flag');
            }
        }
    } catch (err) {
        error(`Setup failed: ${err.message}`);
    }
}
async function handleSync(ctx) {
    const force = ctx.flags.force || ctx.flags.f;
    info('Synchronizing configurations...');
    try {
        const integration = getRuvSwarmIntegration();
        const statusBefore = integration.getStatus();
        if (statusBefore.synchronized && !force) {
            success('Configurations are already synchronized');
            return;
        }
        integration.syncConfiguration();
        const statusAfter = integration.getStatus();
        if (statusAfter.synchronized) {
            success('Configuration synchronization completed');
            console.log('✅ Main config and ruv-swarm config are now synchronized');
        } else {
            warning('Synchronization completed but configurations may still differ');
            console.log('⚠️  Manual review recommended');
        }
    } catch (err) {
        error(`Synchronization failed: ${err.message}`);
    }
}
async function handleStatus(ctx) {
    const verbose = ctx.flags.verbose || ctx.flags.v;
    const json = ctx.flags.json;
    try {
        const integration = getRuvSwarmIntegration();
        const status = integration.getStatus();
        if (json) {
            console.log(JSON.stringify(status, null, 2));
            return;
        }
        console.log('🔧 Configuration Integration Status\\n');
        console.log('📊 Overview:');
        console.log(`  ruv-swarm Enabled: ${status.enabled ? '✅ Yes' : '❌ No'}`);
        console.log(`  Configurations Synchronized: ${status.synchronized ? '✅ Yes' : '⚠️  No'}`);
        console.log('\\n⚙️  Main Configuration:');
        console.log(`  Default Topology: ${status.mainConfig.defaultTopology}`);
        console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
        console.log(`  Default Strategy: ${status.mainConfig.defaultStrategy}`);
        console.log(`  Auto Init: ${status.mainConfig.autoInit ? '✅' : '❌'}`);
        console.log(`  Hooks Enabled: ${status.mainConfig.enableHooks ? '✅' : '❌'}`);
        console.log(`  Persistence Enabled: ${status.mainConfig.enablePersistence ? '✅' : '❌'}`);
        console.log(`  Neural Training: ${status.mainConfig.enableNeuralTraining ? '✅' : '❌'}`);
        if (verbose) {
            console.log('\\n🧠 ruv-swarm Configuration:');
            console.log(`  Swarm Max Agents: ${status.ruvSwarmConfig.swarm.maxAgents}`);
            console.log(`  Memory Persistence: ${status.ruvSwarmConfig.memory.enablePersistence ? '✅' : '❌'}`);
            console.log(`  Neural Training: ${status.ruvSwarmConfig.neural.enableTraining ? '✅' : '❌'}`);
            console.log(`  MCP Tools: ${status.ruvSwarmConfig.integration.enableMCPTools ? '✅' : '❌'}`);
            console.log(`  CLI Commands: ${status.ruvSwarmConfig.integration.enableCLICommands ? '✅' : '❌'}`);
            console.log('\\n📈 Monitoring:');
            console.log(`  Metrics Enabled: ${status.ruvSwarmConfig.monitoring.enableMetrics ? '✅' : '❌'}`);
            console.log(`  Alerts Enabled: ${status.ruvSwarmConfig.monitoring.enableAlerts ? '✅' : '❌'}`);
            console.log(`  CPU Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.cpu}%`);
            console.log(`  Memory Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.memory}%`);
        }
    } catch (err) {
        error(`Failed to get status: ${err.message}`);
    }
}
async function handleValidate(ctx) {
    const fix = ctx.flags.fix || ctx.flags.f;
    info('Validating configurations...');
    try {
        const integration = getRuvSwarmIntegration();
        console.log('🔍 Validating main configuration...');
        try {
            const mainConfig = configManager.show();
            configManager.validate(mainConfig);
            success('Main configuration is valid');
        } catch (err) {
            error(`Main configuration validation failed: ${err.message}`);
            if (fix) {
                warning('Auto-fix for main configuration not implemented');
            }
            return;
        }
        console.log('🔍 Validating ruv-swarm configuration...');
        const ruvSwarmManager = integration['ruvSwarmManager'];
        const ruvSwarmValidation = ruvSwarmManager.validateConfig();
        if (ruvSwarmValidation.valid) {
            success('ruv-swarm configuration is valid');
        } else {
            error('ruv-swarm configuration validation failed:');
            ruvSwarmValidation.errors.forEach((err)=>console.log(`  - ${err}`));
            if (fix) {
                warning('Auto-fix for ruv-swarm configuration not implemented');
            }
            return;
        }
        console.log('🔍 Checking synchronization...');
        const status = integration.getStatus();
        if (status.synchronized) {
            success('Configurations are synchronized');
        } else {
            warning('Configurations are not synchronized');
            if (fix) {
                info('Attempting to synchronize...');
                integration.syncConfiguration();
                success('Synchronization completed');
            }
        }
        success('All validations passed');
    } catch (err) {
        error(`Validation failed: ${err.message}`);
    }
}
async function handlePreset(ctx) {
    if (ctx.args.length < 2) {
        error('Preset type is required');
        console.log('Available presets: development, research, production');
        return;
    }
    const presetType = ctx.args[1];
    const dryRun = ctx.flags.dryRun || ctx.flags['dry-run'];
    if (![
        'development',
        'research',
        'production'
    ].includes(presetType)) {
        error('Invalid preset type');
        console.log('Available presets: development, research, production');
        return;
    }
    try {
        if (dryRun) {
            info(`Showing ${presetType} preset configuration (dry run):`);
            const config = RuvSwarmConfigHelpers.getConfigForUseCase(presetType);
            console.log(JSON.stringify(config, null, 2));
            return;
        }
        info(`Applying ${presetType} preset...`);
        switch(presetType){
            case 'development':
                RuvSwarmConfigHelpers.setupDevelopmentConfig();
                break;
            case 'research':
                RuvSwarmConfigHelpers.setupResearchConfig();
                break;
            case 'production':
                RuvSwarmConfigHelpers.setupProductionConfig();
                break;
        }
        await configManager.save();
        success(`${presetType} preset applied successfully`);
        const integration = getRuvSwarmIntegration();
        const status = integration.getStatus();
        console.log('\\n📋 Applied Configuration:');
        console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
        console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
        console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
        console.log(`  Features: ${Object.entries(status.mainConfig).filter(([key, value])=>key.startsWith('enable') && value).map(([key])=>key.replace('enable', '').toLowerCase()).join(', ')}`);
    } catch (err) {
        error(`Failed to apply preset: ${err.message}`);
    }
}
async function handleExport(ctx) {
    if (ctx.args.length < 2) {
        error('Export file path is required');
        console.log('Usage: config-integration export <file>');
        return;
    }
    const filePath = ctx.args[1];
    const format = ctx.flags.format || 'json';
    try {
        const integration = getRuvSwarmIntegration();
        const status = integration.getStatus();
        const exportData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            main: status.mainConfig,
            ruvSwarm: status.ruvSwarmConfig,
            unified: integration.getUnifiedCommandArgs()
        };
        const { writeFile } = await import('fs/promises');
        if (format === 'yaml') {
            const yamlContent = `# Claude-Flow Configuration Export
# Generated: ${exportData.timestamp}

main:
${JSON.stringify(exportData.main, null, 2).split('\\n').map((line)=>'  ' + line).join('\\n')}

ruvSwarm:
${JSON.stringify(exportData.ruvSwarm, null, 2).split('\\n').map((line)=>'  ' + line).join('\\n')}

unified:
${JSON.stringify(exportData.unified, null, 2).split('\\n').map((line)=>'  ' + line).join('\\n')}
`;
            await writeFile(filePath, yamlContent, 'utf8');
        } else {
            await writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8');
        }
        success(`Configuration exported to: ${filePath}`);
        console.log(`📄 Format: ${format}`);
        console.log(`📊 Size: ${JSON.stringify(exportData).length} bytes`);
    } catch (err) {
        error(`Export failed: ${err.message}`);
    }
}
async function handleImport(ctx) {
    if (ctx.args.length < 2) {
        error('Import file path is required');
        console.log('Usage: config-integration import <file>');
        return;
    }
    const filePath = ctx.args[1];
    const dryRun = ctx.flags.dryRun || ctx.flags['dry-run'];
    const force = ctx.flags.force || ctx.flags.f;
    try {
        const { readFile } = await import('fs/promises');
        const content = await readFile(filePath, 'utf8');
        let importData;
        try {
            importData = JSON.parse(content);
        } catch  {
            error('Invalid JSON format in import file');
            return;
        }
        if (!importData.main || !importData.ruvSwarm) {
            error('Import file does not contain required configuration sections');
            return;
        }
        if (dryRun) {
            info('Import preview (dry run):');
            console.log('\\n📋 Main Configuration Changes:');
            console.log(JSON.stringify(importData.main, null, 2));
            console.log('\\n🧠 ruv-swarm Configuration Changes:');
            console.log(JSON.stringify(importData.ruvSwarm, null, 2));
            return;
        }
        if (!force) {
            warning('This will overwrite current configuration');
            console.log('Use --force to proceed or --dry-run to preview changes');
            return;
        }
        info('Importing configuration...');
        const integration = getRuvSwarmIntegration();
        integration.updateConfiguration({
            main: importData.main,
            ruvSwarm: importData.ruvSwarm
        });
        await configManager.save();
        success('Configuration imported successfully');
        console.log(`📄 Source: ${filePath}`);
        console.log(`📅 Imported: ${importData.timestamp || 'Unknown timestamp'}`);
    } catch (err) {
        error(`Import failed: ${err.message}`);
    }
}
export default {
    configIntegrationAction
};

//# sourceMappingURL=config-integration.js.map