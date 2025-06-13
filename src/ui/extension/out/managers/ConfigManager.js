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
exports.ConfigManager = void 0;
const vscode = __importStar(require("vscode"));
class ConfigManager {
    constructor(context) {
        this.context = context;
        this.configuration = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
    }
    async initialize() {
        // Watch for configuration changes
        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(ConfigManager.CONFIG_KEY)) {
                this.configuration = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
            }
        }));
        // Validate API key on startup
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            const result = await vscode.window.showInformationMessage('Claude Flow requires an Anthropic API key to function.', 'Set API Key');
            if (result === 'Set API Key') {
                await vscode.commands.executeCommand('claude-flow.setApiKey');
            }
        }
    }
    async getApiKey() {
        // First try to get from secrets storage
        let apiKey = await this.context.secrets.get('claude-flow.apiKey');
        // Fall back to configuration (less secure)
        if (!apiKey) {
            apiKey = this.configuration.get('apiKey');
        }
        return apiKey || '';
    }
    async setApiKey(key) {
        // Store in secure storage
        await this.context.secrets.store('claude-flow.apiKey', key);
        // Remove from configuration if it was there
        if (this.configuration.get('apiKey')) {
            await this.configuration.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
        }
    }
    getModel() {
        return this.configuration.get('model', 'claude-3-opus-20240229');
    }
    async setModel(model) {
        await this.configuration.update('model', model, vscode.ConfigurationTarget.Global);
    }
    getMaxTokens() {
        return this.configuration.get('maxTokens', 100000);
    }
    async setMaxTokens(tokens) {
        await this.configuration.update('maxTokens', tokens, vscode.ConfigurationTarget.Global);
    }
    getPermissionLevel() {
        const level = this.configuration.get('permissionLevel', 'normal');
        return level;
    }
    async setPermissionLevel(level) {
        await this.configuration.update('permissionLevel', level, vscode.ConfigurationTarget.Global);
    }
    get(key, defaultValue) {
        return this.configuration.get(key, defaultValue);
    }
    async set(key, value) {
        await this.configuration.update(key, value, vscode.ConfigurationTarget.Global);
    }
    dispose() {
        // No cleanup needed
    }
}
exports.ConfigManager = ConfigManager;
ConfigManager.CONFIG_KEY = 'claude-flow';
//# sourceMappingURL=ConfigManager.js.map