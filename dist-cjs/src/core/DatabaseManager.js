import * as fs from 'fs-extra';
import * as path from 'path';
export class DatabaseManager {
    provider;
    dbType;
    dbPath;
    initialized = false;
    retryCount = 0;
    maxRetries = 3;
    constructor(dbType = 'sqlite', dbPath){
        this.dbType = dbType;
        this.dbPath = dbPath || this.getDefaultPath();
        if (this.dbType === 'sqlite') {
            this.provider = this.initializeSQLiteWithRecovery();
        } else {
            this.provider = new JSONProvider(this.dbPath);
        }
    }
    initializeSQLiteWithRecovery() {
        try {
            return new SQLiteProvider(this.dbPath);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('ENOTEMPTY') || errorMsg.includes('better-sqlite3')) {
                console.warn('⚠️  SQLite initialization failed due to npm cache error');
                console.warn('   Will attempt automatic recovery during initialize()');
            } else {
                console.warn('SQLite not available, falling back to JSON storage:', error);
            }
            this.provider = new JSONProvider(this.dbPath.replace('.sqlite', '.json'));
            this.dbType = 'json';
            return this.provider;
        }
    }
    getDefaultPath() {
        const baseDir = path.join(process.cwd(), '.claude-flow');
        return this.dbType === 'sqlite' ? path.join(baseDir, 'database.sqlite') : path.join(baseDir, 'database.json');
    }
    async initialize() {
        await fs.ensureDir(path.dirname(this.dbPath));
        try {
            await this.provider.initialize();
            this.initialized = true;
        } catch (error) {
            if (this.dbType === 'json') {
                throw error;
            }
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (this.retryCount < this.maxRetries) {
                console.warn(`⚠️  Database initialization failed (attempt ${this.retryCount + 1}/${this.maxRetries})`);
                console.warn(`   Error: ${errorMsg}`);
                console.log('🔄 Switching to JSON storage as fallback...');
                this.provider = new JSONProvider(this.dbPath.replace('.sqlite', '.json'));
                this.dbType = 'json';
                this.retryCount++;
                await this.initialize();
            } else {
                throw error;
            }
        }
    }
    async store(key, value, namespace = 'default') {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.provider.store(key, value, namespace);
    }
    async retrieve(key, namespace = 'default') {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.provider.retrieve(key, namespace);
    }
    async delete(key, namespace = 'default') {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.provider.delete(key, namespace);
    }
    async list(namespace = 'default') {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.provider.list(namespace);
    }
    async close() {
        if (this.provider) {
            await this.provider.close();
        }
        this.initialized = false;
    }
    getDatabaseType() {
        return this.dbType;
    }
    getDatabasePath() {
        return this.dbPath;
    }
    isInitialized() {
        return this.initialized;
    }
    async storeJSON(key, data, namespace) {
        await this.store(key, JSON.stringify(data), namespace);
    }
    async retrieveJSON(key, namespace) {
        const data = await this.retrieve(key, namespace);
        if (!data) return null;
        try {
            return typeof data === 'string' ? JSON.parse(data) : data;
        } catch  {
            return null;
        }
    }
    async exists(key, namespace) {
        const data = await this.retrieve(key, namespace);
        return data !== null && data !== undefined;
    }
    async clear(namespace) {
        const keys = await this.list(namespace);
        await Promise.all(keys.map((key)=>this.delete(key, namespace)));
    }
}
let SQLiteProvider = class SQLiteProvider {
    db;
    dbPath;
    constructor(dbPath){
        this.dbPath = dbPath;
        try {
            const Database = require('better-sqlite3');
            this.db = new Database(dbPath);
        } catch (error) {
            throw new Error('better-sqlite3 not available. Install with: npm install better-sqlite3');
        }
    }
    async initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (namespace, key)
      )
    `);
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_namespace ON storage(namespace);
      CREATE INDEX IF NOT EXISTS idx_storage_created_at ON storage(created_at);
    `);
    }
    async store(key, value, namespace = 'default') {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO storage (namespace, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s', 'now'))
    `);
        const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
        stmt.run(namespace, key, serializedValue);
    }
    async retrieve(key, namespace = 'default') {
        const stmt = this.db.prepare('SELECT value FROM storage WHERE namespace = ? AND key = ?');
        const row = stmt.get(namespace, key);
        if (!row) return null;
        try {
            return JSON.parse(row.value);
        } catch  {
            return row.value;
        }
    }
    async delete(key, namespace = 'default') {
        const stmt = this.db.prepare('DELETE FROM storage WHERE namespace = ? AND key = ?');
        const result = stmt.run(namespace, key);
        return result.changes > 0;
    }
    async list(namespace = 'default') {
        const stmt = this.db.prepare('SELECT key FROM storage WHERE namespace = ? ORDER BY key');
        const rows = stmt.all(namespace);
        return rows.map((row)=>row.key);
    }
    async close() {
        if (this.db) {
            this.db.close();
        }
    }
};
let JSONProvider = class JSONProvider {
    data = {};
    dbPath;
    constructor(dbPath){
        this.dbPath = dbPath;
    }
    async initialize() {
        try {
            if (await fs.pathExists(this.dbPath)) {
                const content = await fs.readJSON(this.dbPath);
                this.data = content || {};
            }
        } catch (error) {
            console.warn('Failed to load JSON database, starting fresh:', error);
            this.data = {};
        }
    }
    async store(key, value, namespace = 'default') {
        if (!this.data[namespace]) {
            this.data[namespace] = {};
        }
        this.data[namespace][key] = value;
        await this.persist();
    }
    async retrieve(key, namespace = 'default') {
        if (!this.data[namespace]) {
            return null;
        }
        return this.data[namespace][key] || null;
    }
    async delete(key, namespace = 'default') {
        if (!this.data[namespace] || !(key in this.data[namespace])) {
            return false;
        }
        delete this.data[namespace][key];
        await this.persist();
        return true;
    }
    async list(namespace = 'default') {
        if (!this.data[namespace]) {
            return [];
        }
        return Object.keys(this.data[namespace]).sort();
    }
    async close() {
        await this.persist();
    }
    async persist() {
        try {
            await fs.ensureDir(path.dirname(this.dbPath));
            await fs.writeJSON(this.dbPath, this.data, {
                spaces: 2
            });
        } catch (error) {
            console.error('Failed to persist JSON database:', error);
        }
    }
};

//# sourceMappingURL=DatabaseManager.js.map