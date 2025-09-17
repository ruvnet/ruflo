import { OpenAI } from 'openai';

export interface ChunkingOptions {
  maxChunkSize: number;
  overlap: number;
  preserveStructure: boolean;
  semanticBoundaries: boolean;
}

export interface Chunk {
  content: string;
  startIndex: number;
  endIndex: number;
  metadata: Record<string, any>;
}

export class SemanticChunker {
  private openai: OpenAI;
  private embeddingModel: string;

  constructor(openai: OpenAI, embeddingModel: string = 'text-embedding-3-small') {
    this.openai = openai;
    this.embeddingModel = embeddingModel;
  }

  async chunkDocument(
    content: string,
    options: Partial<ChunkingOptions> = {},
    documentType: string = 'text'
  ): Promise<Chunk[]> {
    const opts: ChunkingOptions = {
      maxChunkSize: 1000,
      overlap: 200,
      preserveStructure: true,
      semanticBoundaries: true,
      ...options
    };

    switch (documentType) {
      case 'code':
        return this.chunkCode(content, opts);
      case 'markdown':
        return this.chunkMarkdown(content, opts);
      case 'json':
        return this.chunkStructuredData(content, opts);
      case 'sql':
        return this.chunkSQL(content, opts);
      default:
        return opts.semanticBoundaries
          ? await this.semanticChunk(content, opts)
          : this.sentenceChunk(content, opts);
    }
  }

  private async semanticChunk(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    // Split into initial segments
    const segments = this.splitIntoSegments(content);

    // Calculate embeddings for each segment
    const embeddings = await this.calculateEmbeddings(segments);

    // Group semantically similar segments
    const semanticGroups = this.groupSimilarSegments(segments, embeddings, 0.8);

    // Create chunks respecting size limits
    const chunks: Chunk[] = [];
    let currentIndex = 0;

    for (const group of semanticGroups) {
      let groupContent = group.segments.join(' ');

      if (groupContent.length <= options.maxChunkSize) {
        chunks.push({
          content: groupContent,
          startIndex: currentIndex,
          endIndex: currentIndex + groupContent.length,
          metadata: {
            type: 'semantic',
            similarity: group.averageSimilarity,
            segmentCount: group.segments.length
          }
        });
        currentIndex += groupContent.length;
      } else {
        // Split large groups while preserving semantic boundaries
        const subChunks = this.splitLargeGroup(group.segments, options);
        for (const subChunk of subChunks) {
          chunks.push({
            content: subChunk,
            startIndex: currentIndex,
            endIndex: currentIndex + subChunk.length,
            metadata: {
              type: 'semantic_split',
              originalGroupSize: group.segments.length
            }
          });
          currentIndex += subChunk.length;
        }
      }
    }

    return this.addOverlapToChunks(chunks, options.overlap);
  }

