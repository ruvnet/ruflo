/**
 * Header Component
 * Dashboard header with title, connection status, and action buttons
 */

import React from 'react';
import { ConnectionStatus } from './ConnectionStatus';
import type { ConnectionStatus as ConnectionStatusType } from '../../store/dashboardStore';

interface HeaderProps {
  connectionStatus: ConnectionStatusType;
  reconnectAttempts: number;
  onReconnect: () => void;
  onSettingsClick: () => void;
  onHelpClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  reconnectAttempts,
  onReconnect,
  onSettingsClick,
  onHelpClick,
}) => {
  return (
    <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-700">
      {/* Title and logo */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Claude Flow Live Operations</h1>
            <p className="text-xs text-slate-400">Real-time monitoring dashboard</p>
          </div>
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <ConnectionStatus
          status={connectionStatus}
          reconnectAttempts={reconnectAttempts}
          onReconnect={onReconnect}
        />

        {/* Divider */}
        <div className="h-6 w-px bg-slate-700" />

        {/* Settings button */}
        <button
          onClick={onSettingsClick}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Settings"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>

        {/* Help button */}
        <button
          onClick={onHelpClick}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1"
          aria-label="Keyboard shortcuts help"
          title="Keyboard shortcuts (?)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <kbd className="px-1.5 py-0.5 text-xs font-mono bg-slate-700 rounded">?</kbd>
        </button>
      </div>
    </header>
  );
};

export default Header;
