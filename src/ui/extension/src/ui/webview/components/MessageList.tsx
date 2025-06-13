import React from 'react';
import { Message } from '../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
    messages: Message[];
    isStreaming: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isStreaming }) => {
    return (
        <div className="messages-area">
            {messages.map((message, index) => (
                <MessageItem
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming && index === messages.length - 1}
                />
            ))}
        </div>
    );
};