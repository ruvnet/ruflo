export class BaseStrategy {
    metrics;
    taskPatterns;
    cache;
    config;
    constructor(config){
        this.config = config;
        this.metrics = this.initializeMetrics();
        this.taskPatterns = this.initializeTaskPatterns();
        this.cache = new Map();
    }
    initializeMetrics() {
        return {
            tasksCompleted: 0,
            averageExecutionTime: 0,
            successRate: 0,
            resourceUtilization: 0,
            parallelismEfficiency: 0,
            cacheHitRate: 0,
            predictionAccuracy: 0
        };
    }
    initializeTaskPatterns() {
        return [
            {
                pattern: /create|build|implement|develop/i,
                type: 'development',
                complexity: 3,
                estimatedDuration: 15 * 60 * 1000,
                requiredAgents: 2,
                priority: 2
            },
            {
                pattern: /test|verify|validate/i,
                type: 'testing',
                complexity: 2,
                estimatedDuration: 8 * 60 * 1000,
                requiredAgents: 1,
                priority: 1
            },
            {
                pattern: /analyze|research|investigate/i,
                type: 'analysis',
                complexity: 2,
                estimatedDuration: 10 * 60 * 1000,
                requiredAgents: 1,
                priority: 1
            },
            {
                pattern: /document|write|explain/i,
                type: 'documentation',
                complexity: 1,
                estimatedDuration: 5 * 60 * 1000,
                requiredAgents: 1,
                priority: 0
            },
            {
                pattern: /optimize|improve|refactor/i,
                type: 'optimization',
                complexity: 3,
                estimatedDuration: 12 * 60 * 1000,
                requiredAgents: 2,
                priority: 1
            }
        ];
    }
    detectTaskType(description) {
        for (const pattern of this.taskPatterns){
            if (pattern.pattern.test(description)) {
                return pattern.type;
            }
        }
        return 'generic';
    }
    estimateComplexity(description) {
        const pattern = this.taskPatterns.find((p)=>p.pattern.test(description));
        if (pattern) {
            return pattern.complexity;
        }
        let complexity = 1;
        const words = description.split(' ').length;
        if (words > 50) complexity += 1;
        if (words > 100) complexity += 1;
        const complexKeywords = [
            'integrate',
            'complex',
            'advanced',
            'multiple',
            'system'
        ];
        const foundKeywords = complexKeywords.filter((keyword)=>description.toLowerCase().includes(keyword)).length;
        complexity += foundKeywords;
        return Math.min(complexity, 5);
    }
    getCacheKey(objective) {
        return `${objective.strategy}-${objective.description.slice(0, 100)}`;
    }
    updateMetrics(result, executionTime) {
        this.metrics.tasksCompleted += result.tasks.length;
        this.metrics.averageExecutionTime = (this.metrics.averageExecutionTime + executionTime) / 2;
    }
    getMetrics() {
        return {
            ...this.metrics
        };
    }
    clearCache() {
        this.cache.clear();
    }
}

//# sourceMappingURL=base.js.map