  private sentenceChunk(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks: Chunk[] = [];

    let currentChunk = '';
    let currentIndex = 0;
    let chunkStartIndex = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      if (currentChunk.length + trimmedSentence.length > options.maxChunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          startIndex: chunkStartIndex,
          endIndex: currentIndex,
          metadata: { type: 'sentence', sentenceCount: currentChunk.split(/[.!?]+/).length }
        });

        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, options.overlap);
        currentChunk = overlapText + trimmedSentence;
        chunkStartIndex = currentIndex - overlapText.length;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
      }

      currentIndex += trimmedSentence.length + 2; // +2 for '. '
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        startIndex: chunkStartIndex,
        endIndex: currentIndex,
        metadata: { type: 'sentence', sentenceCount: currentChunk.split(/[.!?]+/).length }
      });
    }

    return Promise.resolve(chunks);
  }

  private chunkCode(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    let currentChunk = '';
    let currentIndex = 0;
    let chunkStartIndex = 0;
    let indentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineIndent = this.getIndentLevel(line);

      // Detect function/class boundaries
      const isFunctionStart = /^\s*(function|def|class|interface|type)\s/.test(line);
      const isBlockEnd = line.trim() === '}' || (lineIndent < indentLevel && indentLevel > 0);

      if ((currentChunk.length + line.length > options.maxChunkSize) ||
          (isFunctionStart && currentChunk.length > 0) ||
          (isBlockEnd && lineIndent === 0)) {

        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            startIndex: chunkStartIndex,
            endIndex: currentIndex,
            metadata: {
              type: 'code',
              lineCount: currentChunk.split('\n').length,
              avgIndentLevel: indentLevel
            }
          });
        }

        currentChunk = line + '\n';
        chunkStartIndex = currentIndex;
      } else {
        currentChunk += line + '\n';
      }

      indentLevel = lineIndent;
      currentIndex += line.length + 1;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        startIndex: chunkStartIndex,
        endIndex: currentIndex,
        metadata: {
          type: 'code',
          lineCount: currentChunk.split('\n').length,
          avgIndentLevel: indentLevel
        }
      });
    }

    return Promise.resolve(chunks);
  }

  private chunkMarkdown(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    const sections = content.split(/^#+\s/m);
    const chunks: Chunk[] = [];
    let currentIndex = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      if (section.length <= options.maxChunkSize) {
        chunks.push({
          content: section.trim(),
          startIndex: currentIndex,
          endIndex: currentIndex + section.length,
          metadata: {
            type: 'markdown_section',
            sectionIndex: i,
            hasHeading: section.includes('#')
          }
        });
      } else {
        // Split large sections by paragraphs
        const paragraphs = section.split(/\n\s*\n/);
        let sectionChunk = '';
        let sectionStartIndex = currentIndex;

        for (const paragraph of paragraphs) {
          if (sectionChunk.length + paragraph.length > options.maxChunkSize && sectionChunk) {
            chunks.push({
              content: sectionChunk.trim(),
              startIndex: sectionStartIndex,
              endIndex: currentIndex,
              metadata: {
                type: 'markdown_paragraph',
                sectionIndex: i,
                paragraphSplit: true
              }
            });

            sectionChunk = paragraph;
            sectionStartIndex = currentIndex;
          } else {
            sectionChunk += (sectionChunk ? '\n\n' : '') + paragraph;
          }
          currentIndex += paragraph.length + 2;
        }

        if (sectionChunk.trim()) {
          chunks.push({
            content: sectionChunk.trim(),
            startIndex: sectionStartIndex,
            endIndex: currentIndex,
            metadata: {
              type: 'markdown_paragraph',
              sectionIndex: i,
              paragraphSplit: true
            }
          });
        }
      }

      currentIndex += section.length;
    }

    return Promise.resolve(chunks);
  }

  private chunkStructuredData(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    try {
      const data = JSON.parse(content);
      const chunks: Chunk[] = [];

      if (Array.isArray(data)) {
        // Split array into chunks
        const itemsPerChunk = Math.max(1, Math.floor(options.maxChunkSize / 500)); // Estimate

        for (let i = 0; i < data.length; i += itemsPerChunk) {
          const chunkData = data.slice(i, i + itemsPerChunk);
          const chunkContent = JSON.stringify(chunkData, null, 2);

          chunks.push({
            content: chunkContent,
            startIndex: i,
            endIndex: Math.min(i + itemsPerChunk, data.length),
            metadata: {
              type: 'json_array',
              itemCount: chunkData.length,
              startIndex: i
            }
          });
        }
      } else {
        // Split object by top-level keys
        const keys = Object.keys(data);
        let currentChunk: any = {};
        let currentSize = 0;
        let startKey = 0;

        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = data[key];
          const keySize = JSON.stringify({ [key]: value }).length;

          if (currentSize + keySize > options.maxChunkSize && Object.keys(currentChunk).length > 0) {
            chunks.push({
              content: JSON.stringify(currentChunk, null, 2),
              startIndex: startKey,
              endIndex: i,
              metadata: {
                type: 'json_object',
                keyCount: Object.keys(currentChunk).length,
                keys: Object.keys(currentChunk)
              }
            });

            currentChunk = { [key]: value };
            currentSize = keySize;
            startKey = i;
          } else {
            currentChunk[key] = value;
            currentSize += keySize;
          }
        }

        if (Object.keys(currentChunk).length > 0) {
          chunks.push({
            content: JSON.stringify(currentChunk, null, 2),
            startIndex: startKey,
            endIndex: keys.length,
            metadata: {
              type: 'json_object',
              keyCount: Object.keys(currentChunk).length,
              keys: Object.keys(currentChunk)
            }
          });
        }
      }

      return Promise.resolve(chunks);
    } catch (error) {
      // Fallback to text chunking if JSON parsing fails
      return this.sentenceChunk(content, options);
    }
  }

  private chunkSQL(content: string, options: ChunkingOptions): Promise<Chunk[]> {
    // Split by statements (semicolon followed by newline)
    const statements = content.split(/;\s*\n/).filter(s => s.trim().length > 0);
    const chunks: Chunk[] = [];

    let currentChunk = '';
    let currentIndex = 0;
    let chunkStartIndex = 0;

    for (const statement of statements) {
      const trimmedStatement = statement.trim();

      if (currentChunk.length + trimmedStatement.length > options.maxChunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          startIndex: chunkStartIndex,
          endIndex: currentIndex,
          metadata: {
            type: 'sql',
            statementCount: currentChunk.split(';').length - 1
          }
        });

        currentChunk = trimmedStatement + ';\n';
        chunkStartIndex = currentIndex;
      } else {
        currentChunk += trimmedStatement + ';\n';
      }

      currentIndex += trimmedStatement.length + 2;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        startIndex: chunkStartIndex,
        endIndex: currentIndex,
        metadata: {
          type: 'sql',
          statementCount: currentChunk.split(';').length - 1
        }
      });
    }

    return Promise.resolve(chunks);
  }

  // Helper methods
  private splitIntoSegments(content: string): string[] {
    return content.split(/\n\s*\n/).filter(segment => segment.trim().length > 0);
  }

  private async calculateEmbeddings(segments: string[]): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: segments,
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      throw new Error(`Failed to calculate embeddings: ${error.message}`);
    }
  }

  private groupSimilarSegments(
    segments: string[],
    embeddings: number[][],
    threshold: number
  ): Array<{ segments: string[]; averageSimilarity: number }> {
    const groups: Array<{ segments: string[]; averageSimilarity: number }> = [];
    const used = new Set<number>();

    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;

      const group = [segments[i]];
      const similarities: number[] = [];
      used.add(i);

      for (let j = i + 1; j < segments.length; j++) {
        if (used.has(j)) continue;

        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity >= threshold) {
          group.push(segments[j]);
          similarities.push(similarity);
          used.add(j);
        }
      }

      groups.push({
        segments: group,
        averageSimilarity: similarities.length > 0
          ? similarities.reduce((a, b) => a + b, 0) / similarities.length
          : 1
      });
    }

    return groups;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    return dotProduct / (magnitudeA * magnitudeB);
  }

  private splitLargeGroup(segments: string[], options: ChunkingOptions): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    for (const segment of segments) {
      if (currentChunk.length + segment.length > options.maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = segment;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + segment;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private addOverlapToChunks(chunks: Chunk[], overlapSize: number): Chunk[] {
    if (overlapSize === 0 || chunks.length <= 1) return chunks;

    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const currentChunk = chunks[i];

      const overlapText = this.getOverlapText(prevChunk.content, overlapSize);
      currentChunk.content = overlapText + ' ' + currentChunk.content;
      currentChunk.metadata.hasOverlap = true;
      currentChunk.metadata.overlapSize = overlapText.length;
    }

    return chunks;
  }

  private getOverlapText(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return text;

    const overlap = text.slice(-overlapSize);
    const lastSpace = overlap.lastIndexOf(' ');
    return lastSpace > 0 ? overlap.slice(lastSpace + 1) : overlap;
  }

  private getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }
}