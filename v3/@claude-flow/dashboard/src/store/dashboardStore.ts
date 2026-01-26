/**
 * Dashboard Store - Main dashboard state management
 * Uses Zustand for lightweight, type-safe state management
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

/**
 * Connection status for WebSocket or MCP connection
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Available dashboard views
 */
export type DashboardView = 'overview' | 'agents' | 'tasks' | 'messages' | 'memory' | 'topology';

/**
 * Dashboard settings configuration
 */
export interface DashboardSettings {
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  refreshInterval: number;
  /** Maximum items to display in lists */
  maxDisplayItems: number;
  /** Enable sound notifications */
  soundNotifications: boolean;
  /** Enable desktop notifications */
  desktopNotifications: boolean;
  /** Theme preference */
  theme: 'light' | 'dark' | 'system';
  /** Compact mode for dense information display */
  compactMode: boolean;
  /** Show debug information */
  debugMode: boolean;
  /** Animation settings */
  animations: boolean;
  /** Topology layout preference */
  topologyLayout: 'hierarchical' | 'force' | 'circular' | 'grid';
  /** Message stream buffer size */
  messageBufferSize: number;
}

/**
 * Dashboard state shape
 */
export interface DashboardState {
  // Connection state
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  lastConnectedAt: Date | null;

  // View state
  selectedView: DashboardView;
  selectedAgent: string | null;
  selectedTask: string | null;

  // Settings
  settings: DashboardSettings;

  // UI state
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;

  // Actions
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  setSelectedView: (view: DashboardView) => void;
  setSelectedAgent: (agentId: string | null) => void;
  setSelectedTask: (taskId: string | null) => void;
  updateSettings: (settings: Partial<DashboardSettings>) => void;
  resetSettings: () => void;
  toggleSidebar: () => void;
  toggleCommandPalette: () => void;
}

/**
 * Default dashboard settings
 */
const defaultSettings: DashboardSettings = {
  refreshInterval: 5000,
  maxDisplayItems: 100,
  soundNotifications: false,
  desktopNotifications: true,
  theme: 'system',
  compactMode: false,
  debugMode: false,
  animations: true,
  topologyLayout: 'hierarchical',
  messageBufferSize: 1000,
};

/**
 * Load settings from localStorage
 */
const loadPersistedSettings = (): Partial<DashboardSettings> => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem('dashboard-settings');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

/**
 * Save settings to localStorage
 */
const persistSettings = (settings: DashboardSettings): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('dashboard-settings', JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Dashboard Zustand store
 */
export const useDashboardStore = create<DashboardState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      connectionStatus: 'disconnected',
      connectionError: null,
      lastConnectedAt: null,
      selectedView: 'overview',
      selectedAgent: null,
      selectedTask: null,
      settings: { ...defaultSettings, ...loadPersistedSettings() },
      sidebarCollapsed: false,
      commandPaletteOpen: false,

      // Actions
      setConnectionStatus: (status, error) =>
        set(
          (state) => ({
            connectionStatus: status,
            connectionError: error ?? null,
            lastConnectedAt: status === 'connected' ? new Date() : state.lastConnectedAt,
          }),
          false,
          'setConnectionStatus'
        ),

      setSelectedView: (view) =>
        set(
          { selectedView: view },
          false,
          'setSelectedView'
        ),

      setSelectedAgent: (agentId) =>
        set(
          { selectedAgent: agentId },
          false,
          'setSelectedAgent'
        ),

      setSelectedTask: (taskId) =>
        set(
          { selectedTask: taskId },
          false,
          'setSelectedTask'
        ),

      updateSettings: (newSettings) =>
        set(
          (state) => {
            const updated = { ...state.settings, ...newSettings };
            persistSettings(updated);
            return { settings: updated };
          },
          false,
          'updateSettings'
        ),

      resetSettings: () =>
        set(
          () => {
            persistSettings(defaultSettings);
            return { settings: defaultSettings };
          },
          false,
          'resetSettings'
        ),

      toggleSidebar: () =>
        set(
          (state) => ({ sidebarCollapsed: !state.sidebarCollapsed }),
          false,
          'toggleSidebar'
        ),

      toggleCommandPalette: () =>
        set(
          (state) => ({ commandPaletteOpen: !state.commandPaletteOpen }),
          false,
          'toggleCommandPalette'
        ),
    })),
    { name: 'DashboardStore' }
  )
);

/**
 * Selector hooks for optimized re-renders
 */
export const useConnectionStatus = () => useDashboardStore((state) => state.connectionStatus);
export const useSelectedView = () => useDashboardStore((state) => state.selectedView);
export const useSelectedAgent = () => useDashboardStore((state) => state.selectedAgent);
export const useSelectedTask = () => useDashboardStore((state) => state.selectedTask);
export const useDashboardSettings = () => useDashboardStore((state) => state.settings);
