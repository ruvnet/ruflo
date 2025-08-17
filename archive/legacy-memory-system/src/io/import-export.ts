/**
 * SPARC Memory Bank - Import/Export Functionality
 * Handles memory snapshots with various formats and encryption
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { MemoryItem, MemorySnapshot, ImportExportOptions } from '../types';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export class ImportExportManager {
  /**
   * Export memory items to various formats
   */
  async export(
    items: MemoryItem[], 
    options: ImportExportOptions
  ): Promise<Buffer | string> {
    let data: string;

    // Convert to requested format
    switch (options.format) {
      case 'json':
        data = this.exportToJSON(items, options);
        break;
      case 'markdown':
        data = this.exportToMarkdown(items, options);
        break;
      case 'csv':
        data = await this.exportToCSV(items, options);
        break;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }

    // Compress if requested
    let result: Buffer | string = data;
    if (options.compress) {
      result = await gzip(data);
    }

    // Encrypt if requested
    if (options.encryption) {
      result = await this.encrypt(
        result, 
        options.encryption.algorithm, 
        options.encryption.key
      );
    }

    return result;
  }

  /**
   * Import memory items from various formats
   */
  async import(
    data: Buffer | string,
    options: ImportExportOptions
  ): Promise<MemoryItem[]> {
    let processedData = data;

    // Decrypt if needed
    if (options.encryption) {
      processedData = await this.decrypt(
        processedData,
        options.encryption.algorithm,
        options.encryption.key
      );
    }

    // Decompress if needed
    if (options.compress) {
      processedData = await gunzip(processedData as Buffer);
    }

    // Parse based on format
    const stringData = processedData.toString('utf-8');
    
    switch (options.format) {
      case 'json':
        return this.importFromJSON(stringData);
      case 'markdown':
        return this.importFromMarkdown(stringData);
      case 'csv':
        return this.importFromCSV(stringData);
      default:
        throw new Error(`Unsupported import format: ${options.format}`);
    }
  }

  /**
   * Export to file
   */
  async exportToFile(
    items: MemoryItem[],
    filePath: string,
    options: ImportExportOptions
  ): Promise<void> {
    const data = await this.export(items, options);
    await fs.writeFile(filePath, data);
  }

  /**
   * Import from file
   */
  async importFromFile(
    filePath: string,
    options: ImportExportOptions
  ): Promise<MemoryItem[]> {
    const data = await fs.readFile(filePath);
    return this.import(data, options);
  }

  /**
   * Create snapshot
   */
  createSnapshot(items: MemoryItem[], nodeId: string): MemorySnapshot {
    return {
      version: '1.0',
      timestamp: Date.now(),
      nodeId,
      items,
      metadata: {
        itemCount: items.length,
        categories: [...new Set(items.map(i => i.category))],
        namespaces: [...new Set(items.map(i => i.metadata?.namespace || 'default'))]
      }
    };
  }

  /**
   * Validate snapshot
   */
  validateSnapshot(snapshot: any): snapshot is MemorySnapshot {
    return (
      snapshot &&
      typeof snapshot.version === 'string' &&
      typeof snapshot.timestamp === 'number' &&
      typeof snapshot.nodeId === 'string' &&
      Array.isArray(snapshot.items)
    );
  }

  /**
   * Export to JSON format
   */
  private exportToJSON(items: MemoryItem[], options: ImportExportOptions): string {
    if (!options.includeMetadata) {
      // Strip metadata if not requested
      items = items.map(item => ({
        ...item,
        metadata: undefined
      }));
    }

    return JSON.stringify(items, null, 2);
  }

  /**
   * Export to Markdown format
   */
  private exportToMarkdown(items: MemoryItem[], options: ImportExportOptions): string {
    let markdown = '# Memory Export\n\n';
    markdown += `**Exported**: ${new Date().toISOString()}\n\n`;
    markdown += `**Total Items**: ${items.length}\n\n`;

    // Group by category
    const byCategory = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, MemoryItem[]>);

    for (const [category, categoryItems] of Object.entries(byCategory)) {
      markdown += `## ${category}\n\n`;

      for (const item of categoryItems) {
        markdown += `### ${item.key}\n\n`;
        
        if (options.includeMetadata && item.metadata) {
          markdown += '**Metadata**:\n';
          for (const [key, value] of Object.entries(item.metadata)) {
            markdown += `- ${key}: ${JSON.stringify(value)}\n`;
          }
          markdown += '\n';
        }

        markdown += '**Value**:\n';
        if (typeof item.value === 'string') {
          markdown += item.value + '\n\n';
        } else {
          markdown += '```json\n';
          markdown += JSON.stringify(item.value, null, 2);
          markdown += '\n```\n\n';
        }

        markdown += '---\n\n';
      }
    }

    return markdown;
  }

  /**
   * Export to CSV format
   */
  private async exportToCSV(
    items: MemoryItem[], 
    options: ImportExportOptions
  ): Promise<string> {
    const rows: string[] = [];
    
    // Header
    const headers = ['id', 'category', 'key', 'value'];
    if (options.includeMetadata) {
      headers.push('timestamp', 'namespace', 'tags');
    }
    rows.push(headers.join(','));

    // Data rows
    for (const item of items) {
      const row: string[] = [
        this.escapeCSV(item.id),
        this.escapeCSV(item.category),
        this.escapeCSV(item.key),
        this.escapeCSV(JSON.stringify(item.value))
      ];

      if (options.includeMetadata) {
        row.push(
          item.metadata?.timestamp?.toString() || '',
          this.escapeCSV(item.metadata?.namespace || 'default'),
          this.escapeCSV((item.metadata?.tags || []).join(';'))
        );
      }

      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Import from JSON format
   */
  private importFromJSON(data: string): MemoryItem[] {
    const parsed = JSON.parse(data);
    
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.items && Array.isArray(parsed.items)) {
      // Handle snapshot format
      return parsed.items;
    } else {
      throw new Error('Invalid JSON format');
    }
  }

  /**
   * Import from Markdown format
   */
  private importFromMarkdown(data: string): MemoryItem[] {
    const items: MemoryItem[] = [];
    const lines = data.split('\n');
    
    let currentCategory = '';
    let currentKey = '';
    let currentMetadata: any = {};
    let currentValue = '';
    let inValue = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Category header
      if (line.startsWith('## ')) {
        currentCategory = line.substring(3).trim();
        continue;
      }

      // Item header
      if (line.startsWith('### ')) {
        // Save previous item if exists
        if (currentKey && currentValue) {
          items.push({
            id: `${currentCategory}:${currentKey}`,
            category: currentCategory,
            key: currentKey,
            value: this.parseValue(currentValue.trim()),
            metadata: Object.keys(currentMetadata).length > 0 ? currentMetadata : undefined
          });
        }

        currentKey = line.substring(4).trim();
        currentMetadata = {};
        currentValue = '';
        inValue = false;
        continue;
      }

      // Metadata
      if (line.startsWith('- ') && !inValue) {
        const match = line.match(/^- ([^:]+): (.+)$/);
        if (match) {
          currentMetadata[match[1]] = JSON.parse(match[2]);
        }
        continue;
      }

      // Value marker
      if (line === '**Value**:') {
        inValue = true;
        continue;
      }

      // Code block
      if (line === '```json') {
        inCodeBlock = true;
        continue;
      }
      if (line === '```' && inCodeBlock) {
        inCodeBlock = false;
        continue;
      }

      // Collect value
      if (inValue && line !== '---') {
        currentValue += line + '\n';
      }
    }

    // Save last item
    if (currentKey && currentValue) {
      items.push({
        id: `${currentCategory}:${currentKey}`,
        category: currentCategory,
        key: currentKey,
        value: this.parseValue(currentValue.trim()),
        metadata: Object.keys(currentMetadata).length > 0 ? currentMetadata : undefined
      });
    }

    return items;
  }

  /**
   * Import from CSV format
   */
  private importFromCSV(data: string): MemoryItem[] {
    const lines = data.split('\n');
    const headers = lines[0].split(',');
    const items: MemoryItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < 4) continue;

      const item: MemoryItem = {
        id: values[0],
        category: values[1],
        key: values[2],
        value: JSON.parse(values[3])
      };

      if (headers.includes('timestamp')) {
        item.metadata = {
          timestamp: parseInt(values[4]) || Date.now(),
          namespace: values[5] || 'default',
          tags: values[6] ? values[6].split(';') : []
        };
      }

      items.push(item);
    }

    return items;
  }

  /**
   * Encrypt data
   */
  private async encrypt(
    data: Buffer | string, 
    algorithm: string, 
    key: string
  ): Promise<Buffer> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
    
    const encrypted = Buffer.concat([
      cipher.update(typeof data === 'string' ? Buffer.from(data) : data),
      cipher.final()
    ]);

    // Prepend IV to encrypted data
    return Buffer.concat([iv, encrypted]);
  }

  /**
   * Decrypt data
   */
  private async decrypt(
    data: Buffer | string,
    algorithm: string,
    key: string
  ): Promise<Buffer> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    
    // Extract IV from beginning
    const iv = buffer.slice(0, 16);
    const encrypted = buffer.slice(16);

    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }

  /**
   * Escape CSV value
   */
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Parse CSV line
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current);
    return values;
  }

  /**
   * Parse value from string
   */
  private parseValue(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}