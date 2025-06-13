import React, { useState, useEffect, useRef } from 'react';
import { useVSCodeAPI } from '../contexts/VSCodeAPIContext';
import { TabBar } from './TabBar';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { ModeSelector } from './ModeSelector';
import { Message, ChatTab, OperationMode, AgentStatus, Task } from '../types';

export const ChatInterface: React.FC = () => {
    const { sendMessage, onMessage } = useVSCodeAPI();
    
    // State
    const [tabs, setTabs] = useState<ChatTab[]>([
        { id: '1', title: 'Chat 1', active: true, messages: [] }
    ]);
    const [activeTabId, setActiveTabId] = useState('1');
    const [mode, setMode] = useState<OperationMode>('chat');
    const [agents, setAgents] = useState<AgentStatus[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Get active tab
    const activeTab = tabs.find(tab => tab.id === activeTabId);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeTab?.messages]);

    // Handle messages from extension
    useEffect(() => {
        const unsubscribe = onMessage((message) => {
            switch (message.type) {
                case 'initialize':
                    handleInitialize(message.payload);
                    break;
                case 'user-message':
                    addMessage(message.payload);
                    break;
                case 'assistant-message-start':
                    addMessage({ ...message.payload, streaming: true });
                    setIsStreaming(true);
                    break;
                case 'stream-chunk':
                    handleStreamChunk(message.payload);
                    break;
                case 'assistant-message-complete':
                    completeStreaming(message.payload);
                    break;
                case 'agent-update':
                    setAgents(message.payload);
                    break;
                case 'task-update':
                    setTasks(message.payload);
                    break;
                case 'mode-changed':
                    setMode(message.payload);
                    break;
                case 'error':
                    handleError(message.payload);
                    break;
            }
        });

        return unsubscribe;
    }, [tabs, activeTabId]);

    const handleInitialize = (payload: any) => {
        if (payload.messages && payload.messages.length > 0) {
            setTabs(prev => prev.map(tab => 
                tab.id === activeTabId 
                    ? { ...tab, messages: payload.messages }
                    : tab
            ));
        }
        if (payload.mode) {
            setMode(payload.mode);
        }
        if (payload.agents) {
            setAgents(payload.agents);
        }
    };

    const addMessage = (message: Message) => {
        setTabs(prev => prev.map(tab => 
            tab.id === activeTabId 
                ? { ...tab, messages: [...tab.messages, message] }
                : tab
        ));
    };

    const handleStreamChunk = (chunk: string) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            
            const messages = [...tab.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.streaming) {
                lastMessage.content += chunk;
            }
            
            return { ...tab, messages };
        }));
    };

    const completeStreaming = (message: Message) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            
            const messages = [...tab.messages];
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.streaming) {
                lastMessage.streaming = false;
            }
            
            return { ...tab, messages };
        }));
        setIsStreaming(false);
    };

    const handleError = (error: string) => {
        addMessage({
            id: Date.now().toString(),
            role: 'system',
            content: `Error: ${error}`,
            timestamp: Date.now()
        });
    };

    const handleSendMessage = (content: string) => {
        sendMessage('user-message', { content, mode });
    };

    const handleModeChange = (newMode: OperationMode) => {
        setMode(newMode);
        sendMessage('mode-change', { mode: newMode });
    };

    const handleNewTab = () => {
        const newTab: ChatTab = {
            id: Date.now().toString(),
            title: `Chat ${tabs.length + 1}`,
            active: false,
            messages: []
        };
        setTabs([...tabs, newTab]);
        setActiveTabId(newTab.id);
    };

    const handleCloseTab = (tabId: string) => {
        if (tabs.length === 1) return; // Keep at least one tab
        
        const newTabs = tabs.filter(tab => tab.id !== tabId);
        setTabs(newTabs);
        
        if (activeTabId === tabId) {
            setActiveTabId(newTabs[0].id);
        }
    };

    const handleTabClick = (tabId: string) => {
        setActiveTabId(tabId);
    };

    return (
        <div className="app-container">
            <div className="header">
                <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onTabClick={handleTabClick}
                    onNewTab={handleNewTab}
                    onCloseTab={handleCloseTab}
                />
                <ModeSelector
                    mode={mode}
                    onChange={handleModeChange}
                />
            </div>
            
            <div className="content-area">
                <Sidebar
                    agents={agents}
                    tasks={tasks}
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
                
                <div className="chat-container">
                    <MessageList
                        messages={activeTab?.messages || []}
                        isStreaming={isStreaming}
                    />
                    <div ref={messagesEndRef} />
                    <InputBox
                        onSend={handleSendMessage}
                        disabled={isStreaming}
                        mode={mode}
                    />
                </div>
            </div>
        </div>
    );
};