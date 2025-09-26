import { EventEmitter } from 'node:events';
import { generateId } from '../utils/helpers.js';
export class ResourceManager extends EventEmitter {
    logger;
    eventBus;
    config;
    resources = new Map();
    pools = new Map();
    reservations = new Map();
    allocations = new Map();
    usageHistory = new Map();
    predictions = new Map();
    optimizer;
    monitoringInterval;
    cleanupInterval;
    scalingInterval;
    metrics;
    constructor(config, logger, eventBus){
        super();
        this.logger = logger;
        this.eventBus = eventBus;
        this.config = {
            enableResourcePooling: true,
            enableResourceMonitoring: true,
            enableAutoScaling: true,
            enableQoS: true,
            monitoringInterval: 30000,
            cleanupInterval: 300000,
            defaultLimits: {
                cpu: 4.0,
                memory: 8 * 1024 * 1024 * 1024,
                disk: 100 * 1024 * 1024 * 1024,
                network: 1024 * 1024 * 1024,
                custom: {}
            },
            reservationTimeout: 300000,
            allocationStrategy: 'best-fit',
            priorityWeights: {
                critical: 1.0,
                high: 0.8,
                normal: 0.6,
                low: 0.4,
                background: 0.2
            },
            enablePredictiveAllocation: true,
            enableResourceSharing: true,
            debugMode: false,
            ...config
        };
        this.optimizer = new ResourceOptimizer(this.config, this.logger);
        this.metrics = new ResourceManagerMetrics();
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.eventBus.on('agent:resource-request', (data)=>{
            this.handleResourceRequest(data);
        });
        this.eventBus.on('agent:resource-release', (data)=>{
            this.handleResourceRelease(data);
        });
        this.eventBus.on('resource:usage-update', (data)=>{
            this.updateResourceUsage(data.resourceId, data.usage);
        });
        this.eventBus.on('resource:failure', (data)=>{
            this.handleResourceFailure(data);
        });
        this.eventBus.on('scaling:trigger', (data)=>{
            this.handleScalingTrigger(data);
        });
    }
    async initialize() {
        this.logger.info('Initializing resource manager', {
            pooling: this.config.enableResourcePooling,
            monitoring: this.config.enableResourceMonitoring,
            autoScaling: this.config.enableAutoScaling
        });
        await this.optimizer.initialize();
        await this.createDefaultPools();
        if (this.config.enableResourceMonitoring) {
            this.startMonitoring();
        }
        this.startCleanup();
        if (this.config.enableAutoScaling) {
            this.startAutoScaling();
        }
        this.emit('resource-manager:initialized');
    }
    async shutdown() {
        this.logger.info('Shutting down resource manager');
        if (this.monitoringInterval) clearInterval(this.monitoringInterval);
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        if (this.scalingInterval) clearInterval(this.scalingInterval);
        await this.releaseAllAllocations();
        await this.optimizer.shutdown();
        this.emit('resource-manager:shutdown');
    }
    async registerResource(type, name, capacity, metadata = {}) {
        const resourceId = generateId('resource');
        const resource = {
            id: resourceId,
            type,
            name,
            description: `${type} resource: ${name}`,
            capacity,
            allocated: this.createEmptyLimits(),
            available: {
                ...capacity
            },
            status: 'available',
            metadata: {
                provider: 'local',
                capabilities: [],
                performance: this.createDefaultPerformanceMetrics(),
                reliability: this.createDefaultReliabilityMetrics(),
                cost: this.createDefaultCostMetrics(),
                lastUpdated: new Date(),
                ...metadata
            },
            reservations: [],
            allocations: [],
            sharable: this.config.enableResourceSharing,
            persistent: true,
            cost: 1.0,
            tags: []
        };
        this.resources.set(resourceId, resource);
        this.logger.info('Resource registered', {
            resourceId,
            type,
            name,
            capacity
        });
        this.emit('resource:registered', {
            resource
        });
        return resourceId;
    }
    async unregisterResource(resourceId) {
        const resource = this.resources.get(resourceId);
        if (!resource) {
            throw new Error(`Resource ${resourceId} not found`);
        }
        if (resource.allocations.length > 0) {
            throw new Error(`Cannot unregister resource ${resourceId}: has active allocations`);
        }
        for (const reservation of resource.reservations){
            await this.cancelReservation(reservation.id, 'resource_unregistered');
        }
        this.resources.delete(resourceId);
        this.logger.info('Resource unregistered', {
            resourceId
        });
        this.emit('resource:unregistered', {
            resourceId
        });
    }
    async requestResources(agentId, requirements, options = {}) {
        const reservationId = generateId('reservation');
        const now = new Date();
        const reservation = {
            id: reservationId,
            resourceId: '',
            agentId,
            taskId: options.taskId,
            requirements,
            status: 'pending',
            priority: options.priority || 'normal',
            createdAt: now,
            expiresAt: options.timeout ? new Date(now.getTime() + options.timeout) : new Date(now.getTime() + this.config.reservationTimeout),
            metadata: {
                preemptible: options.preemptible || false
            }
        };
        this.reservations.set(reservationId, reservation);
        try {
            const resource = await this.findSuitableResource(requirements, reservation.priority);
            if (!resource) {
                reservation.status = 'failed';
                throw new Error('No suitable resource available');
            }
            reservation.resourceId = resource.id;
            resource.reservations.push(reservation);
            this.updateResourceAvailability(resource);
            reservation.status = 'confirmed';
            this.logger.info('Resource reservation created', {
                reservationId,
                resourceId: resource.id,
                agentId: agentId.id,
                requirements
            });
            this.emit('reservation:created', {
                reservation
            });
            if (this.canActivateReservation(reservation)) {
                await this.activateReservation(reservationId);
            }
            return reservationId;
        } catch (error) {
            reservation.status = 'failed';
            this.logger.error('Resource reservation failed', {
                reservationId,
                agentId: agentId.id,
                error
            });
            throw error;
        }
    }
    async activateReservation(reservationId) {
        const reservation = this.reservations.get(reservationId);
        if (!reservation) {
            throw new Error(`Reservation ${reservationId} not found`);
        }
        if (reservation.status !== 'confirmed') {
            throw new Error(`Reservation ${reservationId} is not confirmed`);
        }
        const resource = this.resources.get(reservation.resourceId);
        if (!resource) {
            throw new Error(`Resource ${reservation.resourceId} not found`);
        }
        const allocationId = generateId('allocation');
        const allocation = {
            id: allocationId,
            reservationId,
            resourceId: resource.id,
            agentId: reservation.agentId,
            taskId: reservation.taskId,
            allocated: this.calculateAllocation(reservation.requirements, resource),
            actualUsage: this.createEmptyUsage(),
            efficiency: 1.0,
            startTime: new Date(),
            status: 'active',
            qosViolations: []
        };
        this.allocations.set(allocationId, allocation);
        resource.allocations.push(allocation);
        this.addToResourceLimits(resource.allocated, allocation.allocated);
        this.updateResourceAvailability(resource);
        reservation.status = 'active';
        reservation.activatedAt = new Date();
        this.logger.info('Resource allocation activated', {
            allocationId,
            reservationId,
            resourceId: resource.id,
            agentId: reservation.agentId.id,
            allocated: allocation.allocated
        });
        this.emit('allocation:activated', {
            allocation
        });
        return allocationId;
    }
    async releaseResources(allocationId, reason = 'completed') {
        const allocation = this.allocations.get(allocationId);
        if (!allocation) {
            throw new Error(`Allocation ${allocationId} not found`);
        }
        const resource = this.resources.get(allocation.resourceId);
        if (!resource) {
            throw new Error(`Resource ${allocation.resourceId} not found`);
        }
        allocation.status = 'completed';
        allocation.endTime = new Date();
        allocation.efficiency = this.calculateEfficiency(allocation);
        this.subtractFromResourceLimits(resource.allocated, allocation.allocated);
        resource.allocations = resource.allocations.filter((a)=>a.id !== allocationId);
        this.updateResourceAvailability(resource);
        const reservation = this.reservations.get(allocation.reservationId);
        if (reservation) {
            reservation.releasedAt = new Date();
        }
        this.logger.info('Resource allocation released', {
            allocationId,
            resourceId: resource.id,
            agentId: allocation.agentId.id,
            reason,
            efficiency: allocation.efficiency
        });
        this.emit('allocation:released', {
            allocation,
            reason
        });
        this.metrics.recordAllocationReleased(allocation);
    }
    async cancelReservation(reservationId, reason = 'cancelled') {
        const reservation = this.reservations.get(reservationId);
        if (!reservation) {
            throw new Error(`Reservation ${reservationId} not found`);
        }
        if (reservation.status === 'active') {
            const allocation = Array.from(this.allocations.values()).find((a)=>a.reservationId === reservationId);
            if (allocation) {
                await this.releaseResources(allocation.id, reason);
            }
        }
        reservation.status = 'cancelled';
        if (reservation.resourceId) {
            const resource = this.resources.get(reservation.resourceId);
            if (resource) {
                resource.reservations = resource.reservations.filter((r)=>r.id !== reservationId);
                this.updateResourceAvailability(resource);
            }
        }
        this.logger.info('Resource reservation cancelled', {
            reservationId,
            reason
        });
        this.emit('reservation:cancelled', {
            reservation,
            reason
        });
    }
    async createResourcePool(name, type, resourceIds, strategy = 'least-loaded') {
        const poolId = generateId('pool');
        for (const resourceId of resourceIds){
            const resource = this.resources.get(resourceId);
            if (!resource) {
                throw new Error(`Resource ${resourceId} not found`);
            }
            if (resource.type !== type) {
                throw new Error(`Resource ${resourceId} type mismatch: expected ${type}, got ${resource.type}`);
            }
        }
        const pool = {
            id: poolId,
            name,
            type,
            resources: [
                ...resourceIds
            ],
            strategy,
            loadBalancing: 'least-connections',
            scaling: {
                enabled: this.config.enableAutoScaling,
                minResources: Math.max(1, resourceIds.length),
                maxResources: resourceIds.length * 3,
                scaleUpThreshold: 0.8,
                scaleDownThreshold: 0.3,
                cooldownPeriod: 300000,
                metrics: [
                    {
                        name: 'utilization',
                        weight: 1.0,
                        threshold: 0.8,
                        aggregation: 'avg'
                    },
                    {
                        name: 'queue_depth',
                        weight: 0.5,
                        threshold: 10,
                        aggregation: 'max'
                    }
                ]
            },
            qos: {
                guarantees: [],
                objectives: [],
                violations: {
                    autoRemediation: true,
                    escalationThreshold: 3,
                    penaltyFunction: 'linear',
                    notificationEnabled: true
                }
            },
            statistics: this.createPoolStatistics(),
            filters: []
        };
        this.pools.set(poolId, pool);
        this.logger.info('Resource pool created', {
            poolId,
            name,
            type,
            resourceCount: resourceIds.length
        });
        this.emit('pool:created', {
            pool
        });
        return poolId;
    }
    async addResourceToPool(poolId, resourceId) {
        const pool = this.pools.get(poolId);
        if (!pool) {
            throw new Error(`Pool ${poolId} not found`);
        }
        const resource = this.resources.get(resourceId);
        if (!resource) {
            throw new Error(`Resource ${resourceId} not found`);
        }
        if (resource.type !== pool.type) {
            throw new Error(`Resource type mismatch: pool expects ${pool.type}, resource is ${resource.type}`);
        }
        if (!pool.resources.includes(resourceId)) {
            pool.resources.push(resourceId);
            this.updatePoolStatistics(pool);
        }
        this.logger.info('Resource added to pool', {
            poolId,
            resourceId
        });
        this.emit('pool:resource-added', {
            poolId,
            resourceId
        });
    }
    async removeResourceFromPool(poolId, resourceId) {
        const pool = this.pools.get(poolId);
        if (!pool) {
            throw new Error(`Pool ${poolId} not found`);
        }
        if (pool.resources.length <= pool.scaling.minResources) {
            throw new Error(`Cannot remove resource: pool would go below minimum size`);
        }
        pool.resources = pool.resources.filter((id)=>id !== resourceId);
        this.updatePoolStatistics(pool);
        this.logger.info('Resource removed from pool', {
            poolId,
            resourceId
        });
        this.emit('pool:resource-removed', {
            poolId,
            resourceId
        });
    }
    async findSuitableResource(requirements, priority) {
        const candidates = [];
        for (const resource of this.resources.values()){
            if (resource.status !== 'available') continue;
            const score = this.calculateResourceScore(resource, requirements, priority);
            if (score > 0) {
                candidates.push({
                    resource,
                    score
                });
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b)=>b.score - a.score);
        return this.selectResourceByStrategy(candidates, requirements);
    }
    calculateResourceScore(resource, requirements, priority) {
        let score = 0;
        if (!this.canSatisfyRequirements(resource, requirements)) {
            return 0;
        }
        const utilization = this.calculateResourceUtilization(resource);
        score += (1 - utilization) * 100;
        score += resource.metadata.performance.cpuScore * 10;
        score += resource.metadata.reliability.uptime * 50;
        score += 1 / resource.cost * 20;
        const priorityWeight = this.config.priorityWeights[priority] || 1.0;
        score *= priorityWeight;
        return score;
    }
    canSatisfyRequirements(resource, requirements) {
        if (requirements.cpu && requirements.cpu.min > resource.available.cpu) {
            return false;
        }
        if (requirements.memory && requirements.memory.min > resource.available.memory) {
            return false;
        }
        if (requirements.disk && requirements.disk.min > resource.available.disk) {
            return false;
        }
        if (requirements.network && requirements.network.min > resource.available.network) {
            return false;
        }
        if (requirements.custom) {
            for (const [name, spec] of Object.entries(requirements.custom)){
                const available = resource.available.custom[name] || 0;
                if (spec.min > available) {
                    return false;
                }
            }
        }
        if (requirements.constraints) {
            if (!this.checkConstraints(resource, requirements.constraints)) {
                return false;
            }
        }
        return true;
    }
    checkConstraints(resource, constraints) {
        if (constraints.location && constraints.location.length > 0) {
            if (!constraints.location.includes(resource.location || '')) {
                return false;
            }
        }
        if (constraints.excludeLocation && constraints.excludeLocation.length > 0) {
            if (constraints.excludeLocation.includes(resource.location || '')) {
                return false;
            }
        }
        if (constraints.maxCost && resource.cost > constraints.maxCost) {
            return false;
        }
        if (constraints.timeWindow) {
            const now = new Date();
            if (now < constraints.timeWindow.start || now > constraints.timeWindow.end) {
                return false;
            }
        }
        return true;
    }
    selectResourceByStrategy(candidates, requirements) {
        switch(this.config.allocationStrategy){
            case 'first-fit':
                return candidates[0].resource;
            case 'best-fit':
                return candidates.reduce((best, current)=>{
                    const bestWaste = this.calculateWaste(best.resource, requirements);
                    const currentWaste = this.calculateWaste(current.resource, requirements);
                    return currentWaste < bestWaste ? current : best;
                }).resource;
            case 'worst-fit':
                return candidates.reduce((worst, current)=>{
                    const worstWaste = this.calculateWaste(worst.resource, requirements);
                    const currentWaste = this.calculateWaste(current.resource, requirements);
                    return currentWaste > worstWaste ? current : worst;
                }).resource;
            case 'balanced':
            default:
                return candidates[0].resource;
        }
    }
    calculateWaste(resource, requirements) {
        let waste = 0;
        if (requirements.cpu) {
            waste += Math.max(0, resource.available.cpu - requirements.cpu.min);
        }
        if (requirements.memory) {
            waste += Math.max(0, resource.available.memory - requirements.memory.min);
        }
        return waste;
    }
    calculateAllocation(requirements, resource) {
        const allocation = {
            cpu: 0,
            memory: 0,
            disk: 0,
            network: 0,
            custom: {}
        };
        if (requirements.cpu) {
            allocation.cpu = Math.min(requirements.cpu.preferred || requirements.cpu.min, resource.available.cpu);
        }
        if (requirements.memory) {
            allocation.memory = Math.min(requirements.memory.preferred || requirements.memory.min, resource.available.memory);
        }
        if (requirements.disk) {
            allocation.disk = Math.min(requirements.disk.preferred || requirements.disk.min, resource.available.disk);
        }
        if (requirements.network) {
            allocation.network = Math.min(requirements.network.preferred || requirements.network.min, resource.available.network);
        }
        if (requirements.custom) {
            for (const [name, spec] of Object.entries(requirements.custom)){
                const available = resource.available.custom[name] || 0;
                allocation.custom[name] = Math.min(spec.preferred || spec.min, available);
            }
        }
        return allocation;
    }
    startMonitoring() {
        this.monitoringInterval = setInterval(()=>{
            this.performMonitoring();
        }, this.config.monitoringInterval);
        this.logger.info('Started resource monitoring', {
            interval: this.config.monitoringInterval
        });
    }
    startCleanup() {
        this.cleanupInterval = setInterval(()=>{
            this.performCleanup();
        }, this.config.cleanupInterval);
        this.logger.info('Started resource cleanup', {
            interval: this.config.cleanupInterval
        });
    }
    startAutoScaling() {
        this.scalingInterval = setInterval(()=>{
            this.evaluateScaling();
        }, 60000);
        this.logger.info('Started auto-scaling');
    }
    async performMonitoring() {
        try {
            for (const resource of this.resources.values()){
                await this.updateResourceStatistics(resource);
            }
            for (const pool of this.pools.values()){
                this.updatePoolStatistics(pool);
            }
            if (this.config.enableQoS) {
                await this.checkQoSViolations();
            }
            if (this.config.enablePredictiveAllocation) {
                await this.updatePredictions();
            }
            this.emit('monitoring:updated', {
                resources: this.resources.size,
                pools: this.pools.size,
                allocations: this.allocations.size
            });
        } catch (error) {
            this.logger.error('Monitoring failed', error);
        }
    }
    async performCleanup() {
        const now = new Date();
        const expiredReservations = Array.from(this.reservations.values()).filter((r)=>r.expiresAt && r.expiresAt < now && r.status === 'pending');
        for (const reservation of expiredReservations){
            await this.cancelReservation(reservation.id, 'expired');
        }
        const cutoff = new Date(now.getTime() - 86400000);
        for (const [resourceId, history] of this.usageHistory){
            this.usageHistory.set(resourceId, history.filter((usage)=>usage.timestamp > cutoff));
        }
        this.logger.debug('Cleanup completed', {
            expiredReservations: expiredReservations.length
        });
    }
    async evaluateScaling() {
        for (const pool of this.pools.values()){
            if (!pool.scaling.enabled) continue;
            const metrics = this.calculatePoolMetrics(pool);
            const shouldScale = this.shouldScale(pool, metrics);
            if (shouldScale.action === 'scale-up') {
                await this.scalePoolUp(pool);
            } else if (shouldScale.action === 'scale-down') {
                await this.scalePoolDown(pool);
            }
        }
    }
    canActivateReservation(reservation) {
        const resource = this.resources.get(reservation.resourceId);
        if (!resource) return false;
        return this.canSatisfyRequirements(resource, reservation.requirements);
    }
    calculateResourceUtilization(resource) {
        let totalCapacity = 0;
        let totalAllocated = 0;
        totalCapacity += resource.capacity.cpu;
        totalAllocated += resource.allocated.cpu;
        totalCapacity += resource.capacity.memory / (1024 * 1024);
        totalAllocated += resource.allocated.memory / (1024 * 1024);
        return totalCapacity > 0 ? totalAllocated / totalCapacity : 0;
    }
    calculateEfficiency(allocation) {
        if (!allocation.endTime) return 0;
        const duration = allocation.endTime.getTime() - allocation.startTime.getTime();
        if (duration <= 0) return 0;
        let efficiencySum = 0;
        let factors = 0;
        if (allocation.allocated.cpu > 0) {
            efficiencySum += allocation.actualUsage.cpu / allocation.allocated.cpu;
            factors++;
        }
        if (allocation.allocated.memory > 0) {
            efficiencySum += allocation.actualUsage.memory / allocation.allocated.memory;
            factors++;
        }
        return factors > 0 ? efficiencySum / factors : 1.0;
    }
    updateResourceAvailability(resource) {
        resource.available = {
            cpu: Math.max(0, resource.capacity.cpu - resource.allocated.cpu),
            memory: Math.max(0, resource.capacity.memory - resource.allocated.memory),
            disk: Math.max(0, resource.capacity.disk - resource.allocated.disk),
            network: Math.max(0, resource.capacity.network - resource.allocated.network),
            custom: {}
        };
        for (const [name, capacity] of Object.entries(resource.capacity.custom)){
            const allocated = resource.allocated.custom[name] || 0;
            resource.available.custom[name] = Math.max(0, capacity - allocated);
        }
    }
    addToResourceLimits(target, source) {
        target.cpu += source.cpu;
        target.memory += source.memory;
        target.disk += source.disk;
        target.network += source.network;
        for (const [name, value] of Object.entries(source.custom)){
            target.custom[name] = (target.custom[name] || 0) + value;
        }
    }
    subtractFromResourceLimits(target, source) {
        target.cpu = Math.max(0, target.cpu - source.cpu);
        target.memory = Math.max(0, target.memory - source.memory);
        target.disk = Math.max(0, target.disk - source.disk);
        target.network = Math.max(0, target.network - source.network);
        for (const [name, value] of Object.entries(source.custom)){
            target.custom[name] = Math.max(0, (target.custom[name] || 0) - value);
        }
    }
    createEmptyLimits() {
        return {
            cpu: 0,
            memory: 0,
            disk: 0,
            network: 0,
            custom: {}
        };
    }
    createEmptyUsage() {
        return {
            cpu: 0,
            memory: 0,
            disk: 0,
            network: 0,
            custom: {},
            timestamp: new Date(),
            duration: 0
        };
    }
    createDefaultPerformanceMetrics() {
        return {
            cpuScore: 1.0,
            memoryBandwidth: 1000000000,
            diskIOPS: 1000,
            networkBandwidth: 1000000000,
            benchmarkResults: {}
        };
    }
    createDefaultReliabilityMetrics() {
        return {
            uptime: 0.99,
            meanTimeBetweenFailures: 8760,
            errorRate: 0.01,
            failureHistory: []
        };
    }
    createDefaultCostMetrics() {
        return {
            hourlyRate: 1.0,
            dataTransferCost: 0.1,
            storageCost: 0.1,
            billing: 'hourly'
        };
    }
    createPoolStatistics() {
        return {
            totalResources: 0,
            availableResources: 0,
            utilizationRate: 0,
            allocationSuccessRate: 100,
            averageWaitTime: 0,
            throughput: 0,
            efficiency: 1.0,
            costPerHour: 0,
            qosScore: 100
        };
    }
    async createDefaultPools() {
        const computeResources = Array.from(this.resources.values()).filter((r)=>r.type === 'compute').map((r)=>r.id);
        if (computeResources.length > 0) {
            await this.createResourcePool('default-compute', 'compute', computeResources);
        }
    }
    updateResourceUsage(resourceId, usage) {
        const resource = this.resources.get(resourceId);
        if (!resource) return;
        const history = this.usageHistory.get(resourceId) || [];
        history.push(usage);
        if (history.length > 1000) {
            history.shift();
        }
        this.usageHistory.set(resourceId, history);
        for (const allocation of resource.allocations){
            if (allocation.status === 'active') {
                allocation.actualUsage = usage;
                allocation.efficiency = this.calculateEfficiency(allocation);
            }
        }
    }
    async updateResourceStatistics(resource) {
        const utilization = this.calculateResourceUtilization(resource);
        const history = this.usageHistory.get(resource.id) || [];
        if (history.length > 0) {
            const recent = history.slice(-10);
            const avgCpu = recent.reduce((sum, h)=>sum + h.cpu, 0) / recent.length;
            resource.metadata.performance.cpuScore = Math.max(0.1, 1.0 - avgCpu / 100);
        }
        resource.metadata.lastUpdated = new Date();
    }
    updatePoolStatistics(pool) {
        const resources = pool.resources.map((id)=>this.resources.get(id)).filter(Boolean);
        pool.statistics.totalResources = resources.length;
        pool.statistics.availableResources = resources.filter((r)=>r.status === 'available').length;
        if (resources.length > 0) {
            const totalUtilization = resources.reduce((sum, r)=>sum + this.calculateResourceUtilization(r), 0);
            pool.statistics.utilizationRate = totalUtilization / resources.length;
            const totalCost = resources.reduce((sum, r)=>sum + r.cost, 0);
            pool.statistics.costPerHour = totalCost;
        }
    }
    async checkQoSViolations() {
        for (const allocation of this.allocations.values()){
            if (allocation.status !== 'active') continue;
            const resource = this.resources.get(allocation.resourceId);
            if (!resource) continue;
            const pools = Array.from(this.pools.values()).filter((p)=>p.resources.includes(resource.id));
            for (const pool of pools){
                await this.checkPoolQoS(pool, allocation);
            }
        }
    }
    async checkPoolQoS(pool, allocation) {
        for (const guarantee of pool.qos.guarantees){
            const value = this.getMetricValue(allocation, guarantee.metric);
            const violated = this.evaluateQoSCondition(value, guarantee.operator, guarantee.threshold);
            if (violated) {
                const violation = {
                    timestamp: new Date(),
                    metric: guarantee.metric,
                    expected: guarantee.threshold,
                    actual: value,
                    severity: this.calculateViolationSeverity(guarantee, value),
                    duration: 0,
                    resolved: false
                };
                allocation.qosViolations.push(violation);
                this.logger.warn('QoS violation detected', {
                    allocationId: allocation.id,
                    metric: guarantee.metric,
                    expected: guarantee.threshold,
                    actual: value
                });
                this.emit('qos:violation', {
                    allocation,
                    violation
                });
                if (pool.qos.violations.autoRemediation) {
                    await this.remediateQoSViolation(allocation, violation);
                }
            }
        }
    }
    async updatePredictions() {
        for (const resource of this.resources.values()){
            const history = this.usageHistory.get(resource.id) || [];
            if (history.length < 10) continue;
            const prediction = await this.optimizer.predictUsage(resource, history);
            this.predictions.set(resource.id, prediction);
        }
    }
    calculatePoolMetrics(pool) {
        const resources = pool.resources.map((id)=>this.resources.get(id)).filter(Boolean);
        const metrics = {};
        if (resources.length === 0) return metrics;
        const totalUtilization = resources.reduce((sum, r)=>sum + this.calculateResourceUtilization(r), 0);
        metrics.utilization = totalUtilization / resources.length;
        const totalReservations = resources.reduce((sum, r)=>sum + r.reservations.length, 0);
        metrics.queue_depth = totalReservations;
        return metrics;
    }
    shouldScale(pool, metrics) {
        const scaling = pool.scaling;
        for (const metric of scaling.metrics){
            const value = metrics[metric.name] || 0;
            if (metric.aggregation === 'avg' && value > metric.threshold) {
                if (pool.resources.length < scaling.maxResources) {
                    return {
                        action: 'scale-up',
                        reason: `${metric.name} threshold exceeded`
                    };
                }
            }
        }
        for (const metric of scaling.metrics){
            const value = metrics[metric.name] || 0;
            if (metric.aggregation === 'avg' && value < scaling.scaleDownThreshold) {
                if (pool.resources.length > scaling.minResources) {
                    return {
                        action: 'scale-down',
                        reason: `${metric.name} below threshold`
                    };
                }
            }
        }
        return {
            action: 'none',
            reason: 'No scaling needed'
        };
    }
    async scalePoolUp(pool) {
        this.logger.info('Scaling pool up', {
            poolId: pool.id
        });
        this.emit('pool:scaled-up', {
            pool
        });
    }
    async scalePoolDown(pool) {
        this.logger.info('Scaling pool down', {
            poolId: pool.id
        });
        this.emit('pool:scaled-down', {
            pool
        });
    }
    getMetricValue(allocation, metric) {
        switch(metric){
            case 'cpu':
                return allocation.actualUsage.cpu;
            case 'memory':
                return allocation.actualUsage.memory;
            case 'efficiency':
                return allocation.efficiency;
            default:
                return 0;
        }
    }
    evaluateQoSCondition(value, operator, threshold) {
        switch(operator){
            case 'gt':
                return value > threshold;
            case 'lt':
                return value < threshold;
            case 'eq':
                return value === threshold;
            case 'gte':
                return value >= threshold;
            case 'lte':
                return value <= threshold;
            default:
                return false;
        }
    }
    calculateViolationSeverity(guarantee, actualValue) {
        const deviation = Math.abs(actualValue - guarantee.threshold) / guarantee.threshold;
        if (deviation > 0.5) return 'critical';
        if (deviation > 0.3) return 'high';
        if (deviation > 0.1) return 'medium';
        return 'low';
    }
    async remediateQoSViolation(allocation, violation) {
        this.logger.info('Attempting QoS violation remediation', {
            allocationId: allocation.id,
            metric: violation.metric,
            severity: violation.severity
        });
        switch(violation.metric){
            case 'cpu':
                break;
            case 'memory':
                break;
            case 'efficiency':
                break;
        }
        this.emit('qos:remediation-attempted', {
            allocation,
            violation
        });
    }
    async releaseAllAllocations() {
        const activeAllocations = Array.from(this.allocations.values()).filter((a)=>a.status === 'active');
        for (const allocation of activeAllocations){
            await this.releaseResources(allocation.id, 'system_shutdown');
        }
    }
    handleResourceRequest(data) {
        this.emit('resource:request-received', data);
    }
    handleResourceRelease(data) {
        this.emit('resource:release-received', data);
    }
    handleResourceFailure(data) {
        const resource = this.resources.get(data.resourceId);
        if (resource) {
            resource.status = 'failed';
            resource.metadata.reliability.failureHistory.push({
                timestamp: new Date(),
                type: data.type || 'unknown',
                duration: data.duration || 0,
                impact: data.impact || 'medium',
                resolved: false
            });
            this.logger.error('Resource failure detected', {
                resourceId: data.resourceId,
                type: data.type
            });
            this.emit('resource:failed', {
                resource,
                failure: data
            });
        }
    }
    handleScalingTrigger(data) {
        this.emit('scaling:triggered', data);
    }
    getResource(resourceId) {
        return this.resources.get(resourceId);
    }
    getAllResources() {
        return Array.from(this.resources.values());
    }
    getResourcesByType(type) {
        return Array.from(this.resources.values()).filter((r)=>r.type === type);
    }
    getPool(poolId) {
        return this.pools.get(poolId);
    }
    getAllPools() {
        return Array.from(this.pools.values());
    }
    getReservation(reservationId) {
        return this.reservations.get(reservationId);
    }
    getAllReservations() {
        return Array.from(this.reservations.values());
    }
    getAllocation(allocationId) {
        return this.allocations.get(allocationId);
    }
    getAllAllocations() {
        return Array.from(this.allocations.values());
    }
    getResourceUsageHistory(resourceId) {
        return this.usageHistory.get(resourceId) || [];
    }
    getResourcePrediction(resourceId) {
        return this.predictions.get(resourceId);
    }
    getManagerStatistics() {
        const resources = Array.from(this.resources.values());
        const allocations = Array.from(this.allocations.values());
        const totalCapacity = resources.reduce((sum, r)=>sum + r.capacity.cpu, 0);
        const totalAllocated = resources.reduce((sum, r)=>sum + r.allocated.cpu, 0);
        const activeAllocations = allocations.filter((a)=>a.status === 'active');
        const avgEfficiency = activeAllocations.length > 0 ? activeAllocations.reduce((sum, a)=>sum + a.efficiency, 0) / activeAllocations.length : 1.0;
        return {
            resources: this.resources.size,
            pools: this.pools.size,
            reservations: this.reservations.size,
            allocations: this.allocations.size,
            utilization: totalCapacity > 0 ? totalAllocated / totalCapacity : 0,
            efficiency: avgEfficiency
        };
    }
}
let ResourceOptimizer = class ResourceOptimizer {
    config;
    logger;
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
    }
    async initialize() {
        this.logger.debug('Resource optimizer initialized');
    }
    async shutdown() {
        this.logger.debug('Resource optimizer shutdown');
    }
    async predictUsage(resource, history) {
        const predictions = [];
        const cpuTrend = this.calculateTrend(history.map((h)=>h.cpu));
        const memoryTrend = this.calculateTrend(history.map((h)=>h.memory));
        const diskTrend = this.calculateTrend(history.map((h)=>h.disk));
        for(let i = 1; i <= 24; i++){
            const futureTime = new Date(Date.now() + i * 3600000);
            predictions.push({
                timestamp: futureTime,
                predictedUsage: {
                    cpu: Math.max(0, Math.min(100, this.extrapolateTrend(cpuTrend, i))),
                    memory: Math.max(0, this.extrapolateTrend(memoryTrend, i)),
                    disk: Math.max(0, this.extrapolateTrend(diskTrend, i)),
                    network: 0,
                    custom: {},
                    timestamp: futureTime,
                    duration: 3600000
                },
                confidence: Math.max(0.1, 1.0 - i * 0.05)
            });
        }
        return {
            resourceId: resource.id,
            predictions,
            trends: {
                cpu: this.categorizeTrend(cpuTrend),
                memory: this.categorizeTrend(memoryTrend),
                disk: this.categorizeTrend(diskTrend)
            },
            recommendations: this.generateRecommendations(resource, history)
        };
    }
    calculateTrend(values) {
        if (values.length < 2) {
            return {
                slope: 0,
                intercept: values[0] || 0,
                r2: 0
            };
        }
        const n = values.length;
        const sumX = values.reduce((sum, _, i)=>sum + i, 0);
        const sumY = values.reduce((sum, val)=>sum + val, 0);
        const sumXY = values.reduce((sum, val, i)=>sum + i * val, 0);
        const sumXX = values.reduce((sum, _, i)=>sum + i * i, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        const meanY = sumY / n;
        const ssTotal = values.reduce((sum, val)=>sum + Math.pow(val - meanY, 2), 0);
        const ssRes = values.reduce((sum, val, i)=>{
            const predicted = slope * i + intercept;
            return sum + Math.pow(val - predicted, 2);
        }, 0);
        const r2 = 1 - ssRes / ssTotal;
        return {
            slope,
            intercept,
            r2
        };
    }
    extrapolateTrend(trend, steps) {
        return trend.slope * steps + trend.intercept;
    }
    categorizeTrend(trend) {
        const threshold = 0.1;
        if (trend.slope > threshold) return 'increasing';
        if (trend.slope < -threshold) return 'decreasing';
        return 'stable';
    }
    generateRecommendations(resource, history) {
        const recommendations = [];
        if (history.length === 0) {
            return recommendations;
        }
        const recent = history.slice(-10);
        const avgCpu = recent.reduce((sum, h)=>sum + h.cpu, 0) / recent.length;
        const avgMemory = recent.reduce((sum, h)=>sum + h.memory, 0) / recent.length;
        if (avgCpu > 80) {
            recommendations.push('High CPU usage detected. Consider scaling up or optimizing workloads.');
        } else if (avgCpu < 20) {
            recommendations.push('Low CPU usage. Consider scaling down to reduce costs.');
        }
        const memoryUtilization = avgMemory / resource.capacity.memory;
        if (memoryUtilization > 0.9) {
            recommendations.push('High memory usage. Consider increasing memory allocation.');
        } else if (memoryUtilization < 0.3) {
            recommendations.push('Low memory usage. Consider reducing memory allocation.');
        }
        return recommendations;
    }
};
let ResourceManagerMetrics = class ResourceManagerMetrics {
    allocationsCreated = 0;
    allocationsReleased = 0;
    reservationsFailed = 0;
    qosViolations = 0;
    recordAllocationCreated() {
        this.allocationsCreated++;
    }
    recordAllocationReleased(allocation) {
        this.allocationsReleased++;
    }
    recordReservationFailed() {
        this.reservationsFailed++;
    }
    recordQoSViolation() {
        this.qosViolations++;
    }
    getMetrics() {
        return {
            allocationsCreated: this.allocationsCreated,
            allocationsReleased: this.allocationsReleased,
            reservationsFailed: this.reservationsFailed,
            qosViolations: this.qosViolations,
            successRate: this.allocationsCreated > 0 ? (this.allocationsCreated - this.reservationsFailed) / this.allocationsCreated * 100 : 100
        };
    }
};

//# sourceMappingURL=resource-manager.js.map