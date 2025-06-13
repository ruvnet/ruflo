import React from 'react';
import { AgentStatus } from '../types';

interface AgentVisualizerProps {
    agents: AgentStatus[];
}

export const AgentVisualizer: React.FC<AgentVisualizerProps> = ({ agents }) => {
    const getStatusClass = (state: string) => {
        switch (state) {
            case 'active':
                return 'active';
            case 'idle':
                return 'idle';
            case 'error':
                return 'error';
            default:
                return 'idle';
        }
    };

    const getAgentIcon = (role: string) => {
        switch (role) {
            case 'coordinator':
                return '👩‍💼';
            case 'implementer':
                return '👩‍💻';
            case 'tester':
                return '🧪';
            case 'reflector':
                return '🤔';
            case 'analyst':
                return '📊';
            case 'assistant':
                return '🤖';
            default:
                return '🤖';
        }
    };

    if (agents.length === 0) {
        return (
            <div className="agent-status">
                <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5 }}>
                    No active agents
                </div>
            </div>
        );
    }

    return (
        <div className="agent-status">
            {agents.map((agent) => (
                <div key={agent.id} className="agent-item">
                    <div className={`agent-indicator ${getStatusClass(agent.state)}`} />
                    <span style={{ marginRight: '8px' }}>{getAgentIcon(agent.role)}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{agent.role}</div>
                        {agent.currentTask && (
                            <div style={{ fontSize: '11px', opacity: 0.7 }}>
                                {agent.currentTask}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '11px', opacity: 0.7 }}>
                        {agent.completedTasks} tasks
                    </div>
                </div>
            ))}
        </div>
    );
};