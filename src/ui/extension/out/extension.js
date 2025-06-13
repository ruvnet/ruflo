"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
exports.getExtensionContext = getExtensionContext;
const vscode = __importStar(require("vscode"));
const ChatManager_1 = require("./managers/ChatManager");
const OrchestratorManager_1 = require("./managers/OrchestratorManager");
const ToolManager_1 = require("./managers/ToolManager");
const MemoryManager_1 = require("./managers/MemoryManager");
const ConfigManager_1 = require("./managers/ConfigManager");
const registerCommands_1 = require("./commands/registerCommands");
let extensionContext;
async function activate(context) {
    console.log('Claude Flow extension is activating...');
    try {
        // Initialize configuration manager
        const configManager = new ConfigManager_1.ConfigManager(context);
        await configManager.initialize();
        // Initialize core managers
        const orchestratorManager = new OrchestratorManager_1.OrchestratorManager(configManager);
        const memoryManager = new MemoryManager_1.MemoryManager(context.globalStorageUri);
        const toolManager = new ToolManager_1.ToolManager(context);
        const chatManager = new ChatManager_1.ChatManager(orchestratorManager, memoryManager);
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
        (0, registerCommands_1.registerCommands)(context, extensionContext);
        // Initialize tool adapters
        await toolManager.registerDefaultTools();
        // Create status bar item
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = '$(comment-discussion) Claude Flow';
        statusBarItem.command = 'claude-flow.openChat';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
        console.log('Claude Flow extension activated successfully');
    }
    catch (error) {
        console.error('Failed to activate Claude Flow extension:', error);
        vscode.window.showErrorMessage(`Failed to activate Claude Flow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function deactivate() {
    // Cleanup resources
    if (extensionContext) {
        extensionContext.orchestratorManager.dispose();
        extensionContext.memoryManager.dispose();
        extensionContext.toolManager.dispose();
        extensionContext.chatManager.dispose();
    }
    console.log('Claude Flow extension deactivated');
}
function getExtensionContext() {
    if (!extensionContext) {
        throw new Error('Extension not activated');
    }
    return extensionContext;
}
//# sourceMappingURL=extension.js.map