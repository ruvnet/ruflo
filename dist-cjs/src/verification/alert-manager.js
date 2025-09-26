export class TruthAlertManager {
    config;
    logger;
    eventBus;
    alertRules = new Map();
    activeAlerts = new Map();
    alertHistory = [];
    alertChannels = new Map();
    suppressions = new Map();
    thresholdGroups = new Map();
    metricStates = new Map();
    processingInterval;
    escalationInterval;
    cleanupInterval;
    statistics;
    constructor(config, logger, eventBus){
        this.config = config;
        this.logger = logger;
        this.eventBus = eventBus;
        this.statistics = this.initializeStatistics();
        this.initializeDefaultRules();
        this.initializeDefaultChannels();
    }
    async initialize() {
        this.logger.info('Initializing Truth Alert Manager', {
            alertEnabled: this.config.alertEnabled,
            thresholds: this.config.alertThresholds
        });
        this.startAlertProcessing();
        this.startEscalationProcessing();
        this.startCleanupProcessing();
        await this.loadAlertConfiguration();
        this.logger.info('Truth Alert Manager initialized successfully', {
            rules: this.alertRules.size,
            channels: this.alertChannels.size
        });
    }
    async shutdown() {
        this.logger.info('Shutting down Truth Alert Manager');
        if (this.processingInterval) clearInterval(this.processingInterval);
        if (this.escalationInterval) clearInterval(this.escalationInterval);
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        await this.saveAlertConfiguration();
        this.logger.info('Truth Alert Manager shutdown complete');
    }
    async checkThresholds(metric) {
        if (!this.config.alertEnabled) return;
        try {
            await this.updateMetricState(metric);
            const applicableRules = this.getApplicableRules(metric);
            for (const rule of applicableRules){
                await this.evaluateRule(rule, metric);
            }
        } catch (error) {
            this.logger.error('Error checking thresholds', {
                metricId: metric.id,
                error
            });
        }
    }
    async updateMetricState(metric) {
        const key = `${metric.agentId}:${metric.metricType}`;
        let state = this.metricStates.get(key);
        if (!state) {
            state = {
                key,
                currentValue: metric.value,
                previousValue: metric.value,
                lastUpdate: metric.timestamp,
                changeRate: 0,
                samples: [
                    metric.value
                ],
                thresholdViolations: new Map()
            };
            this.metricStates.set(key, state);
        } else {
            state.previousValue = state.currentValue;
            state.currentValue = metric.value;
            state.lastUpdate = metric.timestamp;
            const timeDiff = metric.timestamp.getTime() - state.lastUpdate.getTime();
            if (timeDiff > 0) {
                const valueDiff = metric.value - state.previousValue;
                state.changeRate = valueDiff / timeDiff * (60 * 60 * 1000);
            }
            state.samples.push(metric.value);
            if (state.samples.length > 100) {
                state.samples = state.samples.slice(-100);
            }
        }
    }
    getApplicableRules(metric) {
        return Array.from(this.alertRules.values()).filter((rule)=>{
            if (!rule.enabled) return false;
            if (rule.metric !== metric.metricType && rule.metric !== '*') return false;
            if (!this.matchesFilters(metric, rule.filters)) return false;
            if (!this.matchesConditions(metric, rule.conditions)) return false;
            return true;
        });
    }
    async evaluateRule(rule, metric) {
        const key = `${metric.agentId}:${metric.metricType}`;
        const state = this.metricStates.get(key);
        if (!state) return;
        const conditionMet = this.evaluateCondition(rule, metric, state);
        if (conditionMet) {
            await this.handleThresholdViolation(rule, metric, state);
        } else {
            await this.handleThresholdClearance(rule, metric, state);
        }
    }
    evaluateCondition(rule, metric, state) {
        const value = metric.value;
        const threshold = rule.threshold;
        switch(rule.operator){
            case 'gt':
                return value > threshold;
            case 'gte':
                return value >= threshold;
            case 'lt':
                return value < threshold;
            case 'lte':
                return value <= threshold;
            case 'eq':
                return value === threshold;
            case 'ne':
                return value !== threshold;
            case 'change':
                return Math.abs(value - state.previousValue) > threshold;
            case 'rate':
                return Math.abs(state.changeRate) > threshold;
            default:
                return false;
        }
    }
    async handleThresholdViolation(rule, metric, state) {
        const violationKey = `${rule.id}:${state.key}`;
        let violation = state.thresholdViolations.get(violationKey);
        if (!violation) {
            violation = {
                ruleId: rule.id,
                startTime: metric.timestamp,
                lastSeen: metric.timestamp,
                count: 1,
                alertId: null
            };
            state.thresholdViolations.set(violationKey, violation);
        } else {
            violation.lastSeen = metric.timestamp;
            violation.count++;
        }
        const duration = metric.timestamp.getTime() - violation.startTime.getTime();
        if (duration >= rule.duration && !violation.alertId) {
            const alertId = await this.createAlert(rule, metric, violation);
            violation.alertId = alertId;
        }
    }
    async handleThresholdClearance(rule, metric, state) {
        const violationKey = `${rule.id}:${state.key}`;
        const violation = state.thresholdViolations.get(violationKey);
        if (violation && violation.alertId) {
            await this.resolveAlert(violation.alertId, 'threshold_cleared');
        }
        state.thresholdViolations.delete(violationKey);
    }
    async createAlert(rule, metric, violation) {
        const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alert = {
            id: alertId,
            timestamp: new Date(),
            severity: rule.severity,
            type: rule.category,
            message: this.generateAlertMessage(rule, metric),
            source: `agent:${metric.agentId}`,
            context: {
                ruleId: rule.id,
                ruleName: rule.name,
                metricType: metric.metricType,
                metricValue: metric.value,
                threshold: rule.threshold,
                operator: rule.operator,
                duration: violation.lastSeen.getTime() - violation.startTime.getTime(),
                violationCount: violation.count,
                agentId: metric.agentId,
                taskId: metric.taskId,
                ...metric.context
            },
            thresholds: [
                {
                    metric: rule.metric,
                    operator: rule.operator,
                    value: rule.threshold,
                    duration: rule.duration,
                    severity: rule.severity
                }
            ],
            actions: [
                ...rule.actions
            ],
            escalationPath: [
                ...rule.escalationPath
            ],
            resolved: false
        };
        this.activeAlerts.set(alertId, alert);
        this.statistics.totalAlerts++;
        this.statistics.activeAlerts++;
        this.statistics.alertsByType[alert.type] = (this.statistics.alertsByType[alert.type] || 0) + 1;
        this.statistics.alertsBySeverity[alert.severity] = (this.statistics.alertsBySeverity[alert.severity] || 0) + 1;
        this.logger.warn('Truth alert created', {
            alertId,
            rule: rule.name,
            metric: metric.metricType,
            value: metric.value,
            threshold: rule.threshold,
            agent: metric.agentId
        });
        this.addToHistory(alertId, 'created', 'system', {
            rule: rule.name
        });
        this.eventBus.emit('truth-alert:created', {
            alert,
            rule,
            metric
        });
        await this.executeAlertActions(alert);
        return alertId;
    }
    async executeAlertActions(alert) {
        for (const action of alert.actions){
            if (!action.enabled) continue;
            try {
                await this.executeAction(alert, action);
            } catch (error) {
                this.logger.error('Failed to execute alert action', {
                    alertId: alert.id,
                    actionType: action.type,
                    error
                });
            }
        }
    }
    async executeAction(alert, action) {
        switch(action.type){
            case 'notify':
                await this.sendNotification(alert, action);
                break;
            case 'escalate':
                await this.escalateAlert(alert, action);
                break;
            case 'auto-remediate':
                await this.autoRemediate(alert, action);
                break;
            case 'suspend':
                await this.suspendAgent(alert, action);
                break;
            case 'restart':
                await this.restartAgent(alert, action);
                break;
            default:
                this.logger.warn('Unknown alert action type', {
                    type: action.type
                });
        }
    }
    async sendNotification(alert, action) {
        const channelIds = action.config.channels || [
            'default'
        ];
        for (const channelId of channelIds){
            const channel = this.alertChannels.get(channelId);
            if (!channel || !channel.enabled) continue;
            if (!this.alertMatchesChannelFilters(alert, channel)) continue;
            if (!this.checkRateLimit(channel, alert)) continue;
            await this.sendToChannel(alert, channel);
        }
    }
    async sendToChannel(alert, channel) {
        try {
            switch(channel.type){
                case 'email':
                    await this.sendEmailNotification(alert, channel);
                    break;
                case 'slack':
                    await this.sendSlackNotification(alert, channel);
                    break;
                case 'webhook':
                    await this.sendWebhookNotification(alert, channel);
                    break;
                case 'teams':
                    await this.sendTeamsNotification(alert, channel);
                    break;
                case 'discord':
                    await this.sendDiscordNotification(alert, channel);
                    break;
                case 'pagerduty':
                    await this.sendPagerDutyNotification(alert, channel);
                    break;
                default:
                    this.logger.warn('Unknown channel type', {
                        type: channel.type
                    });
            }
            this.logger.info('Alert notification sent', {
                alertId: alert.id,
                channel: channel.name,
                type: channel.type
            });
        } catch (error) {
            this.logger.error('Failed to send notification', {
                alertId: alert.id,
                channel: channel.name,
                error
            });
        }
    }
    async escalateAlert(alert, action) {
        const escalationLevel = action.config.level || 1;
        if (escalationLevel <= alert.escalationLevel) return;
        alert.escalationLevel = escalationLevel;
        const escalation = alert.escalationPath.find((e)=>e.level === escalationLevel);
        if (!escalation) return;
        if (!this.checkEscalationConditions(alert, escalation)) return;
        if (escalationLevel > 1) {
            alert.severity = this.getEscalatedSeverity(alert.severity);
        }
        await this.sendEscalationNotifications(alert, escalation);
        this.addToHistory(alert.id, 'escalated', 'system', {
            level: escalationLevel,
            targets: escalation.targets
        });
        this.statistics.escalationRate = this.calculateEscalationRate();
        this.logger.warn('Alert escalated', {
            alertId: alert.id,
            level: escalationLevel,
            severity: alert.severity
        });
        this.eventBus.emit('truth-alert:escalated', {
            alert,
            escalationLevel
        });
    }
    async sendEscalationNotifications(alert, escalation) {
        for (const target of escalation.targets){
            const channel = this.alertChannels.get(target);
            if (channel && channel.enabled) {
                await this.sendToChannel(alert, channel);
            }
        }
    }
    async autoRemediate(alert, action) {
        const remediationType = action.config.type;
        try {
            switch(remediationType){
                case 'restart_agent':
                    await this.restartAgent(alert, action);
                    break;
                case 'scale_resources':
                    await this.scaleResources(alert, action);
                    break;
                case 'adjust_thresholds':
                    await this.adjustThresholds(alert, action);
                    break;
                case 'redistribute_load':
                    await this.redistributeLoad(alert, action);
                    break;
                case 'failover':
                    await this.initiateFailover(alert, action);
                    break;
                default:
                    this.logger.warn('Unknown remediation type', {
                        type: remediationType
                    });
            }
            this.logger.info('Auto-remediation executed', {
                alertId: alert.id,
                type: remediationType
            });
        } catch (error) {
            this.logger.error('Auto-remediation failed', {
                alertId: alert.id,
                type: remediationType,
                error
            });
        }
    }
    async restartAgent(alert, action) {
        const agentId = alert.context.agentId;
        if (!agentId) return;
        this.eventBus.emit('agent:restart-requested', {
            agentId,
            reason: 'automated_remediation',
            alertId: alert.id
        });
    }
    async suspendAgent(alert, action) {
        const agentId = alert.context.agentId;
        if (!agentId) return;
        this.eventBus.emit('agent:suspend-requested', {
            agentId,
            duration: action.config.duration || 300000,
            reason: 'automated_remediation',
            alertId: alert.id
        });
    }
    async scaleResources(alert, action) {
        this.eventBus.emit('system:scale-requested', {
            direction: action.config.direction || 'up',
            factor: action.config.factor || 1.5,
            reason: 'automated_remediation',
            alertId: alert.id
        });
    }
    async adjustThresholds(alert, action) {
        const ruleId = alert.context.ruleId;
        const rule = this.alertRules.get(ruleId);
        if (rule) {
            const adjustment = action.config.adjustment || 0.1;
            rule.threshold = rule.threshold + rule.threshold * adjustment;
            this.logger.info('Alert threshold adjusted', {
                ruleId,
                oldThreshold: rule.threshold - rule.threshold * adjustment,
                newThreshold: rule.threshold
            });
        }
    }
    async redistributeLoad(alert, action) {
        this.eventBus.emit('load-balancer:redistribute', {
            reason: 'automated_remediation',
            alertId: alert.id,
            excludeAgents: [
                alert.context.agentId
            ]
        });
    }
    async initiateFailover(alert, action) {
        this.eventBus.emit('system:failover-requested', {
            primaryAgent: alert.context.agentId,
            reason: 'automated_remediation',
            alertId: alert.id
        });
    }
    async resolveAlert(alertId, reason, resolvedBy) {
        const alert = this.activeAlerts.get(alertId);
        if (!alert || alert.resolved) return false;
        alert.resolved = true;
        alert.resolvedAt = new Date();
        alert.resolvedBy = resolvedBy || 'system';
        alert.context.resolutionReason = reason;
        this.statistics.activeAlerts--;
        this.statistics.resolvedAlerts++;
        const resolutionTime = alert.resolvedAt.getTime() - alert.timestamp.getTime();
        this.updateAverageResolutionTime(resolutionTime);
        this.addToHistory(alertId, 'resolved', resolvedBy || 'system', {
            reason
        });
        this.logger.info('Alert resolved', {
            alertId,
            reason,
            resolvedBy: resolvedBy || 'system',
            duration: resolutionTime
        });
        this.eventBus.emit('truth-alert:resolved', {
            alert,
            reason,
            resolvedBy
        });
        return true;
    }
    async acknowledgeAlert(alertId, acknowledgedBy, comment) {
        const alert = this.activeAlerts.get(alertId);
        if (!alert || alert.resolved) return false;
        alert.acknowledged = true;
        alert.acknowledgedAt = new Date();
        alert.acknowledgedBy = acknowledgedBy;
        if (comment) {
            alert.context.acknowledgmentComment = comment;
        }
        this.addToHistory(alertId, 'acknowledged', acknowledgedBy, {
            comment
        });
        this.logger.info('Alert acknowledged', {
            alertId,
            acknowledgedBy,
            comment
        });
        this.eventBus.emit('truth-alert:acknowledged', {
            alert,
            acknowledgedBy,
            comment
        });
        return true;
    }
    createAlertRule(rule) {
        const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const fullRule = {
            ...rule,
            id: ruleId,
            createdAt: new Date(),
            lastModified: new Date()
        };
        this.alertRules.set(ruleId, fullRule);
        this.logger.info('Alert rule created', {
            ruleId,
            name: rule.name,
            metric: rule.metric,
            threshold: rule.threshold
        });
        return ruleId;
    }
    updateAlertRule(ruleId, updates) {
        const rule = this.alertRules.get(ruleId);
        if (!rule) return false;
        const updatedRule = {
            ...rule,
            ...updates,
            id: ruleId,
            lastModified: new Date()
        };
        this.alertRules.set(ruleId, updatedRule);
        this.logger.info('Alert rule updated', {
            ruleId,
            updates
        });
        return true;
    }
    deleteAlertRule(ruleId) {
        const deleted = this.alertRules.delete(ruleId);
        if (deleted) {
            this.logger.info('Alert rule deleted', {
                ruleId
            });
        }
        return deleted;
    }
    startAlertProcessing() {
        this.processingInterval = setInterval(()=>{
            this.processActiveAlerts();
        }, 30000);
        this.logger.info('Started alert processing');
    }
    startEscalationProcessing() {
        this.escalationInterval = setInterval(()=>{
            this.processEscalations();
        }, 60000);
        this.logger.info('Started escalation processing');
    }
    startCleanupProcessing() {
        this.cleanupInterval = setInterval(()=>{
            this.cleanupResolvedAlerts();
            this.cleanupOldHistory();
            this.resetRateLimits();
        }, 300000);
        this.logger.info('Started cleanup processing');
    }
    async processAlert(alert) {
        await this.checkAutoResolution(alert);
        await this.checkEscalation(alert);
        this.updateAlertStatistics(alert);
    }
    async processActiveAlerts() {
        for (const alert of this.activeAlerts.values()){
            if (!alert.resolved) {
                await this.processAlert(alert);
            }
        }
    }
    async processEscalations() {
        for (const alert of this.activeAlerts.values()){
            if (!alert.resolved && !alert.acknowledged) {
                await this.checkEscalation(alert);
            }
        }
    }
    async checkAutoResolution(alert) {
        const currentValue = await this.getCurrentMetricValue(alert);
        if (currentValue === null) return;
        const rule = this.alertRules.get(alert.context.ruleId);
        if (!rule) return;
        const conditionMet = this.evaluateConditionValue(rule, currentValue);
        if (!conditionMet) {
            await this.resolveAlert(alert.id, 'condition_resolved');
        }
    }
    async checkEscalation(alert) {
        const now = Date.now();
        const alertAge = now - alert.timestamp.getTime();
        const nextEscalation = alert.escalationPath.find((e)=>e.level > alert.escalationLevel);
        if (nextEscalation && alertAge >= nextEscalation.delay) {
            await this.escalateAlert(alert, {
                type: 'escalate',
                target: 'escalation',
                config: {
                    level: nextEscalation.level
                },
                enabled: true
            });
        }
    }
    generateAlertMessage(rule, metric) {
        return `${rule.name}: ${metric.metricType} ${rule.operator} ${rule.threshold} ` + `(current: ${metric.value.toFixed(3)}) for agent ${metric.agentId}`;
    }
    matchesFilters(metric, filters) {
        for (const [key, value] of Object.entries(filters)){
            const metricValue = this.getMetricProperty(metric, key);
            if (metricValue !== value) return false;
        }
        return true;
    }
    matchesConditions(metric, conditions) {
        if (conditions.length === 0) return true;
        let result = true;
        let currentOperator = 'AND';
        for (const condition of conditions){
            const metricValue = this.getMetricProperty(metric, condition.field);
            const conditionResult = this.evaluateConditionValue(condition, metricValue);
            if (currentOperator === 'AND') {
                result = result && conditionResult;
            } else {
                result = result || conditionResult;
            }
            currentOperator = condition.logicalOperator || 'AND';
        }
        return result;
    }
    getMetricProperty(metric, path) {
        const parts = path.split('.');
        let value = metric;
        for (const part of parts){
            value = value?.[part];
        }
        return value;
    }
    evaluateConditionValue(condition, value) {
        switch(condition.operator){
            case 'gt':
                return value > condition.value;
            case 'gte':
                return value >= condition.value;
            case 'lt':
                return value < condition.value;
            case 'lte':
                return value <= condition.value;
            case 'eq':
                return value === condition.value;
            case 'ne':
                return value !== condition.value;
            case 'contains':
                return String(value).includes(condition.value);
            case 'startsWith':
                return String(value).startsWith(condition.value);
            case 'endsWith':
                return String(value).endsWith(condition.value);
            default:
                return false;
        }
    }
    alertMatchesChannelFilters(alert, channel) {
        for (const filter of channel.filters){
            const alertValue = this.getMetricProperty(alert, filter.field);
            const matches = filter.values.includes(String(alertValue));
            if (filter.action === 'include' && !matches) return false;
            if (filter.action === 'exclude' && matches) return false;
        }
        return true;
    }
    checkRateLimit(channel, alert) {
        for (const rateLimit of channel.rateLimits){
            const now = Date.now();
            if (rateLimit.resetTime && now > rateLimit.resetTime.getTime()) {
                rateLimit.currentCount = 0;
                rateLimit.resetTime = new Date(now + rateLimit.window);
            }
            if (!rateLimit.resetTime) {
                rateLimit.resetTime = new Date(now + rateLimit.window);
                rateLimit.currentCount = 0;
            }
            if (rateLimit.currentCount >= rateLimit.maxAlerts) {
                return false;
            }
            rateLimit.currentCount++;
        }
        return true;
    }
    checkEscalationConditions(alert, escalation) {
        for (const condition of escalation.conditions){
            if (condition.includes('unacknowledged') && alert.acknowledged) return false;
            if (condition.includes('duration') && !this.checkDurationCondition(alert, condition)) return false;
        }
        return true;
    }
    checkDurationCondition(alert, condition) {
        const match = condition.match(/duration\s*([><=]+)\s*(\d+)([mhs])/);
        if (!match) return true;
        const operator = match[1];
        const value = parseInt(match[2]);
        const unit = match[3];
        const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
        const thresholdMs = value * multiplier;
        const durationMs = Date.now() - alert.timestamp.getTime();
        switch(operator){
            case '>':
                return durationMs > thresholdMs;
            case '>=':
                return durationMs >= thresholdMs;
            case '<':
                return durationMs < thresholdMs;
            case '<=':
                return durationMs <= thresholdMs;
            case '=':
                return Math.abs(durationMs - thresholdMs) < 1000;
            default:
                return true;
        }
    }
    getEscalatedSeverity(currentSeverity) {
        switch(currentSeverity){
            case 'info':
                return 'warning';
            case 'warning':
                return 'critical';
            case 'critical':
                return 'emergency';
            default:
                return 'emergency';
        }
    }
    async getCurrentMetricValue(alert) {
        return null;
    }
    addToHistory(alertId, action, actor, details) {
        this.alertHistory.push({
            alertId,
            timestamp: new Date(),
            action: action,
            actor,
            details
        });
        if (this.alertHistory.length > 10000) {
            this.alertHistory = this.alertHistory.slice(-5000);
        }
    }
    cleanupResolvedAlerts() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for (const [alertId, alert] of this.activeAlerts){
            if (alert.resolved && alert.resolvedAt && alert.resolvedAt < cutoff) {
                this.activeAlerts.delete(alertId);
            }
        }
    }
    cleanupOldHistory() {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        this.alertHistory = this.alertHistory.filter((h)=>h.timestamp >= cutoff);
    }
    resetRateLimits() {
        const now = Date.now();
        for (const channel of this.alertChannels.values()){
            for (const rateLimit of channel.rateLimits){
                if (rateLimit.resetTime && now > rateLimit.resetTime.getTime()) {
                    rateLimit.currentCount = 0;
                    rateLimit.resetTime = new Date(now + rateLimit.window);
                }
            }
        }
    }
    updateAlertStatistics(alert) {
        const source = alert.source;
        const existing = this.statistics.topAlertSources.find((s)=>s.source === source);
        if (existing) {
            existing.count++;
        } else {
            this.statistics.topAlertSources.push({
                source,
                count: 1
            });
        }
        this.statistics.topAlertSources.sort((a, b)=>b.count - a.count);
        this.statistics.topAlertSources = this.statistics.topAlertSources.slice(0, 10);
    }
    updateAverageResolutionTime(resolutionTime) {
        const count = this.statistics.resolvedAlerts;
        const currentAvg = this.statistics.averageResolutionTime;
        this.statistics.averageResolutionTime = (currentAvg * (count - 1) + resolutionTime) / count;
    }
    calculateEscalationRate() {
        const escalatedAlerts = this.alertHistory.filter((h)=>h.action === 'escalated').length;
        return this.statistics.totalAlerts > 0 ? escalatedAlerts / this.statistics.totalAlerts : 0;
    }
    async sendEmailNotification(alert, channel) {
        this.logger.info('Email notification sent', {
            alertId: alert.id,
            to: channel.config.to
        });
    }
    async sendSlackNotification(alert, channel) {
        this.logger.info('Slack notification sent', {
            alertId: alert.id,
            webhook: channel.config.webhook
        });
    }
    async sendWebhookNotification(alert, channel) {
        this.logger.info('Webhook notification sent', {
            alertId: alert.id,
            url: channel.config.url
        });
    }
    async sendTeamsNotification(alert, channel) {
        this.logger.info('Teams notification sent', {
            alertId: alert.id,
            webhook: channel.config.webhook
        });
    }
    async sendDiscordNotification(alert, channel) {
        this.logger.info('Discord notification sent', {
            alertId: alert.id,
            webhook: channel.config.webhook
        });
    }
    async sendPagerDutyNotification(alert, channel) {
        this.logger.info('PagerDuty notification sent', {
            alertId: alert.id,
            serviceKey: channel.config.serviceKey
        });
    }
    async loadAlertConfiguration() {
        this.logger.debug('Loading alert configuration');
    }
    async saveAlertConfiguration() {
        this.logger.debug('Saving alert configuration');
    }
    initializeDefaultRules() {
        const defaultRules = [
            {
                name: 'Low Truth Accuracy',
                description: 'Alert when agent accuracy falls below threshold',
                enabled: true,
                metric: 'accuracy',
                operator: 'lt',
                threshold: this.config.alertThresholds.accuracyThreshold,
                duration: 300000,
                severity: 'critical',
                category: 'accuracy_degradation',
                priority: 8,
                filters: {},
                conditions: [],
                actions: [
                    {
                        type: 'notify',
                        target: 'default',
                        config: {
                            channels: [
                                'default'
                            ]
                        },
                        enabled: true
                    }
                ],
                escalationPath: [
                    {
                        level: 1,
                        delay: 900000,
                        targets: [
                            'critical'
                        ],
                        conditions: [
                            'unacknowledged'
                        ]
                    }
                ],
                suppressions: [],
                tags: {
                    category: 'accuracy',
                    auto_created: 'true'
                },
                createdBy: 'system'
            },
            {
                name: 'High Human Intervention Rate',
                description: 'Alert when human intervention rate exceeds threshold',
                enabled: true,
                metric: '*',
                operator: 'gt',
                threshold: this.config.alertThresholds.interventionRateThreshold,
                duration: 600000,
                severity: 'warning',
                category: 'high_intervention_rate',
                priority: 6,
                filters: {
                    'context.verificationMethod': 'human'
                },
                conditions: [],
                actions: [
                    {
                        type: 'notify',
                        target: 'default',
                        config: {
                            channels: [
                                'default'
                            ]
                        },
                        enabled: true
                    }
                ],
                escalationPath: [],
                suppressions: [],
                tags: {
                    category: 'efficiency',
                    auto_created: 'true'
                },
                createdBy: 'system'
            }
        ];
        defaultRules.forEach((rule)=>this.createAlertRule(rule));
    }
    initializeDefaultChannels() {
        const defaultChannels = [
            {
                name: 'Default Log Channel',
                type: 'email',
                config: {
                    to: 'admin@example.com'
                },
                enabled: true,
                filters: [],
                rateLimits: [
                    {
                        window: 300000,
                        maxAlerts: 10,
                        currentCount: 0
                    }
                ]
            },
            {
                name: 'Critical Alerts',
                type: 'slack',
                config: {
                    webhook: 'https://hooks.slack.com/services/...'
                },
                enabled: false,
                filters: [
                    {
                        field: 'severity',
                        operator: 'eq',
                        values: [
                            'critical',
                            'emergency'
                        ],
                        action: 'include'
                    }
                ],
                rateLimits: [
                    {
                        window: 60000,
                        maxAlerts: 5,
                        currentCount: 0
                    }
                ]
            }
        ];
        defaultChannels.forEach((channel)=>{
            const channelId = `channel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            this.alertChannels.set(channelId, {
                ...channel,
                id: channelId
            });
        });
    }
    initializeStatistics() {
        return {
            totalAlerts: 0,
            activeAlerts: 0,
            resolvedAlerts: 0,
            averageResolutionTime: 0,
            alertsByType: {},
            alertsBySeverity: {},
            topAlertSources: [],
            escalationRate: 0,
            falsePositiveRate: 0
        };
    }
    getActiveAlerts() {
        return Array.from(this.activeAlerts.values()).filter((a)=>!a.resolved);
    }
    getAlert(alertId) {
        return this.activeAlerts.get(alertId);
    }
    getAlertHistory(alertId, limit = 100) {
        let history = this.alertHistory;
        if (alertId) {
            history = history.filter((h)=>h.alertId === alertId);
        }
        return history.slice(-limit);
    }
    getAlertRules() {
        return Array.from(this.alertRules.values());
    }
    getAlertChannels() {
        return Array.from(this.alertChannels.values());
    }
    getStatistics() {
        return {
            ...this.statistics
        };
    }
    createSuppression(alertId, suppression) {
        const suppressionId = `suppression-${Date.now()}`;
        this.suppressions.set(suppressionId, {
            ...suppression,
            id: suppressionId
        });
        return suppressionId;
    }
    removeSuppression(suppressionId) {
        return this.suppressions.delete(suppressionId);
    }
}

//# sourceMappingURL=alert-manager.js.map