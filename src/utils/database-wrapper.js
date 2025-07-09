/**
 * Database wrapper with fallback for CI environments
 * Provides in-memory fallback when better-sqlite3 is not available
 */

let Database;
let dbAvailable = true;

try {
  Database = require('better-sqlite3');
} catch (error) {
  console.warn('better-sqlite3 not available, using in-memory fallback');
  dbAvailable = false;
  
  // Simple in-memory database fallback
  class InMemoryDatabase {
    constructor(filename) {
      this.filename = filename;
      this.data = new Map();
      this.prepared = new Map();
    }
    
    prepare(sql) {
      const self = this;
      return {
        run(...params) {
          // Simple implementation for basic operations
          if (sql.includes('CREATE TABLE')) {
            return { changes: 0 };
          }
          if (sql.includes('INSERT')) {
            const key = params[0] || Date.now();
            self.data.set(key, params);
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get(...params) {
          if (sql.includes('SELECT')) {
            const key = params[0];
            const data = self.data.get(key);
            return data ? { id: key, data: JSON.stringify(data) } : undefined;
          }
          return undefined;
        },
        all() {
          return Array.from(self.data.entries()).map(([key, value]) => ({
            id: key,
            data: JSON.stringify(value)
          }));
        }
      };
    }
    
    transaction(fn) {
      return fn;
    }
    
    close() {
      this.data.clear();
    }
  }
  
  Database = InMemoryDatabase;
}

export { Database as default, dbAvailable };