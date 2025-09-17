import { Document } from '../../types/index.js';
import { promises as fs } from 'fs';
import { URL } from 'url';

export interface DocumentSource {
  type: 'file' | 'url' | 'api' | 'text';
  path?: string;
  url?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface IngestionResult {
  documentId: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export class DocumentIngestionPipeline {
  private supportedFileTypes = new Set([
    '.txt', '.md', '.json', '.js', '.ts', '.py', '.sql', '.yaml', '.yml'
  ]);

  async ingestDocument(source: DocumentSource): Promise<{ content: string; metadata: Record<string, any> }> {
    switch (source.type) {
      case 'file':
        return this.ingestFile(source.path!, source.metadata);
      case 'url':
        return this.ingestUrl(source.url!, source.metadata);
      case 'api':
        return this.ingestApi(source.url!, source.metadata);
      case 'text':
        return this.ingestText(source.content!, source.metadata);
      default:
        throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  async ingestBatch(sources: DocumentSource[]): Promise<IngestionResult[]> {
    const results = await Promise.allSettled(
      sources.map(async (source, index) => {
        try {
          const { content, metadata } = await this.ingestDocument(source);
          return {
            documentId: `batch-${Date.now()}-${index}`,
            success: true,
            metadata: { ...metadata, batchIndex: index }
          };
        } catch (error) {
          return {
            documentId: `batch-${Date.now()}-${index}`,
            success: false,
            error: error.message
          };
        }
      })
    );

    return results.map(result =>
      result.status === 'fulfilled' ? result.value : result.reason
    );
  }

  private async ingestFile(filePath: string, metadata: Record<string, any> = {}): Promise<{ content: string; metadata: Record<string, any> }> {
    try {
      const fileExtension = this.getFileExtension(filePath);

      if (!this.supportedFileTypes.has(fileExtension)) {
        throw new Error(`Unsupported file type: ${fileExtension}`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);

      return {
        content,
        metadata: {
          ...metadata,
          source: 'file',
          filePath,
          fileExtension,
          fileSize: stats.size,
          lastModified: stats.mtime,
          encoding: 'utf-8'
        }
      };
    } catch (error) {
      throw new Error(`Failed to ingest file ${filePath}: ${error.message}`);
    }
  }

  private async ingestUrl(url: string, metadata: Record<string, any> = {}): Promise<{ content: string; metadata: Record<string, any> }> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('text/') && !contentType.includes('application/json')) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const content = await response.text();

      return {
        content,
        metadata: {
          ...metadata,
          source: 'url',
          url,
          contentType,
          contentLength: response.headers.get('content-length'),
          lastModified: response.headers.get('last-modified'),
          etag: response.headers.get('etag')
        }
      };
    } catch (error) {
      throw new Error(`Failed to ingest URL ${url}: ${error.message}`);
    }
  }

  private async ingestApi(apiUrl: string, metadata: Record<string, any> = {}): Promise<{ content: string; metadata: Record<string, any> }> {
    try {
      // This is a placeholder for API-specific ingestion logic
      // Could include authentication, pagination, etc.
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          ...(metadata.headers || {})
        }
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      return {
        content,
        metadata: {
          ...metadata,
          source: 'api',
          apiUrl,
          dataType: typeof data,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      throw new Error(`Failed to ingest from API ${apiUrl}: ${error.message}`);
    }
  }

  private async ingestText(content: string, metadata: Record<string, any> = {}): Promise<{ content: string; metadata: Record<string, any> }> {
    return {
      content,
      metadata: {
        ...metadata,
        source: 'text',
        length: content.length,
        timestamp: new Date().toISOString()
      }
    };
  }

  private getFileExtension(filePath: string): string {
    return filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  }

  // Specialized ingestion methods for LALO components
  async ingestWorkflowTemplates(templateDir: string): Promise<IngestionResult[]> {
    try {
      const files = await fs.readdir(templateDir);
      const templateFiles = files.filter(file => file.endsWith('.json') || file.endsWith('.yaml'));

      const sources: DocumentSource[] = templateFiles.map(file => ({
        type: 'file' as const,
        path: `${templateDir}/${file}`,
        metadata: {
          category: 'workflow_template',
          templateName: file.replace(/\.(json|yaml)$/, '')
        }
      }));

      return this.ingestBatch(sources);
    } catch (error) {
      throw new Error(`Failed to ingest workflow templates: ${error.message}`);
    }
  }

  async ingestGovernanceDocuments(docsDir: string): Promise<IngestionResult[]> {
    try {
      const files = await fs.readdir(docsDir);
      const docFiles = files.filter(file => file.endsWith('.md') || file.endsWith('.txt'));

      const sources: DocumentSource[] = docFiles.map(file => ({
        type: 'file' as const,
        path: `${docsDir}/${file}`,
        metadata: {
          category: 'governance',
          documentType: file.endsWith('.md') ? 'markdown' : 'text'
        }
      }));

      return this.ingestBatch(sources);
    } catch (error) {
      throw new Error(`Failed to ingest governance documents: ${error.message}`);
    }
  }

  async ingestSQLSchemas(schemaData: any[]): Promise<IngestionResult[]> {
    const sources: DocumentSource[] = schemaData.map((schema, index) => ({
      type: 'text' as const,
      content: this.formatSchemaForRAG(schema),
      metadata: {
        category: 'sql_schema',
        tableName: schema.name,
        schemaIndex: index
      }
    }));

    return this.ingestBatch(sources);
  }

  private formatSchemaForRAG(schema: any): string {
    let content = `Table: ${schema.name}\n`;

    if (schema.description) {
      content += `Description: ${schema.description}\n\n`;
    }

    content += 'Columns:\n';
    if (schema.columns) {
      schema.columns.forEach((col: any) => {
        content += `- ${col.name} (${col.type})`;
        if (col.primaryKey) content += ' [Primary Key]';
        if (col.foreignKey) content += ` [Foreign Key -> ${col.foreignKey}]`;
        if (col.description) content += ` - ${col.description}`;
        content += '\n';
      });
    }

    if (schema.relationships && schema.relationships.length > 0) {
      content += '\nRelationships:\n';
      schema.relationships.forEach((rel: any) => {
        content += `- ${rel.type}: ${rel.table}.${rel.column} -> ${rel.referencedTable}.${rel.referencedColumn}\n`;
      });
    }

    return content;
  }
}