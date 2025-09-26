import { readFileSync, existsSync } from 'node:fs';
import { glob } from 'glob';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
const LEGACY_AGENT_MAPPING = {
    analyst: 'code-analyzer',
    coordinator: 'task-orchestrator',
    optimizer: 'perf-analyzer',
    documenter: 'api-docs',
    monitor: 'performance-benchmarker',
    specialist: 'system-architect',
    architect: 'system-architect'
};
function resolveLegacyAgentType(legacyType) {
    return LEGACY_AGENT_MAPPING[legacyType] || legacyType;
}
let AgentLoader = class AgentLoader {
    agentCache = new Map();
    categoriesCache = [];
    lastLoadTime = 0;
    cacheExpiry = 60000;
    getAgentsDirectory() {
        let currentDir = process.cwd();
        while(currentDir !== '/'){
            const claudeAgentsPath = resolve(currentDir, '.claude', 'agents');
            if (existsSync(claudeAgentsPath)) {
                return claudeAgentsPath;
            }
            currentDir = dirname(currentDir);
        }
        return resolve(process.cwd(), '.claude', 'agents');
    }
    parseAgentFile(filePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (!frontmatterMatch) {
                console.warn(`No frontmatter found in ${filePath}`);
                return null;
            }
            const [, yamlContent, markdownContent] = frontmatterMatch;
            const frontmatter = parseYaml(yamlContent);
            if (!frontmatter.name || !frontmatter.metadata?.description) {
                console.warn(`Missing required fields (name, metadata.description) in ${filePath}`);
                return null;
            }
            return {
                name: frontmatter.name,
                type: frontmatter.type,
                color: frontmatter.color,
                description: frontmatter.metadata.description,
                capabilities: frontmatter.metadata.capabilities || frontmatter.capabilities || [],
                priority: frontmatter.priority || 'medium',
                hooks: frontmatter.hooks,
                content: markdownContent.trim()
            };
        } catch (error) {
            console.error(`Error parsing agent file ${filePath}:`, error);
            return null;
        }
    }
    async loadAgents() {
        const agentsDir = this.getAgentsDirectory();
        if (!existsSync(agentsDir)) {
            console.warn(`Agents directory not found: ${agentsDir}`);
            return;
        }
        const agentFiles = await glob('**/*.md', {
            cwd: agentsDir,
            ignore: [
                '**/README.md',
                '**/MIGRATION_SUMMARY.md'
            ],
            absolute: true
        });
        this.agentCache.clear();
        this.categoriesCache = [];
        const categoryMap = new Map();
        for (const filePath of agentFiles){
            const agent = this.parseAgentFile(filePath);
            if (agent) {
                this.agentCache.set(agent.name, agent);
                const relativePath = filePath.replace(agentsDir, '');
                const pathParts = relativePath.split('/');
                const category = pathParts[1] || 'uncategorized';
                if (!categoryMap.has(category)) {
                    categoryMap.set(category, []);
                }
                categoryMap.get(category).push(agent);
            }
        }
        this.categoriesCache = Array.from(categoryMap.entries()).map(([name, agents])=>({
                name,
                agents: agents.sort((a, b)=>a.name.localeCompare(b.name))
            }));
        this.lastLoadTime = Date.now();
    }
    needsRefresh() {
        return Date.now() - this.lastLoadTime > this.cacheExpiry;
    }
    async ensureLoaded() {
        if (this.agentCache.size === 0 || this.needsRefresh()) {
            await this.loadAgents();
        }
    }
    async getAvailableAgentTypes() {
        await this.ensureLoaded();
        const currentTypes = Array.from(this.agentCache.keys());
        const legacyTypes = Object.keys(LEGACY_AGENT_MAPPING);
        const combined = [
            ...currentTypes,
            ...legacyTypes
        ];
        const uniqueTypes = Array.from(new Set(combined));
        return uniqueTypes.sort();
    }
    async getAgent(name) {
        await this.ensureLoaded();
        return this.agentCache.get(name) || this.agentCache.get(resolveLegacyAgentType(name)) || null;
    }
    async getAllAgents() {
        await this.ensureLoaded();
        return Array.from(this.agentCache.values()).sort((a, b)=>a.name.localeCompare(b.name));
    }
    async getAgentCategories() {
        await this.ensureLoaded();
        return this.categoriesCache;
    }
    async searchAgents(query) {
        await this.ensureLoaded();
        const lowerQuery = query.toLowerCase();
        return Array.from(this.agentCache.values()).filter((agent)=>{
            return agent.name.toLowerCase().includes(lowerQuery) || agent.description.toLowerCase().includes(lowerQuery) || agent.capabilities?.some((cap)=>cap.toLowerCase().includes(lowerQuery)) || false;
        });
    }
    async isValidAgentType(name) {
        await this.ensureLoaded();
        return this.agentCache.has(name) || this.agentCache.has(resolveLegacyAgentType(name));
    }
    async getAgentsByCategory(category) {
        const categories = await this.getAgentCategories();
        const found = categories.find((cat)=>cat.name === category);
        return found?.agents || [];
    }
    async refresh() {
        this.lastLoadTime = 0;
        await this.loadAgents();
    }
};
export const agentLoader = new AgentLoader();
export const getAvailableAgentTypes = ()=>agentLoader.getAvailableAgentTypes();
export const getAgent = (name)=>agentLoader.getAgent(name);
export const getAllAgents = ()=>agentLoader.getAllAgents();
export const getAgentCategories = ()=>agentLoader.getAgentCategories();
export const searchAgents = (query)=>agentLoader.searchAgents(query);
export const isValidAgentType = (name)=>agentLoader.isValidAgentType(name);
export const getAgentsByCategory = (category)=>agentLoader.getAgentsByCategory(category);
export const refreshAgents = ()=>agentLoader.refresh();
export { resolveLegacyAgentType, LEGACY_AGENT_MAPPING };

//# sourceMappingURL=agent-loader.js.map