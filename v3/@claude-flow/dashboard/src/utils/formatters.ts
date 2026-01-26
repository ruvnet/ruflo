/**
 * Formatting utilities for Live Operations Dashboard
 */

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format CPU/memory usage
 */
export function formatUsage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format an agent name for display
 */
export function formatAgentName(name: string): string {
  // Capitalize first letter of each word
  return name
    .split(/[-_\s]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a task ID for display (show shortened version)
 */
export function formatTaskId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}

/**
 * Format namespace::key for display
 */
export function formatNamespaceKey(namespace: string, key?: string): string {
  if (!key) return namespace;
  return `${namespace}::${key}`;
}

/**
 * Format a similarity score
 */
export function formatSimilarity(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Format messages per second
 */
export function formatRate(rate: number): string {
  if (rate < 1) {
    return `${(rate * 60).toFixed(1)}/min`;
  }
  return `${rate.toFixed(1)}/s`;
}

/**
 * Get status label
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    spawning: 'Spawning',
    active: 'Active',
    idle: 'Idle',
    busy: 'Busy',
    error: 'Error',
    stopped: 'Stopped',
    pending: 'Pending',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  return labels[status] || status;
}

/**
 * Get operation label
 */
export function getOperationLabel(operation: string): string {
  const labels: Record<string, string> = {
    store: 'Store',
    retrieve: 'Retrieve',
    search: 'Search',
    delete: 'Delete',
    update: 'Update',
  };

  return labels[operation] || operation;
}

/**
 * Format JSON for display with syntax highlighting data
 */
export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Highlight search matches in text
 */
export function highlightMatches(
  text: string,
  search: string
): { text: string; isMatch: boolean }[] {
  if (!search) {
    return [{ text, isMatch: false }];
  }

  const regex = new RegExp(`(${escapeRegex(search)})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part) => ({
    text: part,
    isMatch: part.toLowerCase() === search.toLowerCase(),
  }));
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
