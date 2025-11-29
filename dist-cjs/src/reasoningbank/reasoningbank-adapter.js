import * as ReasoningBank from 'agentic-flow/reasoningbank';
import { v4 as uuidv4 } from 'uuid';
let backendInitialized = false;
let initPromise = null;
const queryCache = new Map();
const CACHE_SIZE = 100;
const CACHE_TTL = 60000;
async function ensureInitialized() {
    if (backendInitialized) {
        return true;
    }
    if (initPromise) {
        return initPromise;
    }
    initPromise = (async ()=>{
        try {
            await ReasoningBank.initialize();
            backendInitialized = true;
            console.log('[ReasoningBank] Node.js backend initialized successfully');
            return true;
        } catch (error) {
            const isSqliteError = error.message?.includes('BetterSqlite3 is not a constructor') || error.message?.includes('better-sqlite3') || error.message?.includes('could not run migrations');
            const isNpx = process.env.npm_config_user_agent?.includes('npx') || process.cwd().includes('_npx');
            if (isSqliteError && isNpx) {
                console.error('\n⚠️  NPX LIMITATION DETECTED\n');
                console.error('ReasoningBank requires better-sqlite3, which is not available in npx temp directories.\n');
                console.error('📚 Solutions:\n');
                console.error('  1. LOCAL INSTALL (Recommended):');
                console.error('     npm install && node_modules/.bin/claude-flow memory store "key" "value"\n');
                console.error('  2. USE MCP TOOLS instead:');
                console.error('     mcp__claude-flow__memory_usage({ action: "store", key: "test", value: "data" })\n');
                console.error('  3. USE JSON FALLBACK (automatic):');
                console.error('     Command will continue with JSON storage...\n');
                console.error('See: docs/MEMORY_COMMAND_FIX.md for details\n');
                return false;
            }
            console.error('[ReasoningBank] Backend initialization failed:', error);
            throw new Error(`Failed to initialize ReasoningBank: ${error.message}`);
        }
    })();
    return initPromise;
}
export async function initializeReasoningBank() {
    const result = await ensureInitialized();
    return result;
}
export async function storeMemory(key, value, options = {}) {
    const initialized = await ensureInitialized();
    if (!initialized) {
        throw new Error('ReasoningBank not available (better-sqlite3 missing). Use JSON mode instead.');
    }
    try {
        const memoryId = options.id || uuidv4();
        const memory = {
            id: memoryId,
            type: 'reasoning_memory',
            pattern_data: {
                title: key,
                content: value,
                domain: options.namespace || 'default',
                agent: options.agent || 'memory-agent',
                task_type: options.type || 'fact',
                original_key: key,
                original_value: value,
                namespace: options.namespace || 'default'
            },
            confidence: options.confidence || 0.8,
            usage_count: 0
        };
        ReasoningBank.db.upsertMemory(memory);
        try {
            const embedding = await ReasoningBank.computeEmbedding(value);
            ReasoningBank.db.upsertEmbedding({
                id: memoryId,
                model: 'text-embedding-3-small',
                dims: embedding.length,
                vector: embedding
            });
        } catch (embeddingError) {
            console.warn('[ReasoningBank] Failed to generate embedding:', embeddingError.message);
        }
        queryCache.clear();
        return memoryId;
    } catch (error) {
        console.error('[ReasoningBank] storeMemory failed:', error);
        throw new Error(`Failed to store memory: ${error.message}`);
    }
}
export async function queryMemories(searchQuery, options = {}) {
    const cached = getCachedQuery(searchQuery, options);
    if (cached) {
        return cached;
    }
    const initialized = await ensureInitialized();
    if (!initialized) {
        return [];
    }
    const limit = options.limit || 10;
    const namespace = options.namespace || options.domain || 'default';
    try {
        const results = await ReasoningBank.retrieveMemories(searchQuery, {
            domain: namespace,
            agent: options.agent || 'query-agent',
            k: limit,
            minConfidence: options.minConfidence || 0.3
        });
        const memories = results.map((memory)=>({
                id: memory.id,
                key: memory.title || 'unknown',
                value: memory.content || memory.description || '',
                namespace: namespace,
                confidence: memory.components?.reliability || 0.8,
                usage_count: memory.usage_count || 0,
                created_at: memory.created_at || new Date().toISOString(),
                score: memory.score || 0,
                _pattern: memory
            }));
        if (memories.length === 0) {
            console.warn('[ReasoningBank] Semantic search returned 0 results, trying database fallback');
            const fallbackResults = ReasoningBank.db.fetchMemoryCandidates({
                domain: namespace,
                minConfidence: options.minConfidence || 0.3
            });
            const fallbackMemories = fallbackResults.slice(0, limit).map((memory)=>({
                    id: memory.id,
                    key: memory.pattern_data?.title || memory.pattern_data?.original_key || 'unknown',
                    value: memory.pattern_data?.content || memory.pattern_data?.original_value || '',
                    namespace: memory.pattern_data?.domain || memory.pattern_data?.namespace || 'default',
                    confidence: memory.confidence || 0.8,
                    usage_count: memory.usage_count || 0,
                    created_at: memory.created_at || new Date().toISOString()
                }));
            setCachedQuery(searchQuery, options, fallbackMemories);
            return fallbackMemories;
        }
        setCachedQuery(searchQuery, options, memories);
        return memories;
    } catch (error) {
        console.warn('[ReasoningBank] Query failed, trying database fallback:', error.message);
        try {
            const fallbackResults = ReasoningBank.db.fetchMemoryCandidates({
                domain: namespace,
                minConfidence: options.minConfidence || 0.3
            });
            const fallbackMemories = fallbackResults.slice(0, limit).map((memory)=>({
                    id: memory.id,
                    key: memory.pattern_data?.title || 'unknown',
                    value: memory.pattern_data?.content || '',
                    namespace: memory.pattern_data?.domain || 'default',
                    confidence: memory.confidence || 0.8,
                    usage_count: memory.usage_count || 0,
                    created_at: memory.created_at || new Date().toISOString()
                }));
            setCachedQuery(searchQuery, options, fallbackMemories);
            return fallbackMemories;
        } catch (fallbackError) {
            console.error('[ReasoningBank] All query methods failed:', fallbackError);
            return [];
        }
    }
}
export async function listMemories(options = {}) {
    const initialized = await ensureInitialized();
    if (!initialized) {
        return [];
    }
    const limit = options.limit || 10;
    const namespace = options.namespace;
    try {
        let memories;
        if (namespace && namespace !== 'default') {
            const allMemories = ReasoningBank.db.getAllActiveMemories();
            memories = allMemories.filter((m)=>m.pattern_data?.domain === namespace).slice(0, limit);
        } else {
            memories = ReasoningBank.db.getAllActiveMemories().slice(0, limit);
        }
        return memories.map((memory)=>({
                id: memory.id,
                key: memory.pattern_data?.title || memory.pattern_data?.original_key || 'unknown',
                value: memory.pattern_data?.content || memory.pattern_data?.original_value || '',
                namespace: memory.pattern_data?.domain || memory.pattern_data?.namespace || 'default',
                confidence: memory.confidence || 0.8,
                usage_count: memory.usage_count || 0,
                created_at: memory.created_at || new Date().toISOString()
            }));
    } catch (error) {
        console.error('[ReasoningBank] listMemories failed:', error);
        return [];
    }
}
export async function getStatus() {
    const initialized = await ensureInitialized();
    if (!initialized) {
        return {
            total_memories: 0,
            total_categories: 0,
            storage_backend: 'Unavailable',
            error: 'ReasoningBank initialization failed (better-sqlite3 not available)',
            fallback_available: true
        };
    }
    try {
        const db = ReasoningBank.db.getDb();
        const patterns = db.prepare("SELECT COUNT(*) as count FROM patterns WHERE type = 'reasoning_memory'").get();
        const embeddings = db.prepare("SELECT COUNT(*) as count FROM pattern_embeddings").get();
        const trajectories = db.prepare("SELECT COUNT(*) as count FROM task_trajectories").get();
        const links = db.prepare("SELECT COUNT(*) as count FROM pattern_links").get();
        const avgConf = db.prepare("SELECT AVG(confidence) as avg FROM patterns WHERE type = 'reasoning_memory'").get();
        const domains = db.prepare("SELECT COUNT(DISTINCT json_extract(pattern_data, '$.domain')) as count FROM patterns WHERE type = 'reasoning_memory'").get();
        return {
            total_memories: patterns.count || 0,
            total_categories: domains.count || 0,
            storage_backend: 'SQLite (Node.js)',
            database_path: process.env.CLAUDE_FLOW_DB_PATH || '.swarm/memory.db',
            performance: 'SQLite with persistent storage',
            avg_confidence: avgConf.avg || 0.8,
            total_embeddings: embeddings.count || 0,
            total_trajectories: trajectories.count || 0,
            total_links: links.count || 0
        };
    } catch (error) {
        console.error('[ReasoningBank] getStatus failed:', error);
        return {
            total_memories: 0,
            error: error.message
        };
    }
}
export async function checkReasoningBankTables() {
    try {
        await ensureInitialized();
        const db = ReasoningBank.db.getDb();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern%'").all();
        const tableNames = tables.map((t)=>t.name);
        const requiredTables = [
            'patterns',
            'pattern_embeddings',
            'pattern_links',
            'task_trajectories'
        ];
        const missingTables = requiredTables.filter((t)=>!tableNames.includes(t));
        return {
            exists: true,
            existingTables: tableNames,
            missingTables: missingTables,
            requiredTables: requiredTables,
            backend: 'SQLite (Node.js)',
            note: missingTables.length > 0 ? 'Some tables are missing - run migrations' : 'All tables present'
        };
    } catch (error) {
        return {
            exists: false,
            existingTables: [],
            missingTables: [],
            requiredTables: [],
            error: error.message
        };
    }
}
export async function migrateReasoningBank() {
    try {
        await ReasoningBank.db.runMigrations();
        return {
            success: true,
            message: 'Database migrations completed successfully',
            migrated: true,
            database_path: process.env.CLAUDE_FLOW_DB_PATH || '.swarm/memory.db'
        };
    } catch (error) {
        return {
            success: false,
            message: `Migration failed: ${error.message}`,
            error: error.message
        };
    }
}
function getCachedQuery(searchQuery, options) {
    const cacheKey = JSON.stringify({
        searchQuery,
        options
    });
    const cached = queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.results;
    }
    return null;
}
function setCachedQuery(searchQuery, options, results) {
    const cacheKey = JSON.stringify({
        searchQuery,
        options
    });
    if (queryCache.size >= CACHE_SIZE) {
        const firstKey = queryCache.keys().next().value;
        queryCache.delete(firstKey);
    }
    queryCache.set(cacheKey, {
        results,
        timestamp: Date.now()
    });
}
export function cleanup() {
    try {
        if (backendInitialized) {
            ReasoningBank.clearEmbeddingCache();
            ReasoningBank.db.closeDb();
            backendInitialized = false;
            initPromise = null;
            console.log('[ReasoningBank] Database connection closed');
        }
    } catch (error) {
        console.error('[ReasoningBank] Cleanup failed:', error.message);
    }
}

//# sourceMappingURL=reasoningbank-adapter.js.map