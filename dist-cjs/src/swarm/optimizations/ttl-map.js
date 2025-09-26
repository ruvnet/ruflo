export class TTLMap {
    items = new Map();
    cleanupTimer;
    defaultTTL;
    cleanupInterval;
    maxSize;
    onExpire;
    stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        expirations: 0
    };
    constructor(options = {}){
        this.defaultTTL = options.defaultTTL || 3600000;
        this.cleanupInterval = options.cleanupInterval || 60000;
        this.maxSize = options.maxSize;
        this.onExpire = options.onExpire;
        this.startCleanup();
    }
    set(key, value, ttl) {
        const now = Date.now();
        const expiry = now + (ttl || this.defaultTTL);
        if (this.maxSize && this.items.size >= this.maxSize && !this.items.has(key)) {
            this.evictLRU();
        }
        this.items.set(key, {
            value,
            expiry,
            createdAt: now,
            accessCount: 0,
            lastAccessedAt: now
        });
    }
    get(key) {
        const item = this.items.get(key);
        if (!item) {
            this.stats.misses++;
            return undefined;
        }
        const now = Date.now();
        if (now > item.expiry) {
            this.items.delete(key);
            this.stats.expirations++;
            this.stats.misses++;
            if (this.onExpire) {
                this.onExpire(key, item.value);
            }
            return undefined;
        }
        item.accessCount++;
        item.lastAccessedAt = now;
        this.stats.hits++;
        return item.value;
    }
    has(key) {
        const item = this.items.get(key);
        if (!item) {
            return false;
        }
        if (Date.now() > item.expiry) {
            this.items.delete(key);
            this.stats.expirations++;
            if (this.onExpire) {
                this.onExpire(key, item.value);
            }
            return false;
        }
        return true;
    }
    delete(key) {
        return this.items.delete(key);
    }
    clear() {
        this.items.clear();
    }
    touch(key, ttl) {
        const item = this.items.get(key);
        if (!item || Date.now() > item.expiry) {
            return false;
        }
        item.expiry = Date.now() + (ttl || this.defaultTTL);
        item.lastAccessedAt = Date.now();
        return true;
    }
    getTTL(key) {
        const item = this.items.get(key);
        if (!item) {
            return -1;
        }
        const remaining = item.expiry - Date.now();
        return remaining > 0 ? remaining : -1;
    }
    keys() {
        const now = Date.now();
        const validKeys = [];
        for (const [key, item] of this.items){
            if (now <= item.expiry) {
                validKeys.push(key);
            }
        }
        return validKeys;
    }
    values() {
        const now = Date.now();
        const validValues = [];
        for (const item of this.items.values()){
            if (now <= item.expiry) {
                validValues.push(item.value);
            }
        }
        return validValues;
    }
    entries() {
        const now = Date.now();
        const validEntries = [];
        for (const [key, item] of this.items){
            if (now <= item.expiry) {
                validEntries.push([
                    key,
                    item.value
                ]);
            }
        }
        return validEntries;
    }
    get size() {
        this.cleanup();
        return this.items.size;
    }
    startCleanup() {
        this.cleanupTimer = setInterval(()=>{
            this.cleanup();
        }, this.cleanupInterval);
    }
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, item] of this.items){
            if (now > item.expiry) {
                this.items.delete(key);
                cleaned++;
                this.stats.expirations++;
                if (this.onExpire) {
                    this.onExpire(key, item.value);
                }
            }
        }
        if (cleaned > 0) {}
    }
    evictLRU() {
        let lruKey;
        let lruTime = Infinity;
        for (const [key, item] of this.items){
            if (item.lastAccessedAt < lruTime) {
                lruTime = item.lastAccessedAt;
                lruKey = key;
            }
        }
        if (lruKey !== undefined) {
            this.items.delete(lruKey);
            this.stats.evictions++;
        }
    }
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        this.items.clear();
    }
    getStats() {
        return {
            ...this.stats,
            size: this.items.size,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }
    inspect() {
        const now = Date.now();
        const result = new Map();
        for (const [key, item] of this.items){
            if (now <= item.expiry) {
                result.set(key, {
                    value: item.value,
                    ttl: item.expiry - now,
                    age: now - item.createdAt,
                    accessCount: item.accessCount,
                    lastAccessed: now - item.lastAccessedAt
                });
            }
        }
        return result;
    }
}

//# sourceMappingURL=ttl-map.js.map