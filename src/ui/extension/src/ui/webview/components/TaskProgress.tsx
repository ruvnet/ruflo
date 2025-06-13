import React from 'react';
import { Task } from '../types';

interface TaskProgressProps {
    tasks: Task[];
}

export const TaskProgress: React.FC<TaskProgressProps> = ({ tasks }) => {
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed':
                return '✅';
            case 'in-progress':
                return '🔄';
            case 'failed':
                return '❌';
            case 'pending':
            default:
                return '⏳';
        }
    };

    const getStatusClass = (status: string) => {
        switch (status) {
            case 'completed':
                return 'completed';
            case 'in-progress':
                return 'in-progress';
            case 'failed':
                return 'failed';
            case 'pending':
            default:
                return 'pending';
        }
    };

    if (tasks.length === 0) {
        return (
            <div className="task-list">
                <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5 }}>
                    No tasks yet
                </div>
            </div>
        );
    }

    return (
        <div className="task-list">
            {tasks.map((task) => (
                <div key={task.id} className="task-item">
                    <span className={`task-status ${getStatusClass(task.status)}`}>
                        {getStatusIcon(task.status)}
                    </span>
                    <div style={{ flex: 1 }}>
                        <div>{task.title}</div>
                        {task.description && (
                            <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>
                                {task.description}
                            </div>
                        )}
                    </div>
                    {task.assignedAgent && (
                        <div style={{ fontSize: '11px', opacity: 0.7 }}>
                            {task.assignedAgent}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};