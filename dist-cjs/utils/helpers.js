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
var helpers_exports = {};
__export(helpers_exports, {
  TypedEventEmitter: () => TypedEventEmitter,
  add: () => add,
  calculator: () => calculator,
  circuitBreaker: () => circuitBreaker,
  createDeferred: () => createDeferred,
  debounce: () => debounce,
  deepClone: () => deepClone,
  deepMerge: () => deepMerge,
  delay: () => delay,
  ensureArray: () => ensureArray,
  execAsync: () => execAsync,
  formatBytes: () => formatBytes,
  generateId: () => generateId,
  greeting: () => greeting,
  groupBy: () => groupBy,
  helloWorld: () => helloWorld,
  parseDuration: () => parseDuration,
  retry: () => retry,
  safeParseJSON: () => safeParseJSON,
  throttle: () => throttle,
  timeout: () => timeout
});
module.exports = __toCommonJS(helpers_exports);
var import_util = require("util");
var import_child_process = require("child_process");
const execAsync = (0, import_util.promisify)(import_child_process.exec);
function add(a, b) {
  return a + b;
}
__name(add, "add");
function helloWorld() {
  return "Hello, World!";
}
__name(helloWorld, "helloWorld");
function generateId(prefix) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}
__name(generateId, "generateId");
function timeout(promise, ms, message) {
  let timeoutId;
  let completed = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(new Error(message || "Operation timed out"));
      }
    }, ms);
  });
  const wrappedPromise = promise.then(
    (result) => {
      completed = true;
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      return result;
    },
    (error) => {
      completed = true;
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  );
  return Promise.race([wrappedPromise, timeoutPromise]);
}
__name(timeout, "timeout");
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(delay, "delay");
async function retry(fn, options = {}) {
  const { maxAttempts = 3, initialDelay = 1e3, maxDelay = 3e4, factor = 2, onRetry } = options;
  let lastError;
  let delayMs = initialDelay;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) {
        throw lastError;
      }
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      await delay(Math.min(delayMs, maxDelay));
      delayMs *= factor;
    }
  }
  throw lastError;
}
__name(retry, "retry");
function debounce(fn, delayMs) {
  let timeoutId;
  return (...args) => {
    if (timeoutId !== void 0) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = void 0;
    }, delayMs);
  };
}
__name(debounce, "debounce");
function throttle(fn, limitMs) {
  let inThrottle = false;
  let lastArgs = null;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs !== null) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, limitMs);
    } else {
      lastArgs = args;
    }
  };
}
__name(throttle, "throttle");
function deepClone(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item));
  }
  if (obj instanceof Map) {
    const map = /* @__PURE__ */ new Map();
    obj.forEach((value, key) => {
      map.set(key, deepClone(value));
    });
    return map;
  }
  if (obj instanceof Set) {
    const set = /* @__PURE__ */ new Set();
    obj.forEach((value) => {
      set.add(deepClone(value));
    });
    return set;
  }
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}
__name(deepClone, "deepClone");
function deepMerge(target, ...sources) {
  const result = deepClone(target);
  if (!sources.length)
    return result;
  const source = sources.shift();
  if (!source)
    return result;
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const resultValue = result[key];
      if (isObject(resultValue) && isObject(sourceValue)) {
        result[key] = deepMerge(
          resultValue,
          sourceValue
        );
      } else {
        result[key] = sourceValue;
      }
    }
  }
  return deepMerge(result, ...sources);
}
__name(deepMerge, "deepMerge");
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
__name(isObject, "isObject");
class TypedEventEmitter {
  static {
    __name(this, "TypedEventEmitter");
  }
  listeners = /* @__PURE__ */ new Map();
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(handler);
  }
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }
  once(event, handler) {
    const onceHandler = /* @__PURE__ */ __name((data) => {
      handler(data);
      this.off(event, onceHandler);
    }, "onceHandler");
    this.on(event, onceHandler);
  }
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0)
    return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const absBytes = Math.abs(bytes);
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  const value = parseFloat((absBytes / Math.pow(k, i)).toFixed(dm));
  const sign = bytes < 0 ? "-" : "";
  return sign + value + " " + sizes[i];
}
__name(formatBytes, "formatBytes");
function parseDuration(duration) {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1e3;
    case "m":
      return value * 60 * 1e3;
    case "h":
      return value * 60 * 60 * 1e3;
    case "d":
      return value * 24 * 60 * 60 * 1e3;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}
