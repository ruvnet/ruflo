import * as vscode from 'vscode';
import { IConfigManager } from '../interfaces/IConfigManager';
import { PermissionLevel } from '../types/Permission';

export class ConfigManager implements IConfigManager {
    private static readonly CONFIG_KEY = 'claude-flow';
    private configuration: vscode.WorkspaceConfiguration;

    constructor(private context: vscode.ExtensionContext) {
        this.configuration = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
    }

    async initialize(): Promise<void> {
        // Watch for configuration changes
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(ConfigManager.CONFIG_KEY)) {
                    this.configuration = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
                }
            })
        );

        // Validate API key on startup
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            const result = await vscode.window.showInformationMessage(
                'Claude Flow requires an Anthropic API key to function.',
                'Set API Key'
            );
            
            if (result === 'Set API Key') {
                await vscode.commands.executeCommand('claude-flow.setApiKey');
            }
        }
    }

    async getApiKey(): Promise<string> {
        // First try to get from secrets storage
        let apiKey = await this.context.secrets.get('claude-flow.apiKey');
        
        // Fall back to configuration (less secure)
        if (!apiKey) {
            apiKey = this.configuration.get<string>('apiKey');
        }
        
        return apiKey || '';
    }

    async setApiKey(key: string): Promise<void> {
        // Store in secure storage
        await this.context.secrets.store('claude-flow.apiKey', key);
        
        // Remove from configuration if it was there
        if (this.configuration.get<string>('apiKey')) {
            await this.configuration.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
        }
    }

    getModel(): string {
        return this.configuration.get<string>('model', 'claude-3-opus-20240229');
    }

    async setModel(model: string): Promise<void> {
        await this.configuration.update('model', model, vscode.ConfigurationTarget.Global);
    }

    getMaxTokens(): number {
        return this.configuration.get<number>('maxTokens', 100000);
    }

    async setMaxTokens(tokens: number): Promise<void> {
        await this.configuration.update('maxTokens', tokens, vscode.ConfigurationTarget.Global);
    }

    getPermissionLevel(): PermissionLevel {
        const level = this.configuration.get<string>('permissionLevel', 'normal');
        return level as PermissionLevel;
    }

    async setPermissionLevel(level: PermissionLevel): Promise<void> {
        await this.configuration.update('permissionLevel', level, vscode.ConfigurationTarget.Global);
    }

    get<T>(key: string, defaultValue?: T): T {
        return this.configuration.get<T>(key, defaultValue as T);
    }

    async set(key: string, value: any): Promise<void> {
        await this.configuration.update(key, value, vscode.ConfigurationTarget.Global);
    }

    dispose(): void {
        // No cleanup needed
    }
}