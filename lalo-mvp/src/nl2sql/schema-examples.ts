import { TableSchema, ColumnInfo, Relationship } from '../types/index.js';

/**
 * Example database schemas for the LALO MVP system
 */

export const USERS_SCHEMA: TableSchema = {
  name: 'users',
  description: 'System users with authentication and profile information',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique user identifier'
    },
    {
      name: 'email',
      type: 'VARCHAR(255)',
      nullable: false,
      primaryKey: false,
      description: 'User email address (unique)'
    },
    {
      name: 'username',
      type: 'VARCHAR(100)',
      nullable: false,
      primaryKey: false,
      description: 'Unique username for the user'
    },
    {
      name: 'full_name',
      type: 'VARCHAR(255)',
      nullable: true,
      primaryKey: false,
      description: 'Full display name of the user'
    },
    {
      name: 'password_hash',
      type: 'VARCHAR(255)',
      nullable: false,
      primaryKey: false,
      description: 'Hashed password for authentication'
    },
    {
      name: 'role',
      type: 'VARCHAR(50)',
      nullable: false,
      primaryKey: false,
      description: 'User role (admin, user, viewer, etc.)'
    },
    {
      name: 'status',
      type: 'VARCHAR(20)',
      nullable: false,
      primaryKey: false,
      description: 'Account status (active, inactive, suspended)'
    },
    {
      name: 'voting_power',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Governance voting power for this user'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Account creation timestamp'
    },
    {
      name: 'updated_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Last account update timestamp'
    },
    {
      name: 'last_login',
      type: 'TIMESTAMP',
      nullable: true,
      primaryKey: false,
      description: 'Last login timestamp'
    }
  ],
  relationships: []
};

export const WORKFLOWS_SCHEMA: TableSchema = {
  name: 'workflows',
  description: 'LangGraph workflow definitions and execution metadata',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique workflow identifier'
    },
    {
      name: 'name',
      type: 'VARCHAR(255)',
      nullable: false,
      primaryKey: false,
      description: 'Human-readable workflow name'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: true,
      primaryKey: false,
      description: 'Detailed workflow description'
    },
    {
      name: 'definition',
      type: 'JSON',
      nullable: false,
      primaryKey: false,
      description: 'LangGraph workflow definition (nodes, edges, etc.)'
    },
    {
      name: 'status',
      type: 'VARCHAR(20)',
      nullable: false,
      primaryKey: false,
      description: 'Workflow status (draft, active, deprecated, failed)'
    },
    {
      name: 'version',
      type: 'VARCHAR(20)',
      nullable: false,
      primaryKey: false,
      description: 'Workflow version number'
    },
    {
      name: 'created_by',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User who created this workflow'
    },
    {
      name: 'execution_count',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Number of times this workflow has been executed'
    },
    {
      name: 'success_rate',
      type: 'DECIMAL(5,2)',
      nullable: false,
      primaryKey: false,
      description: 'Success rate percentage (0.00-100.00)'
    },
    {
      name: 'average_duration',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      description: 'Average execution duration in milliseconds'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Workflow creation timestamp'
    },
    {
      name: 'updated_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Last workflow update timestamp'
    }
  ],
  relationships: [
    {
      table: 'workflows',
      column: 'created_by',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    }
  ]
};

export const PROPOSALS_SCHEMA: TableSchema = {
  name: 'proposals',
  description: 'Governance proposals for system changes and decisions',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique proposal identifier'
    },
    {
      name: 'title',
      type: 'VARCHAR(255)',
      nullable: false,
      primaryKey: false,
      description: 'Proposal title'
    },
    {
      name: 'description',
      type: 'TEXT',
      nullable: false,
      primaryKey: false,
      description: 'Detailed proposal description'
    },
    {
      name: 'proposer_id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User who created the proposal'
    },
    {
      name: 'type',
      type: 'VARCHAR(50)',
      nullable: false,
      primaryKey: false,
      description: 'Proposal type (workflow, config, governance, emergency, upgrade)'
    },
    {
      name: 'category',
      type: 'VARCHAR(50)',
      nullable: false,
      primaryKey: false,
      description: 'Proposal category (standard, critical, constitutional)'
    },
    {
      name: 'status',
      type: 'VARCHAR(20)',
      nullable: false,
      primaryKey: false,
      description: 'Current status (draft, active, passed, rejected, executed, queued, expired)'
    },
    {
      name: 'execution_data',
      type: 'JSON',
      nullable: true,
      primaryKey: false,
      description: 'Data required for proposal execution'
    },
    {
      name: 'votes_for',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Total voting power in favor'
    },
    {
      name: 'votes_against',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Total voting power against'
    },
    {
      name: 'votes_abstain',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Total voting power abstaining'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Proposal creation timestamp'
    },
    {
      name: 'voting_ends_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Voting period end timestamp'
    },
    {
      name: 'executed_at',
      type: 'TIMESTAMP',
      nullable: true,
      primaryKey: false,
      description: 'Proposal execution timestamp'
    }
  ],
  relationships: [
    {
      table: 'proposals',
      column: 'proposer_id',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    }
  ]
};

