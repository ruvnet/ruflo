import { readFileSync } from 'node:fs';

/**
 * Give a record map a null prototype. Record keys come from MCP tool input; on
 * a plain object `__proto__` or `constructor` resolve to Object.prototype or a
 * built-in, which a handler would then write into. A null-prototype map only
 * ever returns its own records.
 */
export function nullPrototypeRecords<M extends object>(map: M | undefined | null): M {
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    Object.setPrototypeOf(map, null);
    return map;
  }
  return Object.create(null) as M;
}

/** Only an absent store is empty. Failed reads must never authorize replacement. */
export function readRecordStore<T>(path: string, collection: string, empty: () => T): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const store = empty() as Record<string, unknown>;
      store[collection] = nullPrototypeRecords(store[collection] as object | undefined);
      return store as T;
    }
    throw error;
  }
  const store = JSON.parse(text);
  const records = store?.[collection];
  if (!store || typeof store !== 'object' || Array.isArray(store)
      || !records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`Invalid ${collection} store at ${path}; existing data was preserved`);
  }
  nullPrototypeRecords(records);
  return store as T;
}
