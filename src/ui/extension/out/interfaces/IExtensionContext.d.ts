import * as vscode from 'vscode';
import { IChatManager } from './IChatManager';
import { IOrchestratorManager } from './IOrchestratorManager';
import { IToolManager } from './IToolManager';
import { IMemoryManager } from './IMemoryManager';
import { IConfigManager } from './IConfigManager';
export interface IExtensionContext {
    vscodeContext: vscode.ExtensionContext;
    configManager: IConfigManager;
    orchestratorManager: IOrchestratorManager;
    memoryManager: IMemoryManager;
    toolManager: IToolManager;
    chatManager: IChatManager;
}
//# sourceMappingURL=IExtensionContext.d.ts.map