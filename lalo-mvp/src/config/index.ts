import { config } from 'dotenv';
import { LALOConfig } from '../types/index.js';

config();

export const defaultConfig: LALOConfig = {
  langgraph: {
    maxRetries: 3,
    timeout: 30000,
    enableLogging: process.env.NODE_ENV !== 'production'
  },
  governance: {
    votingPeriod: 24 * 60 * 60 * 1000, // 24 hours
    quorumThreshold: 0.1, // 10%
    proposalThreshold: 1, // Minimum voting power to propose
    executionDelay: 2 * 60 * 60 * 1000, // 2 hours
    supermajorityThreshold: 0.67, // 67% for critical proposals
    multiSigThreshold: 3, // Minimum signatures for critical changes
    delegationEnabled: true,
    maxDelegationDepth: 3,
    enableMCPIntegration: process.env.GOVERNANCE_MCP_INTEGRATION === 'true'
  },
  mcp: {
    port: parseInt(process.env.MCP_PORT || '3001'),
    host: process.env.MCP_HOST || 'localhost',
    enableAuth: process.env.MCP_ENABLE_AUTH === 'true',
    maxConnections: parseInt(process.env.MCP_MAX_CONNECTIONS || '100')
  },
  rag: {
    vectorStore: (process.env.VECTOR_STORE as any) || 'chroma',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200'),
    topK: parseInt(process.env.RAG_TOP_K || '5')
  },
  nl2sql: {
    model: process.env.NL2SQL_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.NL2SQL_TEMPERATURE || '0.1'),
    maxTokens: parseInt(process.env.NL2SQL_MAX_TOKENS || '1000'),
    enableValidation: process.env.NL2SQL_ENABLE_VALIDATION !== 'false'
  }
};

export const getConfig = (): LALOConfig => {
  return defaultConfig;
};

export const validateEnvironment = (): void => {
  const required = [
    'OPENAI_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Database configuration
export const dbConfig = {
  filename: process.env.DB_PATH || './data/lalo.db',
  memory: process.env.DB_MEMORY === 'true'
};

// Chroma configuration
export const chromaConfig = {
  host: process.env.CHROMA_HOST || 'localhost',
  port: parseInt(process.env.CHROMA_PORT || '8000'),
  path: process.env.CHROMA_PATH || '/api/v1'
};

// Security configuration
export const securityConfig = {
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12')
};

export default defaultConfig;