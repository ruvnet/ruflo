import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { OperationMode } from '../types';

interface InputBoxProps {
    onSend: (message: string) => void;
    disabled: boolean;
    mode: OperationMode;
}

export const InputBox: React.FC<InputBoxProps> = ({ onSend, disabled, mode }) => {
    const [input, setInput] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        adjustHeight();
    }, [input]);

    const adjustHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        }
    };

    const handleSend = () => {
        if (input.trim() && !disabled) {
            onSend(input.trim());
            setInput('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
            e.preventDefault();
            handleSend();
        }
    };

    const getModeIcon = () => {
        switch (mode) {
            case 'chat':
                return '💬';
            case 'pair-programming':
                return '👥';
            case 'code-review':
                return '🔍';
            case 'plan-reflect':
                return '🎯';
            default:
                return '💬';
        }
    };

    return (
        <div className="input-area">
            <div className="input-container">
                <div className="input-wrapper">
                    <div className="input-actions">
                        <button className="input-action" title="Attach file">
                            📎
                        </button>
                        <button className="input-action" title="Voice input">
                            🎤
                        </button>
                        <button className="input-action" title="Settings">
                            ⚙️
                        </button>
                        <span style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.7 }}>
                            {getModeIcon()} {mode}
                        </span>
                    </div>
                    <textarea
                        ref={textareaRef}
                        className="input-field"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={() => setIsComposing(false)}
                        placeholder="Ask Claude anything..."
                        disabled={disabled}
                        rows={1}
                    />
                </div>
                <button
                    className="send-button"
                    onClick={handleSend}
                    disabled={disabled || !input.trim()}
                >
                    {disabled ? (
                        <>
                            <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
                            <span>Thinking...</span>
                        </>
                    ) : (
                        <>Send</>
                    )}
                </button>
            </div>
        </div>
    );
};