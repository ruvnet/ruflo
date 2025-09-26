export class EventEmitter {
    events = new Map();
    on(event, handler) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(handler);
    }
    emit(event, ...args) {
        const handlers = this.events.get(event);
        if (handlers) {
            handlers.forEach((handler)=>handler(...args));
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
        const onceHandler = (...args)=>{
            handler(...args);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
    }
}

//# sourceMappingURL=event-emitter.js.map