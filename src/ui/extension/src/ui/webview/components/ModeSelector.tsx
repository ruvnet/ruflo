import React from 'react';
import { OperationMode } from '../types';

interface ModeSelectorProps {
    mode: OperationMode;
    onChange: (mode: OperationMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onChange }) => {
    const modes: { value: OperationMode; label: string; icon: string }[] = [
        { value: 'chat', label: 'Chat', icon: '💬' },
        { value: 'pair-programming', label: 'Pair Programming', icon: '👥' },
        { value: 'code-review', label: 'Code Review', icon: '🔍' },
        { value: 'plan-reflect', label: 'Plan & Reflect', icon: '🎯' }
    ];

    return (
        <div className="mode-selector">
            <span style={{ fontSize: '12px', opacity: 0.7 }}>Mode:</span>
            <select value={mode} onChange={(e) => onChange(e.target.value as OperationMode)}>
                {modes.map(m => (
                    <option key={m.value} value={m.value}>
                        {m.icon} {m.label}
                    </option>
                ))}
            </select>
        </div>
    );
};