import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { MCPTransportError } from '../../utils/errors.js';
export class StdioTransport {
    logger;
    requestHandler;
    notificationHandler;
    readline;
    messageCount = 0;
    notificationCount = 0;
    running = false;
    constructor(logger){
        this.logger = logger;
    }
    async start() {
        if (this.running) {
            throw new MCPTransportError('Transport already running');
        }
        this.logger.info('Starting stdio transport');
        try {
            this.readline = createInterface({
                input: stdin,
                output: stdout,
                terminal: false
            });
            this.readline.on('line', (line)=>{
                this.processMessage(line.trim()).catch((error)=>{
                    this.logger.error('Error processing message', {
                        line,
                        error
                    });
                });
            });
            this.readline.on('close', ()=>{
                this.logger.info('Stdin closed');
                this.running = false;
            });
            this.running = true;
            this.logger.info('Stdio transport started');
        } catch (error) {
            throw new MCPTransportError('Failed to start stdio transport', {
                error
            });
        }
    }
    async stop() {
        if (!this.running) {
            return;
        }
        this.logger.info('Stopping stdio transport');
        this.running = false;
        if (this.readline) {
            this.readline.close();
            this.readline = undefined;
        }
        this.logger.info('Stdio transport stopped');
    }
    onRequest(handler) {
        this.requestHandler = handler;
    }
    onNotification(handler) {
        this.notificationHandler = handler;
    }
    async getHealthStatus() {
        return {
            healthy: this.running,
            metrics: {
                messagesReceived: this.messageCount,
                notificationsSent: this.notificationCount,
                stdinOpen: this.readline ? 1 : 0
            }
        };
    }
    async processMessage(line) {
        let message;
        try {
            message = JSON.parse(line);
            if (!message.jsonrpc || message.jsonrpc !== '2.0') {
                throw new Error('Invalid JSON-RPC version');
            }
            if (!message.method) {
                throw new Error('Missing method');
            }
        } catch (error) {
            this.logger.error('Failed to parse message', {
                line,
                error
            });
            let id = 'unknown';
            try {
                const parsed = JSON.parse(line);
                if (parsed.id !== undefined) {
                    id = parsed.id;
                }
            } catch  {}
            await this.sendResponse({
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32700,
                    message: 'Parse error'
                }
            });
            return;
        }
        this.messageCount++;
        if (message.id === undefined) {
            await this.handleNotification(message);
        } else {
            await this.handleRequest(message);
        }
    }
    async handleRequest(request) {
        if (!this.requestHandler) {
            await this.sendResponse({
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: 'No request handler registered'
                }
            });
            return;
        }
        try {
            const response = await this.requestHandler(request);
            await this.sendResponse(response);
        } catch (error) {
            this.logger.error('Request handler error', {
                request,
                error
            });
            await this.sendResponse({
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    async handleNotification(notification) {
        if (!this.notificationHandler) {
            this.logger.warn('Received notification but no handler registered', {
                method: notification.method
            });
            return;
        }
        try {
            await this.notificationHandler(notification);
        } catch (error) {
            this.logger.error('Notification handler error', {
                notification,
                error
            });
        }
    }
    async sendResponse(response) {
        try {
            const json = JSON.stringify(response);
            stdout.write(json + '\n');
        } catch (error) {
            this.logger.error('Failed to send response', {
                response,
                error
            });
        }
    }
    async connect() {
        if (!this.running) {
            await this.start();
        }
    }
    async disconnect() {
        await this.stop();
    }
    async sendRequest(request) {
        const json = JSON.stringify(request);
        stdout.write(json + '\n');
        throw new Error('STDIO transport sendRequest requires request/response correlation');
    }
    async sendNotification(notification) {
        try {
            const json = JSON.stringify(notification);
            stdout.write(json + '\n');
            this.notificationCount++;
        } catch (error) {
            this.logger.error('Failed to send notification', {
                notification,
                error
            });
            throw error;
        }
    }
}

//# sourceMappingURL=stdio.js.map