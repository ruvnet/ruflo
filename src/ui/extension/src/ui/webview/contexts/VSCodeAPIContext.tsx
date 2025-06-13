import React, { createContext, useContext, useEffect, useState } from 'react';

interface VSCodeAPI {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
}

interface VSCodeAPIContextType {
    vscode: VSCodeAPI;
    sendMessage: (type: string, payload?: any) => void;
    onMessage: (handler: (message: any) => void) => () => void;
}

const VSCodeAPIContext = createContext<VSCodeAPIContextType | null>(null);

// Acquire VS Code API
function getVSCodeAPI(): VSCodeAPI {
    // @ts-ignore
    return acquireVsCodeApi();
}

export const VSCodeAPIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [vscode] = useState<VSCodeAPI>(getVSCodeAPI);
    const [messageHandlers, setMessageHandlers] = useState<((message: any) => void)[]>([]);

    useEffect(() => {
        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            messageHandlers.forEach(handler => handler(message));
        };

        window.addEventListener('message', handleMessage);

        // Send ready message
        vscode.postMessage({ type: 'ready' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [messageHandlers, vscode]);

    const sendMessage = (type: string, payload?: any) => {
        vscode.postMessage({ type, payload });
    };

    const onMessage = (handler: (message: any) => void) => {
        setMessageHandlers(prev => [...prev, handler]);
        
        // Return unsubscribe function
        return () => {
            setMessageHandlers(prev => prev.filter(h => h !== handler));
        };
    };

    return (
        <VSCodeAPIContext.Provider value={{ vscode, sendMessage, onMessage }}>
            {children}
        </VSCodeAPIContext.Provider>
    );
};

export const useVSCodeAPI = () => {
    const context = useContext(VSCodeAPIContext);
    if (!context) {
        throw new Error('useVSCodeAPI must be used within VSCodeAPIProvider');
    }
    return context;
};