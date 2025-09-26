export * from './coordinator.js';
export * from './executor.js';
export * from './types.js';
export * from './strategies/base.js';
export * from './strategies/auto.js';
export * from './strategies/research.js';
export * from './memory.js';
export * from './prompt-copier.js';
export * from './prompt-copier-enhanced.js';
export * from './prompt-utils.js';
export * from './prompt-manager.js';
export * from './prompt-cli.js';
export * from './optimizations/index.js';
export function getSwarmComponents() {
    return {
        coordinator: ()=>import('./coordinator.js'),
        executor: ()=>import('./executor.js'),
        types: ()=>import('./types.js'),
        strategies: {
            base: ()=>import('./strategies/base.js'),
            auto: ()=>import('./strategies/auto.js'),
            research: ()=>import('./strategies/research.js')
        },
        memory: ()=>import('./memory.js'),
        promptCopier: ()=>import('./prompt-copier.js'),
        promptCopierEnhanced: ()=>import('./prompt-copier-enhanced.js'),
        promptUtils: ()=>import('./prompt-utils.js'),
        promptManager: ()=>import('./prompt-manager.js'),
        promptCli: ()=>import('./prompt-cli.js'),
        optimizations: ()=>import('./optimizations/index.js')
    };
}

//# sourceMappingURL=index.js.map