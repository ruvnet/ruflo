/**
 * Time utilities for Live Operations Dashboard
 * Handles time formatting and relative time calculations
 */

import { formatDistanceToNow, format, differenceInMilliseconds } from 'date-fns';

/**
 * Format a timestamp as relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

/**
 * Format a timestamp as absolute time (e.g., "14:32:45")
 */
export function formatAbsoluteTime(timestamp: number): string {
  return format(new Date(timestamp), 'HH:mm:ss');
}

/**
 * Format a timestamp with milliseconds (e.g., "14:32:45.123")
 */
export function formatPreciseTime(timestamp: number): string {
  return format(new Date(timestamp), 'HH:mm:ss.SSS');
}

/**
 * Format a full timestamp (e.g., "Jan 25, 2026 14:32:45")
 */
export function formatFullTime(timestamp: number): string {
  return format(new Date(timestamp), 'MMM d, yyyy HH:mm:ss');
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Calculate duration between two timestamps
 */
export function getDuration(startTime: number, endTime?: number): number {
  const end = endTime ?? Date.now();
  return differenceInMilliseconds(new Date(end), new Date(startTime));
}

/**
 * Format latency for display
 */
export function formatLatency(ms: number): string {
  if (ms < 1) {
    return '<1ms';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Get time range boundaries for filtering
 */
export function getTimeRange(range: '1h' | '6h' | '24h' | '7d'): { start: number; end: number } {
  const now = Date.now();
  const ranges: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  return {
    start: now - ranges[range],
    end: now,
  };
}

/**
 * Check if a timestamp is within a time range
 */
export function isWithinRange(
  timestamp: number,
  range: { start: number; end: number }
): boolean {
  return timestamp >= range.start && timestamp <= range.end;
}

/**
 * Group timestamps by time interval
 */
export function groupByInterval(
  timestamps: number[],
  intervalMs: number
): Map<number, number[]> {
  const groups = new Map<number, number[]>();

  timestamps.forEach((ts) => {
    const bucket = Math.floor(ts / intervalMs) * intervalMs;
    if (!groups.has(bucket)) {
      groups.set(bucket, []);
    }
    groups.get(bucket)!.push(ts);
  });

  return groups;
}
