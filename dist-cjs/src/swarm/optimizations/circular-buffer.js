export class CircularBuffer {
    capacity;
    buffer;
    writeIndex = 0;
    size = 0;
    totalItemsWritten = 0;
    constructor(capacity){
        this.capacity = capacity;
        if (capacity <= 0) {
            throw new Error('Capacity must be greater than 0');
        }
        this.buffer = new Array(capacity);
    }
    push(item) {
        this.buffer[this.writeIndex] = item;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        this.size = Math.min(this.size + 1, this.capacity);
        this.totalItemsWritten++;
    }
    pushMany(items) {
        for (const item of items){
            this.push(item);
        }
    }
    get(index) {
        if (index < 0 || index >= this.size) {
            return undefined;
        }
        const actualIndex = this.size < this.capacity ? index : (this.writeIndex + index) % this.capacity;
        return this.buffer[actualIndex];
    }
    getRecent(count) {
        const result = [];
        const itemsToReturn = Math.min(count, this.size);
        const start = this.size < this.capacity ? Math.max(0, this.size - itemsToReturn) : (this.writeIndex - itemsToReturn + this.capacity) % this.capacity;
        for(let i = 0; i < itemsToReturn; i++){
            const index = (start + i) % this.capacity;
            const item = this.buffer[index];
            if (item !== undefined) {
                result.push(item);
            }
        }
        return result;
    }
    getAll() {
        const result = [];
        if (this.size < this.capacity) {
            for(let i = 0; i < this.size; i++){
                const item = this.buffer[i];
                if (item !== undefined) {
                    result.push(item);
                }
            }
        } else {
            for(let i = 0; i < this.capacity; i++){
                const index = (this.writeIndex + i) % this.capacity;
                const item = this.buffer[index];
                if (item !== undefined) {
                    result.push(item);
                }
            }
        }
        return result;
    }
    find(predicate) {
        const all = this.getAll();
        return all.find(predicate);
    }
    filter(predicate) {
        const all = this.getAll();
        return all.filter(predicate);
    }
    clear() {
        this.buffer = new Array(this.capacity);
        this.writeIndex = 0;
        this.size = 0;
    }
    isEmpty() {
        return this.size === 0;
    }
    isFull() {
        return this.size === this.capacity;
    }
    getSize() {
        return this.size;
    }
    getCapacity() {
        return this.capacity;
    }
    getTotalItemsWritten() {
        return this.totalItemsWritten;
    }
    getOverwrittenCount() {
        return Math.max(0, this.totalItemsWritten - this.capacity);
    }
    getMemoryUsage() {
        if (this.size === 0) return 0;
        const sample = this.buffer[0];
        if (sample === undefined) return 0;
        try {
            const sampleSize = JSON.stringify(sample).length * 2;
            return sampleSize * this.size;
        } catch  {
            return this.size * 1024;
        }
    }
    snapshot() {
        return {
            items: this.getAll(),
            capacity: this.capacity,
            size: this.size,
            totalItemsWritten: this.totalItemsWritten,
            overwrittenCount: this.getOverwrittenCount(),
            memoryUsage: this.getMemoryUsage()
        };
    }
    resize(newCapacity) {
        if (newCapacity <= 0) {
            throw new Error('New capacity must be greater than 0');
        }
        const items = this.getAll();
        this.capacity = newCapacity;
        this.buffer = new Array(newCapacity);
        this.writeIndex = 0;
        this.size = 0;
        const itemsToKeep = items.slice(-newCapacity);
        this.pushMany(itemsToKeep);
    }
}

//# sourceMappingURL=circular-buffer.js.map