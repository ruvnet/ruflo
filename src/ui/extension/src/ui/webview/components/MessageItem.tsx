import React from 'react';
import { Message } from '../types';
import { marked } from 'marked';
import hljs from 'highlight.js';

// Configure marked to use highlight.js
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    }
});

interface MessageItemProps {
    message: Message;
    isStreaming: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isStreaming }) => {
    const getAvatar = () => {
        switch (message.role) {
            case 'user':
                return 'U';
            case 'assistant':
                return 'C';
            case 'system':
                return 'S';
            default:
                return '?';
        }
    };

    const renderContent = () => {
        if (message.streaming && isStreaming) {
            return (
                <>
                    <div dangerouslySetInnerHTML={{ __html: marked(message.content) }} />
                    <div className="streaming-indicator">
                        <span className="streaming-dot"></span>
                        <span className="streaming-dot"></span>
                        <span className="streaming-dot"></span>
                    </div>
                </>
            );
        }

        return <div dangerouslySetInnerHTML={{ __html: marked(message.content) }} />;
    };

    const renderToolLog = () => {
        if (!message.toolLog) return null;

        return (
            <div className="tool-log">
                <div className="tool-log-header">
                    <span>🛠️ {message.toolLog.tool}</span>
                    <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
                        {message.toolLog.duration}ms
                    </span>
                </div>
                {message.toolLog.output && (
                    <div className="tool-log-content">
                        {message.toolLog.output}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`message ${message.role}`}>
            <div className="message-avatar">{getAvatar()}</div>
            <div className="message-content">
                {message.metadata?.agent && (
                    <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                        {message.metadata.agent}
                    </div>
                )}
                {renderContent()}
                {renderToolLog()}
            </div>
        </div>
    );
};