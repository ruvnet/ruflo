import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTransportError } from '../../utils/errors.js';
export class HttpTransport {
    host;
    port;
    tlsEnabled;
    logger;
    config;
    requestHandler;
    notificationHandler;
    app;
    server;
    wss;
    messageCount = 0;
    notificationCount = 0;
    running = false;
    connections = new Set();
    activeWebSockets = new Set();
    constructor(host, port, tlsEnabled, logger, config){
        this.host = host;
        this.port = port;
        this.tlsEnabled = tlsEnabled;
        this.logger = logger;
        this.config = config;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }
    async start() {
        if (this.running) {
            throw new MCPTransportError('Transport already running');
        }
        this.logger.info('Starting HTTP transport', {
            host: this.host,
            port: this.port,
            tls: this.tlsEnabled
        });
        try {
            this.server = createServer(this.app);
            this.wss = new WebSocketServer({
                server: this.server,
                path: '/ws'
            });
            this.setupWebSocketHandlers();
            await new Promise((resolve, reject)=>{
                this.server.listen(this.port, this.host, ()=>{
                    this.logger.info(`HTTP server listening on ${this.host}:${this.port}`);
                    resolve();
                });
                this.server.on('error', reject);
            });
            this.running = true;
            this.logger.info('HTTP transport started');
        } catch (error) {
            throw new MCPTransportError('Failed to start HTTP transport', {
                error
            });
        }
    }
    async stop() {
        if (!this.running) {
            return;
        }
        this.logger.info('Stopping HTTP transport');
        this.running = false;
        for (const ws of this.activeWebSockets){
            try {
                ws.close();
            } catch  {}
        }
        this.activeWebSockets.clear();
        this.connections.clear();
        if (this.wss) {
            this.wss.close();
            this.wss = undefined;
        }
        if (this.server) {
            await new Promise((resolve)=>{
                this.server.close(()=>resolve());
            });
            this.server = undefined;
        }
        this.logger.info('HTTP transport stopped');
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
                activeConnections: this.connections.size,
                activeWebSockets: this.activeWebSockets.size
            }
        };
    }
    setupMiddleware() {
        this.app.use(helmet());
        if (this.config?.corsEnabled) {
            const origins = this.config.corsOrigins || [
                '*'
            ];
            this.app.use(cors({
                origin: origins,
                credentials: true,
                maxAge: 86400
            }));
        }
        this.app.use(express.json({
            limit: '10mb'
        }));
        this.app.use(express.text());
    }
    setupRoutes() {
        const __filename = typeof import.meta?.url !== 'undefined' ? fileURLToPath(import.meta.url) : __filename || __dirname + '/http.ts';
        const __dirname = dirname(__filename);
        const consoleDir = join(__dirname, '../../ui/console');
        this.app.use('/console', express.static(consoleDir));
        this.app.get('/', (req, res)=>{
            res.redirect('/console');
        });
        this.app.get('/console', (req, res)=>{
            res.sendFile(join(consoleDir, 'index.html'));
        });
        this.app.get('/health', (req, res)=>{
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString()
            });
        });
        this.app.post('/rpc', async (req, res)=>{
            await this.handleJsonRpcRequest(req, res);
        });
        this.app.options('*', (req, res)=>{
            res.status(204).end();
        });
        this.app.use((req, res)=>{
            res.status(404).json({
                error: 'Not found'
            });
        });
        this.app.use((err, req, res, next)=>{
            this.logger.error('Express error', err);
            res.status(500).json({
                error: 'Internal server error',
                message: err.message
            });
        });
    }
    setupWebSocketHandlers() {
        if (!this.wss) return;
        this.wss.on('connection', (ws, req)=>{
            this.activeWebSockets.add(ws);
            this.logger.info('WebSocket client connected', {
                totalClients: this.activeWebSockets.size
            });
            ws.on('close', ()=>{
                this.activeWebSockets.delete(ws);
                this.logger.info('WebSocket client disconnected', {
                    totalClients: this.activeWebSockets.size
                });
            });
            ws.on('error', (error)=>{
                this.logger.error('WebSocket error', error);
                this.activeWebSockets.delete(ws);
            });
            ws.on('message', async (data)=>{
                try {
                    const message = JSON.parse(data.toString());
                    if (message.id === undefined) {
                        await this.handleNotificationMessage(message);
                    } else {
                        const response = await this.handleRequestMessage(message);
                        ws.send(JSON.stringify(response));
                    }
                } catch (error) {
                    this.logger.error('Error processing WebSocket message', error);
                    try {
                        const parsed = JSON.parse(data.toString());
                        if (parsed.id !== undefined) {
                            ws.send(JSON.stringify({
                                jsonrpc: '2.0',
                                id: parsed.id,
                                error: {
                                    code: -32603,
                                    message: 'Internal error'
                                }
                            }));
                        }
                    } catch  {}
                }
            });
        });
    }
    async handleJsonRpcRequest(req, res) {
        if (!req.is('application/json')) {
            res.status(400).json({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32600,
                    message: 'Invalid content type - expected application/json'
                }
            });
            return;
        }
        if (this.config?.auth?.enabled) {
            const authResult = await this.validateAuth(req);
            if (!authResult.valid) {
                res.status(401).json({
                    error: authResult.error || 'Unauthorized'
                });
                return;
            }
        }
        try {
            const mcpMessage = req.body;
            if (!mcpMessage.jsonrpc || mcpMessage.jsonrpc !== '2.0') {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: mcpMessage.id || null,
                    error: {
                        code: -32600,
                        message: 'Invalid request - missing or invalid jsonrpc version'
                    }
                });
                return;
            }
            if (!mcpMessage.method) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: mcpMessage.id || null,
                    error: {
                        code: -32600,
                        message: 'Invalid request - missing method'
                    }
                });
                return;
            }
            this.messageCount++;
            if (mcpMessage.id === undefined) {
                await this.handleNotificationMessage(mcpMessage);
                res.status(204).end();
            } else {
                const response = await this.handleRequestMessage(mcpMessage);
                res.json(response);
            }
        } catch (error) {
            this.logger.error('Error handling JSON-RPC request', error);
            res.status(500).json({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    async handleRequestMessage(request) {
        if (!this.requestHandler) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: 'No request handler registered'
                }
            };
        }
        try {
            return await this.requestHandler(request);
        } catch (error) {
            this.logger.error('Request handler error', {
                request,
                error
            });
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
    async handleNotificationMessage(notification) {
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
    async validateAuth(req) {
        const auth = req.headers.authorization;
        if (!auth) {
            return {
                valid: false,
                error: 'Authorization header required'
            };
        }
        const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
        if (!tokenMatch) {
            return {
                valid: false,
                error: 'Invalid authorization format - use Bearer token'
            };
        }
        const token = tokenMatch[1];
        if (this.config?.auth?.tokens && this.config.auth.tokens.length > 0) {
            const isValid = this.config.auth.tokens.includes(token);
            if (!isValid) {
                return {
                    valid: false,
                    error: 'Invalid token'
                };
            }
        }
        return {
            valid: true
        };
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
        throw new Error('HTTP transport does not support sending requests');
    }
    async sendNotification(notification) {
        const message = JSON.stringify(notification);
        for (const ws of this.activeWebSockets){
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            } catch (error) {
                this.logger.error('Failed to send notification to WebSocket', error);
            }
        }
        this.notificationCount++;
    }
}

//# sourceMappingURL=http.js.map