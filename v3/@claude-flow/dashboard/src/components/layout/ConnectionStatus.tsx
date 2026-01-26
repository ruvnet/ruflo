/**
 * ConnectionStatus Component
 * Displays WebSocket connection status with visual indicator
 */

import React from 'react';
import type { ConnectionStatus as ConnectionStatusType } from '../../types/events';

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  reconnectAttempts: number;
  onReconnect?: () => void;
}

const statusConfig: Record<
  ConnectionStatusType,
  { color: string; text: string; pulse: boolean; bgColor: string }
> = {
  connected: {
    color: 'bg-green-500',
    text: 'Connected',
    pulse: false,
    bgColor: 'bg-green-500/10',
  },
  connecting: {
    color: 'bg-blue-500',
    text: 'Connecting',
    pulse: true,
    bgColor: 'bg-blue-500/10',
  },
  reconnecting: {
    color: 'bg-blue-500',
    text: 'Reconnecting',
    pulse: true,
    bgColor: 'bg-blue-500/10',
  },
  disconnected: {
    color: 'bg-red-500',
    text: 'Disconnected',
    pulse: false,
    bgColor: 'bg-red-500/10',
  },
  error: {
    color: 'bg-red-500',
    text: 'Error',
    pulse: false,
    bgColor: 'bg-red-500/10',
  },
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  reconnectAttempts,
  onReconnect,
}) => {
  const config = statusConfig[status];
  const isReconnecting = status === 'reconnecting' || (status === 'connecting' && reconnectAttempts > 0);
  const canReconnect = status === 'disconnected' || status === 'error';

  const handleClick = () => {
    if (canReconnect && onReconnect) {
      onReconnect();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && canReconnect && onReconnect) {
      e.preventDefault();
      onReconnect();
    }
  };

  return (
    <div
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm
        ${config.bgColor}
        ${canReconnect ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
      `}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={canReconnect ? 'button' : 'status'}
      tabIndex={canReconnect ? 0 : undefined}
      aria-label={
        canReconnect
          ? `${config.text}. Click to reconnect.`
          : isReconnecting
            ? `Reconnecting, attempt ${reconnectAttempts}`
            : config.text
      }
    >
      {/* Status indicator dot */}
      <span className="relative flex h-2.5 w-2.5">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75 animate-ping`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${config.color}`} />
      </span>

      {/* Status text */}
      <span className="text-slate-200 font-medium">
        {isReconnecting ? `Reconnecting (${reconnectAttempts})...` : config.text}
      </span>

      {/* Reconnect hint for disconnected/error states */}
      {canReconnect && (
        <span className="text-slate-400 text-xs ml-1">(click to retry)</span>
      )}
    </div>
  );
};

export default ConnectionStatus;
