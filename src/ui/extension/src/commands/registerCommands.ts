import * as vscode from 'vscode';
import { IExtensionContext } from '../interfaces/IExtensionContext';
import { ChatPanel } from '../ui/ChatPanel';
import { OperationMode } from '../types/OperationMode';

export function registerCommands(
    context: vscode.ExtensionContext,
    extensionContext: IExtensionContext
): void {
    // Open Chat command
    const openChatCommand = vscode.commands.registerCommand(
        'claude-flow.openChat',
        () => {
            ChatPanel.createOrShow(extensionContext);
        }
    );
    context.subscriptions.push(openChatCommand);

    // Ask Claude command (with selected text)
    const askClaudeCommand = vscode.commands.registerCommand(
        'claude-flow.askClaude',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);

            if (!selectedText) {
                vscode.window.showInformationMessage('Please select some code to ask about');
                return;
            }

            // Open chat panel
            const chatPanel = ChatPanel.createOrShow(extensionContext);

            // Create a session if needed
            if (!extensionContext.chatManager.getActiveSession()) {
                extensionContext.chatManager.createSession();
            }

            // Send the selected text with context
            const language = editor.document.languageId;
            const fileName = editor.document.fileName;
            const prompt = `Please help me understand this ${language} code from ${fileName}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``;

            await extensionContext.chatManager.sendMessage(prompt, OperationMode.Chat);
        }
    );
    context.subscriptions.push(askClaudeCommand);

    // Switch Mode command
    const switchModeCommand = vscode.commands.registerCommand(
        'claude-flow.switchMode',
        async () => {
            const modes = [
                { label: 'Chat', value: OperationMode.Chat, description: 'Simple Q&A interactions' },
                { label: 'Pair Programming', value: OperationMode.PairProgramming, description: 'Context-aware coding assistance' },
                { label: 'Code Review', value: OperationMode.CodeReview, description: 'Analyze code for improvements' },
                { label: 'Plan & Reflect', value: OperationMode.PlanReflect, description: 'Autonomous multi-step task execution' }
            ];

            const selected = await vscode.window.showQuickPick(modes, {
                placeHolder: 'Select an operation mode',
                title: 'Claude Flow Mode'
            });

            if (selected) {
                try {
                    await extensionContext.orchestratorManager.switchMode(selected.value);
                    vscode.window.showInformationMessage(`Switched to ${selected.label} mode`);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to switch mode: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }
    );
    context.subscriptions.push(switchModeCommand);

    // Stop Execution command
    const stopExecutionCommand = vscode.commands.registerCommand(
        'claude-flow.stopExecution',
        async () => {
            try {
                await extensionContext.orchestratorManager.stopExecution();
                vscode.window.showInformationMessage('Execution stopped');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to stop execution: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }
    );
    context.subscriptions.push(stopExecutionCommand);

    // Code Review command (review current file)
    const codeReviewCommand = vscode.commands.registerCommand(
        'claude-flow.reviewCode',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const document = editor.document;
            const code = document.getText();
            const language = document.languageId;
            const fileName = document.fileName;

            // Open chat panel
            ChatPanel.createOrShow(extensionContext);

            // Create a session if needed
            if (!extensionContext.chatManager.getActiveSession()) {
                extensionContext.chatManager.createSession();
            }

            // Switch to code review mode
            await extensionContext.orchestratorManager.switchMode(OperationMode.CodeReview);

            // Send the code for review
            const prompt = `Please review this ${language} code from ${fileName} and suggest improvements:\n\n\`\`\`${language}\n${code}\n\`\`\``;
            await extensionContext.chatManager.sendMessage(prompt, OperationMode.CodeReview);
        }
    );
    context.subscriptions.push(codeReviewCommand);

    // Set API Key command
    const setApiKeyCommand = vscode.commands.registerCommand(
        'claude-flow.setApiKey',
        async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Anthropic Claude API Key',
                password: true,
                placeHolder: 'sk-ant-...'
            });

            if (apiKey) {
                try {
                    await extensionContext.configManager.setApiKey(apiKey);
                    vscode.window.showInformationMessage('API key saved successfully');
                    
                    // Reinitialize orchestrator with new key
                    await extensionContext.orchestratorManager.initialize({
                        apiKey,
                        model: extensionContext.configManager.getModel(),
                        maxTokens: extensionContext.configManager.getMaxTokens(),
                        memoryPath: extensionContext.memoryManager.getStoragePath()
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}`
                    );
                }
            }
        }
    );
    context.subscriptions.push(setApiKeyCommand);

    // Clear Chat History command
    const clearChatCommand = vscode.commands.registerCommand(
        'claude-flow.clearChat',
        async () => {
            const activeSession = extensionContext.chatManager.getActiveSession();
            if (!activeSession) {
                vscode.window.showInformationMessage('No active chat session');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to clear the chat history?',
                'Yes',
                'No'
            );

            if (confirm === 'Yes') {
                extensionContext.chatManager.clearSession(activeSession);
                vscode.window.showInformationMessage('Chat history cleared');
            }
        }
    );
    context.subscriptions.push(clearChatCommand);
}