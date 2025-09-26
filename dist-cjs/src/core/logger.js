import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
export var LogLevel = /*#__PURE__*/ function(LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    return LogLevel;
}({});
export class Logger {
    static instance;
    config;
    context;
    fileHandle;
    currentFileSize = 0;
    currentFileIndex = 0;
    isClosing = false;
    get level() {
        return this.config.level;
    }
    constructor(config = {
        level: 'info',
        format: 'json',
        destination: 'console'
    }, context = {}){
        if ((config.destination === 'file' || config.destination === 'both') && !config.filePath) {
            throw new Error('File path required for file logging');
        }
        this.config = config;
        this.context = context;
    }
    static getInstance(config) {
        if (!Logger.instance) {
            if (!config) {
                const isTestEnv = process.env.CLAUDE_FLOW_ENV === 'test';
                if (isTestEnv) {
                    throw new Error('Logger configuration required for initialization');
                }
                config = {
                    level: 'info',
                    format: 'json',
                    destination: 'console'
                };
            }
            Logger.instance = new Logger(config);
        }
        return Logger.instance;
    }
    async configure(config) {
        this.config = config;
        if (this.fileHandle && config.destination !== 'file' && config.destination !== 'both') {
            await this.fileHandle.close();
            delete this.fileHandle;
        }
    }
    debug(message, meta) {
        this.log(0, message, meta);
    }
    info(message, meta) {
        this.log(1, message, meta);
    }
    warn(message, meta) {
        this.log(2, message, meta);
    }
    error(message, error) {
        this.log(3, message, undefined, error);
    }
    child(context) {
        return new Logger(this.config, {
            ...this.context,
            ...context
        });
    }
    async close() {
        this.isClosing = true;
        if (this.fileHandle) {
            try {
                await this.fileHandle.close();
            } catch (error) {
                console.error('Error closing log file handle:', error);
            } finally{
                delete this.fileHandle;
            }
        }
    }
    log(level, message, data, error) {
        if (!this.shouldLog(level)) {
            return;
        }
        const entry = {
            timestamp: new Date().toISOString(),
            level: LogLevel[level],
            message,
            context: this.context,
            data,
            error
        };
        const formatted = this.format(entry);
        if (this.config.destination === 'console' || this.config.destination === 'both') {
            this.writeToConsole(level, formatted);
        }
        if (this.config.destination === 'file' || this.config.destination === 'both') {
            this.writeToFile(formatted);
        }
    }
    shouldLog(level) {
        const configLevel = LogLevel[this.config.level.toUpperCase()];
        return level >= configLevel;
    }
    format(entry) {
        if (this.config.format === 'json') {
            const jsonEntry = {
                ...entry
            };
            if (jsonEntry.error instanceof Error) {
                jsonEntry.error = {
                    name: jsonEntry.error.name,
                    message: jsonEntry.error.message,
                    stack: jsonEntry.error.stack
                };
            }
            return JSON.stringify(jsonEntry);
        }
        const contextStr = Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : '';
        const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : '';
        const errorStr = entry.error !== undefined ? entry.error instanceof Error ? `\n  Error: ${entry.error.message}\n  Stack: ${entry.error.stack}` : ` Error: ${JSON.stringify(entry.error)}` : '';
        return `[${entry.timestamp}] ${entry.level} ${entry.message}${contextStr}${dataStr}${errorStr}`;
    }
    writeToConsole(level, message) {
        switch(level){
            case 0:
                console.debug(message);
                break;
            case 1:
                console.info(message);
                break;
            case 2:
                console.warn(message);
                break;
            case 3:
                console.error(message);
                break;
        }
    }
    async writeToFile(message) {
        if (!this.config.filePath || this.isClosing) {
            return;
        }
        try {
            if (await this.shouldRotate()) {
                await this.rotate();
            }
            if (!this.fileHandle) {
                this.fileHandle = await fs.open(this.config.filePath, 'a');
            }
            const data = Buffer.from(message + '\n', 'utf8');
            await this.fileHandle.write(data);
            this.currentFileSize += data.length;
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    async shouldRotate() {
        if (!this.config.maxFileSize || !this.config.filePath) {
            return false;
        }
        try {
            const stat = await fs.stat(this.config.filePath);
            return stat.size >= this.config.maxFileSize;
        } catch  {
            return false;
        }
    }
    async rotate() {
        if (!this.config.filePath || !this.config.maxFiles) {
            return;
        }
        if (this.fileHandle) {
            await this.fileHandle.close();
            delete this.fileHandle;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = `${this.config.filePath}.${timestamp}`;
        await fs.rename(this.config.filePath, rotatedPath);
        await this.cleanupOldFiles();
        this.currentFileSize = 0;
    }
    async cleanupOldFiles() {
        if (!this.config.filePath || !this.config.maxFiles) {
            return;
        }
        const dir = path.dirname(this.config.filePath);
        const baseFileName = path.basename(this.config.filePath);
        try {
            const entries = await fs.readdir(dir, {
                withFileTypes: true
            });
            const files = [];
            for (const entry of entries){
                if (entry.isFile() && entry.name.startsWith(baseFileName + '.')) {
                    files.push(entry.name);
                }
            }
            files.sort().reverse();
            const filesToRemove = files.slice(this.config.maxFiles - 1);
            for (const file of filesToRemove){
                await fs.unlink(path.join(dir, file));
            }
        } catch (error) {
            console.error('Failed to cleanup old log files:', error);
        }
    }
}
export const logger = Logger.getInstance();

//# sourceMappingURL=logger.js.map