export const VOTES_SCHEMA: TableSchema = {
  name: 'votes',
  description: 'Individual votes cast on governance proposals',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique vote identifier'
    },
    {
      name: 'proposal_id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      foreignKey: 'proposals.id',
      description: 'Proposal being voted on'
    },
    {
      name: 'voter_id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User casting the vote'
    },
    {
      name: 'choice',
      type: 'VARCHAR(10)',
      nullable: false,
      primaryKey: false,
      description: 'Vote choice (for, against, abstain)'
    },
    {
      name: 'weight',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Voting power weight of this vote'
    },
    {
      name: 'reason',
      type: 'TEXT',
      nullable: true,
      primaryKey: false,
      description: 'Optional reason for the vote'
    },
    {
      name: 'delegated_from',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User who delegated their vote (if applicable)'
    },
    {
      name: 'signature',
      type: 'VARCHAR(255)',
      nullable: true,
      primaryKey: false,
      description: 'Cryptographic signature of the vote'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Vote timestamp'
    }
  ],
  relationships: [
    {
      table: 'votes',
      column: 'proposal_id',
      referencedTable: 'proposals',
      referencedColumn: 'id',
      type: 'many-to-one'
    },
    {
      table: 'votes',
      column: 'voter_id',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    },
    {
      table: 'votes',
      column: 'delegated_from',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    }
  ]
};

export const DOCUMENTS_SCHEMA: TableSchema = {
  name: 'documents',
  description: 'RAG system documents and embeddings',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique document identifier'
    },
    {
      name: 'title',
      type: 'VARCHAR(255)',
      nullable: false,
      primaryKey: false,
      description: 'Document title'
    },
    {
      name: 'content',
      type: 'TEXT',
      nullable: false,
      primaryKey: false,
      description: 'Full document content'
    },
    {
      name: 'source',
      type: 'VARCHAR(255)',
      nullable: true,
      primaryKey: false,
      description: 'Document source (file, url, api, etc.)'
    },
    {
      name: 'document_type',
      type: 'VARCHAR(50)',
      nullable: false,
      primaryKey: false,
      description: 'Type of document (schema, example, documentation, etc.)'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: true,
      primaryKey: false,
      description: 'Additional document metadata'
    },
    {
      name: 'chunk_count',
      type: 'INTEGER',
      nullable: false,
      primaryKey: false,
      description: 'Number of chunks this document was split into'
    },
    {
      name: 'embedding_model',
      type: 'VARCHAR(100)',
      nullable: false,
      primaryKey: false,
      description: 'Model used for generating embeddings'
    },
    {
      name: 'created_by',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User who added this document'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Document creation timestamp'
    },
    {
      name: 'updated_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Last document update timestamp'
    }
  ],
  relationships: [
    {
      table: 'documents',
      column: 'created_by',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    }
  ]
};

