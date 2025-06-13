import React from 'react';
import { ChatTab } from '../types';

interface TabBarProps {
    tabs: ChatTab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onNewTab: () => void;
    onCloseTab: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
    tabs,
    activeTabId,
    onTabClick,
    onNewTab,
    onCloseTab
}) => {
    return (
        <div className="tabs-container">
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
                    onClick={() => onTabClick(tab.id)}
                >
                    <span>{tab.title}</span>
                    {tabs.length > 1 && (
                        <span
                            className="tab-close"
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id);
                            }}
                        >
                            ×
                        </span>
                    )}
                </button>
            ))}
            <button className="new-tab-button" onClick={onNewTab}>
                +
            </button>
        </div>
    );
};