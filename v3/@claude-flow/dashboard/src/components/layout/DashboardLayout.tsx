/**
 * DashboardLayout Component
 * Main layout wrapper with sidebar, header, and keyboard shortcuts
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useDashboardStore, type DashboardView } from '../../store/dashboardStore';
import { useMessageStore } from '../../store/messageStore';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const viewShortcuts: Record<string, DashboardView> = {
  '1': 'overview',
  '2': 'agents',
  '3': 'tasks',
  '4': 'messages',
  '5': 'memory',
  '6': 'topology',
};

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  // Get state from stores
  const selectedView = useDashboardStore((s) => s.selectedView);
  const connectionStatus = useDashboardStore((s) => s.connectionStatus);
  const setSelectedView = useDashboardStore((s) => s.setSelectedView);
  const setSelectedAgent = useDashboardStore((s) => s.setSelectedAgent);
  const setSelectedTask = useDashboardStore((s) => s.setSelectedTask);
  const togglePause = useMessageStore((s) => s.togglePause);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // View shortcuts (1-6)
      const view = viewShortcuts[event.key];
      if (view) {
        event.preventDefault();
        setSelectedView(view);
        return;
      }

      // Other shortcuts
      switch (event.key) {
        case ' ':
          // Space to toggle pause
          event.preventDefault();
          togglePause();
          break;
        case 'Escape':
          // Escape to close panels
          if (showHelp) {
            setShowHelp(false);
          } else if (showSettings) {
            setShowSettings(false);
          } else {
            setSelectedAgent(null);
            setSelectedTask(null);
          }
          break;
        case '/':
          // / to focus search
          event.preventDefault();
          // TODO: Implement search focus
          break;
        case '?':
          // ? to show help
          event.preventDefault();
          setShowHelp((prev) => !prev);
          break;
      }
    },
    [setSelectedView, togglePause, setSelectedAgent, setSelectedTask, showHelp, showSettings]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle mobile sidebar collapse on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        currentView={selectedView}
        onViewChange={setSelectedView}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          connectionStatus={connectionStatus}
          reconnectAttempts={0}
          onReconnect={() => {}}
          onSettingsClick={() => setShowSettings(true)}
          onHelpClick={() => setShowHelp(true)}
        />

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowHelp(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
        >
          <div
            className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 id="help-title" className="text-lg font-semibold text-white">
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                aria-label="Close help"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-300">Navigation</h3>
                <div className="grid gap-2 text-sm">
                  {Object.entries(viewShortcuts).map(([key, view]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-slate-400 capitalize">{view}</span>
                      <kbd className="px-2 py-1 bg-slate-800 rounded text-slate-300 font-mono">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-700 pt-4 space-y-2">
                <h3 className="text-sm font-medium text-slate-300">Actions</h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Pause/Resume stream</span>
                    <kbd className="px-2 py-1 bg-slate-800 rounded text-slate-300 font-mono">
                      Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Close panel</span>
                    <kbd className="px-2 py-1 bg-slate-800 rounded text-slate-300 font-mono">
                      Esc
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Focus search</span>
                    <kbd className="px-2 py-1 bg-slate-800 rounded text-slate-300 font-mono">/</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Show this help</span>
                    <kbd className="px-2 py-1 bg-slate-800 rounded text-slate-300 font-mono">?</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal placeholder */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowSettings(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <div
            className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 id="settings-title" className="text-lg font-semibold text-white">
                Settings
              </h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                aria-label="Close settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="text-slate-400 text-sm">
              Settings panel coming soon. Configure WebSocket URL, display options, and more.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;