export const QUERY_HISTORY_SCHEMA: TableSchema = {
  name: 'query_history',
  description: 'NL2SQL query history and performance metrics',
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      description: 'Unique query history identifier'
    },
    {
      name: 'natural_language',
      type: 'TEXT',
      nullable: false,
      primaryKey: false,
      description: 'Original natural language query'
    },
    {
      name: 'generated_sql',
      type: 'TEXT',
      nullable: false,
      primaryKey: false,
      description: 'Generated SQL query'
    },
    {
      name: 'confidence',
      type: 'DECIMAL(5,2)',
      nullable: false,
      primaryKey: false,
      description: 'Confidence score (0.00-1.00)'
    },
    {
      name: 'tables_used',
      type: 'JSON',
      nullable: false,
      primaryKey: false,
      description: 'List of tables used in the query'
    },
    {
      name: 'execution_time',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      description: 'Query execution time in milliseconds'
    },
    {
      name: 'result_count',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      description: 'Number of rows returned'
    },
    {
      name: 'success',
      type: 'BOOLEAN',
      nullable: false,
      primaryKey: false,
      description: 'Whether the query executed successfully'
    },
    {
      name: 'error_message',
      type: 'TEXT',
      nullable: true,
      primaryKey: false,
      description: 'Error message if query failed'
    },
    {
      name: 'user_id',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      foreignKey: 'users.id',
      description: 'User who executed the query'
    },
    {
      name: 'metadata',
      type: 'JSON',
      nullable: true,
      primaryKey: false,
      description: 'Additional query metadata (intent, entities, etc.)'
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      nullable: false,
      primaryKey: false,
      description: 'Query execution timestamp'
    }
  ],
  relationships: [
    {
      table: 'query_history',
      column: 'user_id',
      referencedTable: 'users',
      referencedColumn: 'id',
      type: 'many-to-one'
    }
  ]
};

/**
 * Get all example schemas
 */
export function getAllSchemas(): Map<string, TableSchema> {
  const schemas = new Map<string, TableSchema>();

  schemas.set('users', USERS_SCHEMA);
  schemas.set('workflows', WORKFLOWS_SCHEMA);
  schemas.set('proposals', PROPOSALS_SCHEMA);
  schemas.set('votes', VOTES_SCHEMA);
  schemas.set('documents', DOCUMENTS_SCHEMA);
  schemas.set('query_history', QUERY_HISTORY_SCHEMA);

  return schemas;
}

/**
 * Get common query examples for testing
 */
export function getQueryExamples(): Array<{
  naturalLanguage: string;
  expectedTables: string[];
  intent: string;
  description: string;
}> {
  return [
    {
      naturalLanguage: "Show all users",
      expectedTables: ["users"],
      intent: "SELECT",
      description: "Basic table query"
    },
    {
      naturalLanguage: "Find users with admin role",
      expectedTables: ["users"],
      intent: "SELECT",
      description: "Filtered query with WHERE clause"
    },
    {
      naturalLanguage: "Count how many active proposals there are",
      expectedTables: ["proposals"],
      intent: "AGGREGATE",
      description: "Aggregation query with filter"
    },
    {
      naturalLanguage: "Show workflows created by John Doe",
      expectedTables: ["workflows", "users"],
      intent: "JOIN",
      description: "JOIN query between workflows and users"
    },
    {
      naturalLanguage: "List votes for proposal 123 with voter names",
      expectedTables: ["votes", "proposals", "users"],
      intent: "JOIN",
      description: "Multi-table JOIN query"
    },
    {
      naturalLanguage: "Show latest 10 proposals",
      expectedTables: ["proposals"],
      intent: "SELECT",
      description: "Query with ORDER BY and LIMIT"
    },
    {
      naturalLanguage: "Find users who haven't logged in for 30 days",
      expectedTables: ["users"],
      intent: "SELECT",
      description: "Date-based filter query"
    },
    {
      naturalLanguage: "Show workflow success rates above 90%",
      expectedTables: ["workflows"],
      intent: "SELECT",
      description: "Numeric comparison query"
    },
    {
      naturalLanguage: "Count votes by choice for each proposal",
      expectedTables: ["votes", "proposals"],
      intent: "AGGREGATE",
      description: "GROUP BY aggregation query"
    },
    {
      naturalLanguage: "Show users and their total voting power",
      expectedTables: ["users"],
      intent: "SELECT",
      description: "Simple column selection query"
    }
  ];
}

export default {
  getAllSchemas,
  getQueryExamples,
  USERS_SCHEMA,
  WORKFLOWS_SCHEMA,
  PROPOSALS_SCHEMA,
  VOTES_SCHEMA,
  DOCUMENTS_SCHEMA,
  QUERY_HISTORY_SCHEMA
};