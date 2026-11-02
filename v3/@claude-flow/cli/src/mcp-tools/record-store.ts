import { readFileSync } from 'node:fs';

/**
 * SECURITY: record maps are keyed by ids that come from MCP tool input. A plain
 * object resolves `__proto__`, `constructor` or `toString` to shared built-ins,
 * so a lookup by such an id would hand a handler Object.prototype (or a built-in
 * function) to write into. A null-prototype map only ever returns own records.
 */
export function asRecordMap<T>(map: Record<string, T>): Record<string, T> {
  if (map && typeof map === 'object' && Object.getPrototypeOf(map) !== null) Object.setPrototypeOf(map, null);
  return map;
}

/** Only an absent store is empty. Failed reads must never authorize replacement. */
export function readRecordStore<T>(path: string, collection: string, empty: () => T): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const fresh = empty() as Record<string, unknown>;
      asRecordMap(fresh[collection] as Record<string, unknown>);
      return fresh as T;
    }
    throw error;
  }
  const store = JSON.parse(text);
  const records = store?.[collection];
  if (!store || typeof store !== 'object' || Array.isArray(store)
      || !records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`Invalid ${collection} store at ${path}; existing data was preserved`);
  }
  asRecordMap(records);
  return store as T;
}
