const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const isDeno = typeof Deno !== 'undefined';
let runtime;
let stdin, stdout, stderr;
let TextEncoder, TextDecoder;
let exit, pid, addSignalListener;
if (isDeno) {
    runtime = 'deno';
    stdin = Deno.stdin;
    stdout = Deno.stdout;
    stderr = Deno.stderr;
    TextEncoder = globalThis.TextEncoder;
    TextDecoder = globalThis.TextDecoder;
    exit = Deno.exit;
    pid = Deno.pid;
    addSignalListener = Deno.addSignalListener;
} else if (isNode) {
    runtime = 'node';
    stdin = process.stdin;
    stdout = process.stdout;
    stderr = process.stderr;
    TextEncoder = globalThis.TextEncoder || require('util').TextEncoder;
    TextDecoder = globalThis.TextDecoder || require('util').TextDecoder;
    exit = process.exit;
    pid = process.pid;
    addSignalListener = (signal, handler)=>{
        process.on(signal, handler);
    };
} else {
    throw new Error('Unsupported runtime environment');
}
export class UnifiedTerminalIO {
    constructor(){
        this.decoder = new TextDecoder();
        this.encoder = new TextEncoder();
        this.runtime = runtime;
    }
    async write(data) {
        if (typeof data === 'string') {
            data = this.encoder.encode(data);
        }
        if (runtime === 'deno') {
            await stdout.write(data);
        } else {
            return new Promise((resolve)=>{
                stdout.write(data, resolve);
            });
        }
    }
    async read(buffer) {
        if (runtime === 'deno') {
            return await stdin.read(buffer);
        } else {
            return new Promise((resolve)=>{
                let data = '';
                const onData = (chunk)=>{
                    data += chunk;
                    if (data.includes('\n')) {
                        stdin.removeListener('data', onData);
                        const encoded = this.encoder.encode(data);
                        const bytesToCopy = Math.min(encoded.length, buffer.length);
                        buffer.set(encoded.slice(0, bytesToCopy));
                        resolve(bytesToCopy);
                    }
                };
                if (stdin.setRawMode && typeof stdin.setRawMode === 'function') {
                    try {
                        stdin.setRawMode(true);
                    } catch (err) {}
                }
                if (stdin.resume && typeof stdin.resume === 'function') {
                    stdin.resume();
                }
                stdin.on('data', onData);
            });
        }
    }
    onSignal(signal, handler) {
        if (runtime === 'deno') {
            addSignalListener(signal, handler);
        } else {
            process.on(signal, handler);
        }
    }
    exit(code = 0) {
        exit(code);
    }
    getPid() {
        return pid;
    }
    setRawMode(enabled) {
        if (runtime === 'node' && stdin.setRawMode && typeof stdin.setRawMode === 'function') {
            try {
                stdin.setRawMode(enabled);
            } catch (err) {}
        }
    }
    resume() {
        if (runtime === 'node' && stdin.resume) {
            stdin.resume();
        }
    }
    pause() {
        if (runtime === 'node' && stdin.pause) {
            stdin.pause();
        }
    }
}
export const RuntimeDetector = {
    isNode: ()=>isNode,
    isDeno: ()=>isDeno,
    getRuntime: ()=>runtime,
    getPlatform: ()=>{
        if (runtime === 'deno') {
            return {
                os: Deno.build.os,
                arch: Deno.build.arch,
                target: Deno.build.target
            };
        } else {
            return {
                os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : process.platform,
                arch: process.arch,
                target: `${process.arch}-${process.platform}`
            };
        }
    },
    hasAPI: (apiName)=>{
        switch(apiName){
            case 'deno':
                return isDeno;
            case 'node':
                return isNode;
            case 'fs':
                return runtime === 'node' || runtime === 'deno' && typeof Deno.readFile !== 'undefined';
            case 'process':
                return runtime === 'node' || runtime === 'deno' && typeof Deno.run !== 'undefined';
            default:
                return false;
        }
    },
    getEnv: (key)=>{
        if (runtime === 'deno') {
            return process.env[key];
        } else {
            return process.env[key];
        }
    },
    setEnv: (key, value)=>{
        if (runtime === 'deno') {
            process.env[key] = value;
        } else {
            process.env[key] = value;
        }
    }
};
export const createCompatibilityLayer = ()=>{
    return {
        runtime,
        terminal: new UnifiedTerminalIO(),
        detector: RuntimeDetector,
        TextEncoder,
        TextDecoder,
        platform: RuntimeDetector.getPlatform(),
        getEnv: RuntimeDetector.getEnv,
        setEnv: RuntimeDetector.setEnv,
        exit,
        pid,
        safeCall: async (fn, fallback = null)=>{
            try {
                return await fn();
            } catch (error) {
                console.warn(`Runtime compatibility warning: ${error.message}`);
                return fallback;
            }
        },
        hasFeature: (feature)=>{
            return RuntimeDetector.hasAPI(feature);
        }
    };
};
export const compat = createCompatibilityLayer();
export { runtime, isNode, isDeno };

//# sourceMappingURL=runtime-detector.js.map