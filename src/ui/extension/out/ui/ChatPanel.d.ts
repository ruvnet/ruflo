import { IExtensionContext } from '../interfaces/IExtensionContext';
export declare class ChatPanel {
    private readonly extensionContext;
    private static currentPanel;
    private readonly panel;
    private disposables;
    private constructor();
    static createOrShow(extensionContext: IExtensionContext): ChatPanel;
    private setupWebview;
    private setupEventListeners;
    private handleWebviewMessage;
    private handleUserMessage;
    private handleModeChange;
    private handleApplyCode;
    private handleStopExecution;
    private handleWebviewReady;
    private sendToWebview;
    private getWebviewContent;
    private getNonce;
    dispose(): void;
}
//# sourceMappingURL=ChatPanel.d.ts.map