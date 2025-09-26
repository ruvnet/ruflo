import { SystemEvents } from '../utils/types.js';
import { TypedEventEmitter } from '../utils/helpers.js';
let TypedEventBus = class TypedEventBus extends TypedEventEmitter {
    eventCounts = new Map();
    lastEventTimes = new Map();
    debug;
    constructor(debug = false){
        super();
        this.debug = debug;
    }
    emit(event, data) {
        if (this.debug) {
            console.debug(`[EventBus] Emitting event: ${String(event)}`, data);
        }
        const count = this.eventCounts.get(event) || 0;
        this.eventCounts.set(event, count + 1);
        this.lastEventTimes.set(event, Date.now());
        super.emit(event, data);
    }
    getEventStats() {
        const stats = [];
        for (const [event, count] of this.eventCounts.entries()){
            const lastTime = this.lastEventTimes.get(event);
            stats.push({
                event: String(event),
                count,
                lastEmitted: lastTime ? new Date(lastTime) : null
            });
        }
        return stats.sort((a, b)=>b.count - a.count);
    }
    resetStats() {
        this.eventCounts.clear();
        this.lastEventTimes.clear();
    }
};
export class EventBus {
    static instance;
    typedBus;
    constructor(debug = false){
        this.typedBus = new TypedEventBus(debug);
    }
    static getInstance(debug = false) {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus(debug);
        }
        return EventBus.instance;
    }
    emit(event, data) {
        if (event in SystemEvents) {
            this.typedBus.emit(event, data);
        } else {
            this.typedBus.emit(event, data);
        }
    }
    on(event, handler) {
        this.typedBus.on(event, handler);
    }
    off(event, handler) {
        this.typedBus.off(event, handler);
    }
    once(event, handler) {
        this.typedBus.once(event, handler);
    }
    async waitFor(event, timeoutMs) {
        return new Promise((resolve, reject)=>{
            const handler = (data)=>{
                if (timer) clearTimeout(timer);
                resolve(data);
            };
            let timer;
            if (timeoutMs) {
                timer = setTimeout(()=>{
                    this.off(event, handler);
                    reject(new Error(`Timeout waiting for event: ${event}`));
                }, timeoutMs);
            }
            this.once(event, handler);
        });
    }
    onFiltered(event, filter, handler) {
        this.on(event, (data)=>{
            if (filter(data)) {
                handler(data);
            }
        });
    }
    getEventStats() {
        return this.typedBus.getEventStats();
    }
    resetStats() {
        this.typedBus.resetStats();
    }
    removeAllListeners(event) {
        this.typedBus.removeAllListeners(event);
    }
}
export const eventBus = EventBus.getInstance();

//# sourceMappingURL=event-bus.js.map