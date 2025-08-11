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
var event_emitter_exports = {};
__export(event_emitter_exports, {
  EventEmitter: () => EventEmitter
});
module.exports = __toCommonJS(event_emitter_exports);
class EventEmitter {
  static {
    __name(this, "EventEmitter");
  }
  events = /* @__PURE__ */ new Map();
  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(handler);
  }
  emit(event, ...args) {
    const handlers = this.events.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }
  off(event, handler) {
    const handlers = this.events.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }
  once(event, handler) {
    const onceHandler = /* @__PURE__ */ __name((...args) => {
      handler(...args);
      this.off(event, onceHandler);
    }, "onceHandler");
    this.on(event, onceHandler);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EventEmitter
});
//# sourceMappingURL=event-emitter.js.map
