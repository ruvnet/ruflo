"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var circular_buffer_exports = {};
__export(circular_buffer_exports, {
  CircularBuffer: () => CircularBuffer
});
module.exports = __toCommonJS(circular_buffer_exports);
class CircularBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than 0");
    }
    this.buffer = new Array(capacity);
  }
  static {
    __name(this, "CircularBuffer");
  }
  buffer;
  writeIndex = 0;
  size = 0;
  totalItemsWritten = 0;
  push(item) {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.totalItemsWritten++;
  }
  pushMany(items) {
    for (const item of items) {
      this.push(item);
    }
  }
  get(index) {
    if (index < 0 || index >= this.size) {
      return void 0;
    }
    const actualIndex = this.size < this.capacity ? index : (this.writeIndex + index) % this.capacity;
    return this.buffer[actualIndex];
  }
  getRecent(count) {
    const result = [];
    const itemsToReturn = Math.min(count, this.size);
    const start = this.size < this.capacity ? Math.max(0, this.size - itemsToReturn) : (this.writeIndex - itemsToReturn + this.capacity) % this.capacity;
    for (let i = 0; i < itemsToReturn; i++) {
      const index = (start + i) % this.capacity;
      const item = this.buffer[index];
      if (item !== void 0) {
        result.push(item);
      }
    }
    return result;
  }
  getAll() {
    const result = [];
    if (this.size < this.capacity) {
      for (let i = 0; i < this.size; i++) {
        const item = this.buffer[i];
        if (item !== void 0) {
          result.push(item);
        }
      }
    } else {
      for (let i = 0; i < this.capacity; i++) {
        const index = (this.writeIndex + i) % this.capacity;
        const item = this.buffer[index];
        if (item !== void 0) {
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
  /**
   * Get estimated memory usage of the buffer
   */
  getMemoryUsage() {
    if (this.size === 0)
      return 0;
    const sample = this.buffer[0];
    if (sample === void 0)
      return 0;
    try {
      const sampleSize = JSON.stringify(sample).length * 2;
      return sampleSize * this.size;
    } catch {
      return this.size * 1024;
    }
  }
  /**
   * Create a snapshot of the current buffer state
   */
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
  /**
   * Resize the buffer (creates a new buffer with the new capacity)
   */
  resize(newCapacity) {
    if (newCapacity <= 0) {
      throw new Error("New capacity must be greater than 0");
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CircularBuffer
});
//# sourceMappingURL=circular-buffer.js.map
