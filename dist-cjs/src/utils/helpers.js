import { promisify } from 'util';
import { exec } from 'child_process';
export const execAsync = promisify(exec);
export function add(a, b) {
    return a + b;
}
export function helloWorld() {
    return 'Hello, World!';
}
export function generateId(prefix) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}
export function timeout(promise, ms, message) {
    let timeoutId;
    let completed = false;
    const timeoutPromise = new Promise((_, reject)=>{
        timeoutId = setTimeout(()=>{
            if (!completed) {
                completed = true;
                reject(new Error(message || 'Operation timed out'));
            }
        }, ms);
    });
    const wrappedPromise = promise.then((result)=>{
        completed = true;
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        return result;
    }, (error)=>{
        completed = true;
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        throw error;
    });
    return Promise.race([
        wrappedPromise,
        timeoutPromise
    ]);
}
export function delay(ms) {
    return new Promise((resolve)=>setTimeout(resolve, ms));
}
export async function retry(fn, options = {}) {
    const { maxAttempts = 3, initialDelay = 1000, maxDelay = 30000, factor = 2, onRetry } = options;
    let lastError;
    let delayMs = initialDelay;
    for(let attempt = 1; attempt <= maxAttempts; attempt++){
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
export function debounce(fn, delayMs) {
    let timeoutId;
    return (...args)=>{
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(()=>{
            fn(...args);
            timeoutId = undefined;
        }, delayMs);
    };
}
export function throttle(fn, limitMs) {
    let inThrottle = false;
    let lastArgs = null;
    return (...args)=>{
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(()=>{
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
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    if (obj instanceof Array) {
        return obj.map((item)=>deepClone(item));
    }
    if (obj instanceof Map) {
        const map = new Map();
        obj.forEach((value, key)=>{
            map.set(key, deepClone(value));
        });
        return map;
    }
    if (obj instanceof Set) {
        const set = new Set();
        obj.forEach((value)=>{
            set.add(deepClone(value));
        });
        return set;
    }
    const cloned = {};
    for(const key in obj){
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}
export function deepMerge(target, ...sources) {
    const result = deepClone(target);
    if (!sources.length) return result;
    const source = sources.shift();
    if (!source) return result;
    for(const key in source){
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const sourceValue = source[key];
            const resultValue = result[key];
            if (isObject(resultValue) && isObject(sourceValue)) {
                result[key] = deepMerge(resultValue, sourceValue);
            } else {
                result[key] = sourceValue;
            }
        }
    }
    return deepMerge(result, ...sources);
}
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export class TypedEventEmitter {
    listeners = new Map();
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
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
            handlers.forEach((handler)=>handler(data));
        }
    }
    once(event, handler) {
        const onceHandler = (data)=>{
            handler(data);
            this.off(event, onceHandler);
        };
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
export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = [
        'Bytes',
        'KB',
        'MB',
        'GB',
        'TB'
    ];
    const absBytes = Math.abs(bytes);
    const i = Math.floor(Math.log(absBytes) / Math.log(k));
    const value = parseFloat((absBytes / Math.pow(k, i)).toFixed(dm));
    const sign = bytes < 0 ? '-' : '';
    return sign + value + ' ' + sizes[i];
}
export function parseDuration(duration) {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
        throw new Error(`Invalid duration format: ${duration}`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch(unit){
        case 'ms':
            return value;
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`Unknown duration unit: ${unit}`);
    }
}
export function ensureArray(value) {
    return Array.isArray(value) ? value : [
        value
    ];
}
export function groupBy(items, keyFn) {
    return items.reduce((groups, item)=>{
        const key = keyFn(item);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, {});
}
export function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej)=>{
        resolve = res;
        reject = rej;
    });
    return {
        promise,
        resolve: resolve,
        reject: reject
    };
}
export function safeParseJSON(json, fallback) {
    try {
        return JSON.parse(json);
    } catch  {
        return fallback;
    }
}
export function calculator(a, b, operation) {
    switch(operation){
        case '+':
            return a + b;
        case '-':
            return a - b;
        case '*':
            return a * b;
        case '/':
            if (b === 0) {
                throw new Error('Division by zero');
            }
            return a / b;
        case '^':
            return Math.pow(a, b);
        case '%':
            if (b === 0) {
                throw new Error('Modulo by zero');
            }
            return a % b;
        default:
            throw new Error(`Invalid operation: ${operation}`);
    }
}
export function circuitBreaker(name, options) {
    const state = {
        failureCount: 0,
        lastFailureTime: 0,
        state: 'closed'
    };
    const isOpen = ()=>{
        if (state.state === 'open') {
            const now = Date.now();
            if (now - state.lastFailureTime >= options.resetTimeout) {
                state.state = 'half-open';
                return false;
            }
            return true;
        }
        return false;
    };
    const recordSuccess = ()=>{
        state.failureCount = 0;
        state.state = 'closed';
    };
    const recordFailure = ()=>{
        state.failureCount++;
        state.lastFailureTime = Date.now();
        if (state.failureCount >= options.threshold) {
            state.state = 'open';
        }
    };
    return {
        async execute (fn) {
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
        getState () {
            return {
                ...state
            };
        },
        reset () {
            state.failureCount = 0;
            state.lastFailureTime = 0;
            state.state = 'closed';
        }
    };
}
export function greeting(name, options) {
    const opts = {
        timeOfDay: false,
        formal: false,
        locale: 'en',
        ...options
    };
    const getTimeGreeting = ()=>{
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        if (hour < 21) return 'Good evening';
        return 'Good night';
    };
    const getLocaleGreeting = ()=>{
        const greetings = {
            en: {
                informal: 'Hello',
                formal: 'Greetings'
            },
            es: {
                informal: 'Hola',
                formal: 'Saludos'
            },
            fr: {
                informal: 'Salut',
                formal: 'Bonjour'
            },
            de: {
                informal: 'Hallo',
                formal: 'Guten Tag'
            },
            it: {
                informal: 'Ciao',
                formal: 'Salve'
            },
            pt: {
                informal: 'Olá',
                formal: 'Saudações'
            },
            ja: {
                informal: 'こんにちは',
                formal: 'ご挨拶'
            },
            zh: {
                informal: '你好',
                formal: '您好'
            }
        };
        const localeGreeting = greetings[opts.locale] || greetings.en;
        return opts.formal ? localeGreeting.formal : localeGreeting.informal;
    };
    let greetingText = opts.timeOfDay ? getTimeGreeting() : getLocaleGreeting();
    if (name) {
        greetingText += `, ${name}`;
    }
    greetingText += '!';
    return greetingText;
}

//# sourceMappingURL=helpers.js.map