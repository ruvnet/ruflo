/**
 * Registry API Client
 * Secure integration with Claude Flow Cloud Functions
 *
 * Security:
 * - HTTPS only
 * - No credentials stored in code
 * - Rate limiting respected
 * - Input validation
 */

const REGISTRY_API_URL = 'https://us-central1-claude-flow.cloudfunctions.net/publish-registry';

export interface RatingResponse {
  success: boolean;
  itemId: string;
  average: number;
  count: number;
  error?: string;
}

export interface BulkRatingsResponse {
  [itemId: string]: {
    average: number;
    count: number;
  };
}

export interface AnalyticsResponse {
  downloads: Record<string, number>;
  exports: number;
  imports: number;
  publishes: number;
}

/**
 * Validate item ID to prevent injection
 */
function validateItemId(itemId: string): boolean {
  // Only allow alphanumeric, @, /, -, _
  return /^[@a-zA-Z0-9\/_-]+$/.test(itemId) && itemId.length < 100;
}

/**
 * Validate rating value
 */
function validateRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/**
 * Rate a plugin or model
 */
export async function rateItem(
  itemId: string,
  rating: number,
  itemType: 'plugin' | 'model' = 'plugin',
  userId?: string
): Promise<RatingResponse> {
  if (!validateItemId(itemId)) {
    throw new Error('Invalid item ID');
  }
  if (!validateRating(rating)) {
    throw new Error('Rating must be integer 1-5');
  }

  const response = await fetch(`${REGISTRY_API_URL}?action=rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemId,
      rating,
      itemType,
      ...(userId && { userId }),
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Rating failed: ${error}`);
  }

  return response.json();
}

/**
 * Get ratings for a single item
 */
export async function getRating(
  itemId: string,
  itemType: 'plugin' | 'model' = 'plugin'
): Promise<RatingResponse> {
  if (!validateItemId(itemId)) {
    throw new Error('Invalid item ID');
  }

  const params = new URLSearchParams({
    action: 'get-ratings',
    itemId,
    itemType,
  });

  const response = await fetch(`${REGISTRY_API_URL}?${params}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error('Failed to get ratings');
  }

  return response.json();
}

/**
 * Get ratings for multiple items (batch)
 */
export async function getBulkRatings(
  itemIds: string[],
  itemType: 'plugin' | 'model' = 'plugin'
): Promise<BulkRatingsResponse> {
  // Validate all IDs
  for (const id of itemIds) {
    if (!validateItemId(id)) {
      throw new Error(`Invalid item ID: ${id}`);
    }
  }

  // Limit batch size
  const limitedIds = itemIds.slice(0, 50);

  const response = await fetch(`${REGISTRY_API_URL}?action=bulk-ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemIds: limitedIds,
      itemType,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error('Failed to get bulk ratings');
  }

  return response.json();
}

/**
 * Get analytics data
 */
export async function getAnalytics(): Promise<AnalyticsResponse> {
  const response = await fetch(`${REGISTRY_API_URL}?action=analytics`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error('Failed to get analytics');
  }

  return response.json();
}

/**
 * Track a download event
 */
export async function trackDownload(pluginId: string): Promise<void> {
  if (!validateItemId(pluginId)) {
    return; // Silently fail for invalid IDs
  }

  try {
    await fetch(`${REGISTRY_API_URL}?action=track-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-critical, don't throw
  }
}

/**
 * Check API health
 */
export async function checkHealth(): Promise<{
  healthy: boolean;
  latestCid?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${REGISTRY_API_URL}?action=status`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.json();
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
