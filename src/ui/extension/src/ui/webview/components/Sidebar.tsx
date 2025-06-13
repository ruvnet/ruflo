import React, { useState } from 'react';
import { AgentStatus, Task } from '../types';
import { AgentVisualizer } from './AgentVisualizer';
import { TaskProgress } from './TaskProgress';

interface SidebarProps {
    agents: AgentStatus[];
    tasks: Task[];
    collapsed: boolean;
    onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    agents,
    tasks,
    collapsed,
    onToggle
}) => {
    const [activeSection, setActiveSection] = useState<'agents' | 'tasks'>('agents');

    if (collapsed) {
        return (
            <div className="sidebar collapsed">
                <button onClick={onToggle} style={{ position: 'absolute', right: -20, top: 10 }}>
                    →
                </button>
            </div>
        );
    }

    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Claude Flow</span>
                    <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        ←
                    </button>
                </div>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                <button
                    className={`tab ${activeSection === 'agents' ? 'active' : ''}`}
                    onClick={() => setActiveSection('agents')}
                    style={{ flex: 1 }}
                >
                    Agents ({agents.length})
                </button>
                <button
                    className={`tab ${activeSection === 'tasks' ? 'active' : ''}`}
                    onClick={() => setActiveSection('tasks')}
                    style={{ flex: 1 }}
                >
                    Tasks ({tasks.length})
                </button>
            </div>
            
            <div className="sidebar-content">
                {activeSection === 'agents' ? (
                    <AgentVisualizer agents={agents} />
                ) : (
                    <TaskProgress tasks={tasks} />
                )}
            </div>
        </div>
    );
};