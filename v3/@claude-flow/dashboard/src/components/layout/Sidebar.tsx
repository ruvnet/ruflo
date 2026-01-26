/**
 * Sidebar Component
 * Navigation sidebar with view selection and keyboard shortcuts
 */

import React from 'react';
import type { DashboardView } from '../../store/dashboardStore';

interface NavItem {
  view: DashboardView;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

interface SidebarProps {
  currentView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const navItems: NavItem[] = [
  {
    view: 'overview',
    label: 'Overview',
    shortcut: '1',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    ),
  },
  {
    view: 'agents',
    label: 'Agents',
    shortcut: '2',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    view: 'tasks',
    label: 'Tasks',
    shortcut: '3',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
  {
    view: 'messages',
    label: 'Messages',
    shortcut: '4',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    ),
  },
  {
    view: 'memory',
    label: 'Memory',
    shortcut: '5',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
        />
      </svg>
    ),
  },
  {
    view: 'topology',
    label: 'Topology',
    shortcut: '6',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
    ),
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onViewChange,
  isCollapsed,
  onToggleCollapse,
}) => {
  return (
    <aside
      className={`
        flex flex-col bg-slate-900 border-r border-slate-700
        transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
      aria-label="Main navigation"
    >
      {/* Collapse toggle */}
      <div className="flex items-center justify-end p-2 border-b border-slate-700">
        <button
          onClick={onToggleCollapse}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className={`w-5 h-5 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2" role="menubar">
          {navItems.map((item) => {
            const isActive = currentView === item.view;
            return (
              <li key={item.view} role="none">
                <button
                  onClick={() => onViewChange(item.view)}
                  role="menuitem"
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                    transition-colors duration-150
                    ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                  aria-current={isActive ? 'page' : undefined}
                  title={isCollapsed ? `${item.label} (${item.shortcut})` : undefined}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left font-medium">{item.label}</span>
                      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-slate-700/50 rounded text-slate-400">
                        {item.shortcut}
                      </kbd>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Keyboard shortcuts hint */}
      {!isCollapsed && (
        <div className="p-4 border-t border-slate-700">
          <p className="text-xs text-slate-500">
            Press <kbd className="px-1 py-0.5 bg-slate-800 rounded text-slate-400">1</kbd>-
            <kbd className="px-1 py-0.5 bg-slate-800 rounded text-slate-400">6</kbd> to switch views
          </p>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
