import * as vscode from 'vscode';
import { ChatManager } from './managers/ChatManager';
import { OrchestratorManager } from './managers/OrchestratorManager';
import { ToolManager } from './managers/ToolManager';
import { MemoryManager } from './managers/MemoryManager';
import { ConfigManager } from './managers/ConfigManager';
import { ChatPanel } from './ui/ChatPanel';
import { registerCommands } from './commands/registerCommands';
import { IExtensionContext } from './interfaces/IExtensionContext';

let extensionContext: IExtensionContext;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Claude Flow extension is activating...');

    try {
        // Initialize configuration manager
        const configManager = new ConfigManager(context);
        await configManager.initialize();

        // Initialize core managers
        const orchestratorManager = new OrchestratorManager(configManager);
        const memoryManager = new MemoryManager(context.globalStorageUri);
        const toolManager = new ToolManager(context);
        const chatManager = new ChatManager(orchestratorManager, memoryManager);

        // Create extension context
        extensionContext = {
            vscodeContext: context,
            configManager,
            orchestratorManager,
            memoryManager,
            toolManager,
            chatManager
        };

        // Initialize orchestrator with configuration
        await orchestratorManager.initialize({
            apiKey: await configManager.getApiKey(),
            model: configManager.getModel(),
            maxTokens: configManager.getMaxTokens(),
            memoryPath: memoryManager.getStoragePath()
        });

        // Register VS Code commands
        registerCommands(context, extensionContext);

        // Initialize tool adapters
        await toolManager.registerDefaultTools();

        // Create status bar item
        const statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        statusBarItem.text = '$(comment-discussion) Claude Flow';
        statusBarItem.command = 'claude-flow.openChat';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        console.log('Claude Flow extension activated successfully');
    } catch (error) {
        console.error('Failed to activate Claude Flow extension:', error);
        vscode.window.showErrorMessage(
            `Failed to activate Claude Flow: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export function deactivate(): void {
    // Cleanup resources
    if (extensionContext) {
        extensionContext.orchestratorManager.dispose();
        extensionContext.memoryManager.dispose();
        extensionContext.toolManager.dispose();
        extensionContext.chatManager.dispose();
    }
    console.log('Claude Flow extension deactivated');
}

export function getExtensionContext(): IExtensionContext {
    if (!extensionContext) {
        throw new Error('Extension not activated');
    }
    return extensionContext;
}