__name(parseDuration, "parseDuration");
function ensureArray(value) {
  return Array.isArray(value) ? value : [value];
}
__name(ensureArray, "ensureArray");
function groupBy(items, keyFn) {
  return items.reduce(
    (groups, item) => {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    },
    {}
  );
}
__name(groupBy, "groupBy");
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
__name(createDeferred, "createDeferred");
function safeParseJSON(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}
__name(safeParseJSON, "safeParseJSON");
function calculator(a, b, operation) {
  switch (operation) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) {
        throw new Error("Division by zero");
      }
      return a / b;
    case "^":
      return Math.pow(a, b);
    case "%":
      if (b === 0) {
        throw new Error("Modulo by zero");
      }
      return a % b;
    default:
      throw new Error(`Invalid operation: ${operation}`);
  }
}
__name(calculator, "calculator");
function circuitBreaker(name, options) {
  const state = {
    failureCount: 0,
    lastFailureTime: 0,
    state: "closed"
  };
  const isOpen = /* @__PURE__ */ __name(() => {
    if (state.state === "open") {
      const now = Date.now();
      if (now - state.lastFailureTime >= options.resetTimeout) {
        state.state = "half-open";
        return false;
      }
      return true;
    }
    return false;
  }, "isOpen");
  const recordSuccess = /* @__PURE__ */ __name(() => {
    state.failureCount = 0;
    state.state = "closed";
  }, "recordSuccess");
  const recordFailure = /* @__PURE__ */ __name(() => {
    state.failureCount++;
    state.lastFailureTime = Date.now();
    if (state.failureCount >= options.threshold) {
      state.state = "open";
    }
  }, "recordFailure");
  return {
    async execute(fn) {
      if (isOpen()) {
        throw new Error(`Circuit breaker ${name} is open`);
      }
      try {
        const result = await timeout(fn(), options.timeout);
        recordSuccess();
        return result;
      } catch (error) {
        recordFailure();
        throw error;
      }
    },
    getState() {
      return { ...state };
    },
    reset() {
      state.failureCount = 0;
      state.lastFailureTime = 0;
      state.state = "closed";
    }
  };
}
__name(circuitBreaker, "circuitBreaker");
function greeting(name, options) {
  const opts = {
    timeOfDay: false,
    formal: false,
    locale: "en",
    ...options
  };
  const getTimeGreeting = /* @__PURE__ */ __name(() => {
    const hour = (/* @__PURE__ */ new Date()).getHours();
    if (hour < 12)
      return "Good morning";
    if (hour < 17)
      return "Good afternoon";
    if (hour < 21)
      return "Good evening";
    return "Good night";
  }, "getTimeGreeting");
  const getLocaleGreeting = /* @__PURE__ */ __name(() => {
    const greetings = {
      en: { informal: "Hello", formal: "Greetings" },
      es: { informal: "Hola", formal: "Saludos" },
      fr: { informal: "Salut", formal: "Bonjour" },
      de: { informal: "Hallo", formal: "Guten Tag" },
      it: { informal: "Ciao", formal: "Salve" },
      pt: { informal: "Ol\xE1", formal: "Sauda\xE7\xF5es" },
      ja: { informal: "\u3053\u3093\u306B\u3061\u306F", formal: "\u3054\u6328\u62F6" },
      zh: { informal: "\u4F60\u597D", formal: "\u60A8\u597D" }
    };
    const localeGreeting = greetings[opts.locale] || greetings.en;
    return opts.formal ? localeGreeting.formal : localeGreeting.informal;
  }, "getLocaleGreeting");
  let greetingText = opts.timeOfDay ? getTimeGreeting() : getLocaleGreeting();
  if (name) {
    greetingText += `, ${name}`;
  }
  greetingText += "!";
  return greetingText;
}
__name(greeting, "greeting");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TypedEventEmitter,
  add,
  calculator,
  circuitBreaker,
  createDeferred,
  debounce,
  deepClone,
  deepMerge,
  delay,
  ensureArray,
  execAsync,
  formatBytes,
  generateId,
  greeting,
  groupBy,
  helloWorld,
  parseDuration,
  retry,
  safeParseJSON,
  throttle,
  timeout
});
//# sourceMappingURL=helpers.js.map
