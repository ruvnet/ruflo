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
var event_bus_exports = {};
__export(event_bus_exports, {
  EventBus: () => EventBus,
  eventBus: () => eventBus
});
module.exports = __toCommonJS(event_bus_exports);
var import_types = require("../utils/types.js");
var import_helpers = require("../utils/helpers.js");
class TypedEventBus extends import_helpers.TypedEventEmitter {
  static {
    __name(this, "TypedEventBus");
  }
  eventCounts = /* @__PURE__ */ new Map();
  lastEventTimes = /* @__PURE__ */ new Map();
  debug;
  constructor(debug = false) {
    super();
    this.debug = debug;
  }
  /**
   * Emits an event with logging
   */
  emit(event, data) {
    if (this.debug) {
      console.debug(`[EventBus] Emitting event: ${String(event)}`, data);
    }
    const count = this.eventCounts.get(event) || 0;
    this.eventCounts.set(event, count + 1);
    this.lastEventTimes.set(event, Date.now());
    super.emit(event, data);
  }
  /**
   * Get event statistics
   */
  getEventStats() {
    const stats = [];
    for (const [event, count] of this.eventCounts.entries()) {
      const lastTime = this.lastEventTimes.get(event);
      stats.push({
        event: String(event),
        count,
        lastEmitted: lastTime ? new Date(lastTime) : null
      });
    }
    return stats.sort((a, b) => b.count - a.count);
  }
  /**
   * Reset event statistics
   */
  resetStats() {
    this.eventCounts.clear();
    this.lastEventTimes.clear();
  }
}
class EventBus {
  static {
    __name(this, "EventBus");
  }
  static instance;
  typedBus;
  constructor(debug = false) {
    this.typedBus = new TypedEventBus(debug);
  }
  /**
   * Gets the singleton instance of the event bus
   */
  static getInstance(debug = false) {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus(debug);
    }
    return EventBus.instance;
  }
  /**
   * Emits an event
   */
  emit(event, data) {
    if (event in import_types.SystemEvents) {
      this.typedBus.emit(event, data);
    } else {
      this.typedBus.emit(event, data);
    }
  }
  /**
   * Registers an event handler
   */
  on(event, handler) {
    this.typedBus.on(event, handler);
  }
  /**
   * Removes an event handler
   */
  off(event, handler) {
    this.typedBus.off(event, handler);
  }
  /**
   * Registers a one-time event handler
   */
  once(event, handler) {
    this.typedBus.once(event, handler);
  }
  /**
   * Waits for an event to occur
   */
  async waitFor(event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const handler = /* @__PURE__ */ __name((data) => {
        if (timer)
          clearTimeout(timer);
        resolve(data);
      }, "handler");
      let timer;
      if (timeoutMs) {
        timer = setTimeout(() => {
          this.off(event, handler);
          reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeoutMs);
      }
      this.once(event, handler);
    });
  }
  /**
   * Creates a filtered event listener
   */
  onFiltered(event, filter, handler) {
    this.on(event, (data) => {
      if (filter(data)) {
        handler(data);
      }
    });
  }
  /**
   * Get event statistics
   */
  getEventStats() {
    return this.typedBus.getEventStats();
  }
  /**
   * Reset event statistics
   */
  resetStats() {
    this.typedBus.resetStats();
  }
  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event) {
    this.typedBus.removeAllListeners(event);
  }
}
const eventBus = EventBus.getInstance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EventBus,
  eventBus
});
//# sourceMappingURL=event-bus.js.map
