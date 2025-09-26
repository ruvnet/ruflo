import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MCPServer } from '../server.js';
import { MCPLifecycleManager, LifecycleState } from '../lifecycle-manager.js';
import { MCPPerformanceMonitor } from '../performance-monitor.js';
import { MCPProtocolManager } from '../protocol-manager.js';
import { MCPOrchestrationIntegration } from '../orchestration-integration.js';
import { ToolRegistry } from '../tools.js';
import { EventEmitter } from 'node:events';
const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    configure: jest.fn()
};
const mockEventBus = new EventEmitter();
const mockMCPConfig = {
    transport: 'stdio',
    enableMetrics: true,
    auth: {
        enabled: false,
        method: 'token'
    }
};
describe('MCP Server', ()=>{
    let server;
    beforeEach(()=>{
        server = new MCPServer(mockMCPConfig, mockEventBus, mockLogger);
    });
    afterEach(async ()=>{
        if (server) {
            await server.stop();
        }
    });
    describe('Lifecycle Management', ()=>{
        it('should start and stop server successfully', async ()=>{
            await server.start();
            expect(mockLogger.info).toHaveBeenCalledWith('MCP server started successfully');
            await server.stop();
            expect(mockLogger.info).toHaveBeenCalledWith('MCP server stopped');
        });
        it('should handle initialization request', async ()=>{
            await server.start();
            const initParams = {
                protocolVersion: {
                    major: 2024,
                    minor: 11,
                    patch: 5
                },
                capabilities: {
                    tools: {
                        listChanged: true
                    }
                },
                clientInfo: {
                    name: 'test-client',
                    version: '1.0.0'
                }
            };
            const request = {
                jsonrpc: '2.0',
                id: 'test-init',
                method: 'initialize',
                params: initParams
            };
            const transport = server.transport;
            transport.onRequest = jest.fn();
            const response = await server.handleRequest(request);
            expect(response.jsonrpc).toBe('2.0');
            expect(response.id).toBe('test-init');
            expect(response.result).toBeDefined();
            expect(response.result.protocolVersion).toEqual({
                major: 2024,
                minor: 11,
                patch: 5
            });
        });
    });
    describe('Tool Registration', ()=>{
        beforeEach(async ()=>{
            await server.start();
        });
        it('should register tools successfully', ()=>{
            const tool = {
                name: 'test/tool',
                description: 'Test tool',
                inputSchema: {
                    type: 'object',
                    properties: {
                        input: {
                            type: 'string'
                        }
                    }
                },
                handler: jest.fn().mockResolvedValue('test result')
            };
            server.registerTool(tool);
            expect(mockLogger.info).toHaveBeenCalledWith('Tool registered', {
                name: 'test/tool'
            });
        });
        it('should list registered tools', async ()=>{
            const tool1 = {
                name: 'test/tool1',
                description: 'Test tool 1',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: jest.fn()
            };
            const tool2 = {
                name: 'test/tool2',
                description: 'Test tool 2',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: jest.fn()
            };
            server.registerTool(tool1);
            server.registerTool(tool2);
            const tools = server.toolRegistry.listTools();
            expect(tools).toHaveLength(2 + 4);
            expect(tools.some((t)=>t.name === 'test/tool1')).toBe(true);
            expect(tools.some((t)=>t.name === 'test/tool2')).toBe(true);
        });
    });
    describe('Health Checks', ()=>{
        beforeEach(async ()=>{
            await server.start();
        });
        it('should report healthy status when running', async ()=>{
            const health = await server.getHealthStatus();
            expect(health.healthy).toBe(true);
            expect(health.metrics).toBeDefined();
            expect(health.metrics?.registeredTools).toBeGreaterThan(0);
        });
        it('should include metrics in health status', async ()=>{
            const health = await server.getHealthStatus();
            expect(health.metrics).toBeDefined();
            expect(typeof health.metrics?.registeredTools).toBe('number');
            expect(typeof health.metrics?.totalRequests).toBe('number');
            expect(typeof health.metrics?.successfulRequests).toBe('number');
            expect(typeof health.metrics?.failedRequests).toBe('number');
        });
    });
});
describe('MCP Lifecycle Manager', ()=>{
    let lifecycleManager;
    let mockServerFactory;
    beforeEach(()=>{
        mockServerFactory = jest.fn(()=>new MCPServer(mockMCPConfig, mockEventBus, mockLogger));
        lifecycleManager = new MCPLifecycleManager(mockMCPConfig, mockLogger, mockServerFactory);
    });
    afterEach(async ()=>{
        if (lifecycleManager) {
            await lifecycleManager.stop();
        }
    });
    describe('State Management', ()=>{
        it('should start in stopped state', ()=>{
            expect(lifecycleManager.getState()).toBe(LifecycleState.STOPPED);
        });
        it('should transition to running state when started', async ()=>{
            await lifecycleManager.start();
            expect(lifecycleManager.getState()).toBe(LifecycleState.RUNNING);
        });
        it('should transition back to stopped when stopped', async ()=>{
            await lifecycleManager.start();
            await lifecycleManager.stop();
            expect(lifecycleManager.getState()).toBe(LifecycleState.STOPPED);
        });
        it('should emit state change events', async ()=>{
            const stateChanges = [];
            lifecycleManager.on('stateChange', (event)=>{
                stateChanges.push(event);
            });
            await lifecycleManager.start();
            await lifecycleManager.stop();
            expect(stateChanges).toHaveLength(4);
            expect(stateChanges[0].state).toBe(LifecycleState.STARTING);
            expect(stateChanges[1].state).toBe(LifecycleState.RUNNING);
            expect(stateChanges[2].state).toBe(LifecycleState.STOPPING);
            expect(stateChanges[3].state).toBe(LifecycleState.STOPPED);
        });
    });
    describe('Health Monitoring', ()=>{
        it('should perform health checks when enabled', async ()=>{
            const config = {
                healthCheckInterval: 100,
                enableHealthChecks: true
            };
            lifecycleManager = new MCPLifecycleManager(mockMCPConfig, mockLogger, mockServerFactory, config);
            await lifecycleManager.start();
            await new Promise((resolve)=>setTimeout(resolve, 150));
            const health = await lifecycleManager.healthCheck();
            expect(health).toBeDefined();
            expect(health.state).toBeDefined();
        });
        it('should track uptime', async ()=>{
            await lifecycleManager.start();
            await new Promise((resolve)=>setTimeout(resolve, 50));
            const uptime = lifecycleManager.getUptime();
            expect(uptime).toBeGreaterThan(0);
        });
    });
});
describe('MCP Performance Monitor', ()=>{
    let performanceMonitor;
    beforeEach(()=>{
        performanceMonitor = new MCPPerformanceMonitor(mockLogger);
    });
    afterEach(()=>{
        if (performanceMonitor) {
            performanceMonitor.stop();
        }
    });
    describe('Request Tracking', ()=>{
        it('should track request metrics', async ()=>{
            const mockSession = {
                id: 'test-session',
                clientInfo: {
                    name: 'test',
                    version: '1.0'
                },
                protocolVersion: {
                    major: 2024,
                    minor: 11,
                    patch: 5
                },
                capabilities: {},
                isInitialized: true,
                createdAt: new Date(),
                lastActivity: new Date(),
                transport: 'stdio',
                authenticated: false
            };
            const mockRequest = {
                jsonrpc: '2.0',
                id: 'test-request',
                method: 'test/method'
            };
            const requestId = performanceMonitor.recordRequestStart(mockRequest, mockSession);
            expect(requestId).toBeDefined();
            await new Promise((resolve)=>setTimeout(resolve, 10));
            performanceMonitor.recordRequestEnd(requestId, {
                jsonrpc: '2.0',
                id: 'test-request',
                result: 'success'
            });
            const metrics = performanceMonitor.getCurrentMetrics();
            expect(metrics.requestCount).toBe(1);
            expect(metrics.averageResponseTime).toBeGreaterThan(0);
        });
    });
});
describe('MCP Protocol Manager', ()=>{
    let protocolManager;
    beforeEach(()=>{
        protocolManager = new MCPProtocolManager(mockLogger);
    });
    describe('Version Compatibility', ()=>{
        it('should check version compatibility correctly', ()=>{
            const clientVersion = {
                major: 2024,
                minor: 11,
                patch: 5
            };
            const compatibility = protocolManager.checkCompatibility(clientVersion);
            expect(compatibility.compatible).toBe(true);
            expect(compatibility.errors).toHaveLength(0);
        });
        it('should reject incompatible major versions', ()=>{
            const clientVersion = {
                major: 2023,
                minor: 11,
                patch: 5
            };
            const compatibility = protocolManager.checkCompatibility(clientVersion);
            expect(compatibility.compatible).toBe(false);
            expect(compatibility.errors.length).toBeGreaterThan(0);
        });
    });
    describe('Protocol Negotiation', ()=>{
        it('should negotiate protocol successfully', async ()=>{
            const clientParams = {
                protocolVersion: {
                    major: 2024,
                    minor: 11,
                    patch: 5
                },
                capabilities: {
                    tools: {
                        listChanged: true
                    },
                    logging: {
                        level: 'info'
                    }
                },
                clientInfo: {
                    name: 'test-client',
                    version: '1.0.0'
                }
            };
            const result = await protocolManager.negotiateProtocol(clientParams);
            expect(result.agreedVersion).toEqual(clientParams.protocolVersion);
            expect(result.agreedCapabilities).toBeDefined();
            expect(result.agreedCapabilities.tools?.listChanged).toBe(true);
        });
    });
});
describe('Tool Registry', ()=>{
    let toolRegistry;
    beforeEach(()=>{
        toolRegistry = new ToolRegistry(mockLogger);
    });
    describe('Tool Management', ()=>{
        it('should register tools with capabilities', ()=>{
            const tool = {
                name: 'test/tool',
                description: 'Test tool for registry',
                inputSchema: {
                    type: 'object',
                    properties: {
                        input: {
                            type: 'string'
                        }
                    }
                },
                handler: jest.fn().mockResolvedValue('test result')
            };
            const capability = {
                name: 'test/tool',
                version: '1.0.0',
                description: 'Test capability',
                category: 'test',
                tags: [
                    'testing',
                    'demo'
                ],
                supportedProtocolVersions: [
                    {
                        major: 2024,
                        minor: 11,
                        patch: 5
                    }
                ]
            };
            toolRegistry.register(tool, capability);
            const registeredCapability = toolRegistry.getToolCapability('test/tool');
            expect(registeredCapability).toEqual(capability);
        });
        it('should discover tools by criteria', ()=>{
            const tool1 = {
                name: 'file/read',
                description: 'Read files',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: jest.fn()
            };
            const tool2 = {
                name: 'memory/query',
                description: 'Query memory',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: jest.fn()
            };
            toolRegistry.register(tool1);
            toolRegistry.register(tool2);
            const fileTools = toolRegistry.discoverTools({
                category: 'file'
            });
            expect(fileTools).toHaveLength(1);
            expect(fileTools[0].tool.name).toBe('file/read');
            const memoryTools = toolRegistry.discoverTools({
                tags: [
                    'memory'
                ]
            });
            expect(memoryTools).toHaveLength(1);
            expect(memoryTools[0].tool.name).toBe('memory/query');
        });
        it('should track tool metrics', async ()=>{
            const tool = {
                name: 'test/metric-tool',
                description: 'Tool for metrics testing',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: jest.fn().mockResolvedValue('success')
            };
            toolRegistry.register(tool);
            await toolRegistry.executeTool('test/metric-tool', {});
            await toolRegistry.executeTool('test/metric-tool', {});
            const metrics = toolRegistry.getToolMetrics('test/metric-tool');
            expect(Array.isArray(metrics) ? metrics[0].totalInvocations : metrics.totalInvocations).toBe(2);
            expect(Array.isArray(metrics) ? metrics[0].successfulInvocations : metrics.successfulInvocations).toBe(2);
        });
    });
});
describe('MCP Orchestration Integration', ()=>{
    let integration;
    let mockComponents;
    beforeEach(()=>{
        mockComponents = {
            orchestrator: {
                getStatus: jest.fn().mockResolvedValue({
                    status: 'running'
                }),
                listTasks: jest.fn().mockResolvedValue([])
            },
            eventBus: new EventEmitter()
        };
        integration = new MCPOrchestrationIntegration(mockMCPConfig, {
            enabledIntegrations: {
                orchestrator: true,
                swarm: false,
                agents: false,
                resources: false,
                memory: false,
                monitoring: false,
                terminals: false
            },
            autoStart: false,
            healthCheckInterval: 30000,
            reconnectAttempts: 3,
            reconnectDelay: 5000,
            enableMetrics: true,
            enableAlerts: true
        }, mockComponents, mockLogger);
    });
    afterEach(async ()=>{
        if (integration) {
            await integration.stop();
        }
    });
    describe('Integration Management', ()=>{
        it('should start integration successfully', async ()=>{
            await integration.start();
            const status = integration.getIntegrationStatus();
            expect(status).toHaveLength(7);
            const orchestratorStatus = status.find((s)=>s.component === 'orchestrator');
            expect(orchestratorStatus?.enabled).toBe(true);
        });
        it('should register orchestrator tools when enabled', async ()=>{
            await integration.start();
            const server = integration.getServer();
            expect(server).toBeDefined();
            const tools = server.toolRegistry.listTools();
            const orchestratorTools = tools.filter((t)=>t.name.startsWith('orchestrator/'));
            expect(orchestratorTools.length).toBeGreaterThan(0);
        });
        it('should handle component connection failures gracefully', async ()=>{
            mockComponents.orchestrator.getStatus = jest.fn().mockRejectedValue(new Error('Connection failed'));
            await integration.start();
            const status = integration.getComponentStatus('orchestrator');
            expect(status).toBeDefined();
        });
    });
    describe('Health Monitoring', ()=>{
        it('should monitor component health', async ()=>{
            await integration.start();
            await new Promise((resolve)=>setTimeout(resolve, 100));
            const status = integration.getIntegrationStatus();
            const enabledComponents = status.filter((s)=>s.enabled);
            for (const component of enabledComponents){
                expect(component.lastCheck).toBeInstanceOf(Date);
            }
        });
    });
});

//# sourceMappingURL=mcp-integration.test.js.map