/**
 * Beads Markdown Plan Importer
 *
 * Parses markdown files with task lists and converts them to beads epics and tasks.
 * Supports common markdown patterns including:
 * - Phase/section headings as epics
 * - Task lists (- [ ] and - [x]) as tasks
 * - Nested lists as dependencies
 * - YAML frontmatter for metadata
 *
 * @module beads/import
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type {
  BeadsIssue,
  BeadsIssuePriority,
  BeadsIssueType,
  BeadsDependencyType,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * YAML frontmatter metadata
 */
export interface MarkdownFrontmatter {
  title?: string;
  description?: string;
  priority?: number | string;
  assignee?: string;
  labels?: string[];
  type?: string;
  version?: string;
  author?: string;
  date?: string;
  [key: string]: unknown;
}

/**
 * Parsed task from markdown
 */
export interface ParsedTask {
  title: string;
  description: string;
  completed: boolean;
  priority: BeadsIssuePriority;
  type: BeadsIssueType;
  labels: string[];
  indent: number;
  lineNumber: number;
  parentIndex: number | null;
  childIndices: number[];
  notes: string;
  assignee?: string;
}

/**
 * Parsed epic/phase from markdown
 */
export interface ParsedEpic {
  title: string;
  description: string;
  tasks: ParsedTask[];
  level: number;
  lineNumber: number;
  labels: string[];
  priority: BeadsIssuePriority;
}

/**
 * Complete parsed markdown plan
 */
export interface ParsedMarkdownPlan {
  frontmatter: MarkdownFrontmatter;
  title: string;
  description: string;
  epics: ParsedEpic[];
  orphanTasks: ParsedTask[];
  totalTasks: number;
  completedTasks: number;
}

/**
 * Import options
 */
export interface ImportOptions {
  /** Create epics from headings */
  createEpics?: boolean;
  /** Infer dependencies from nesting */
  inferDependencies?: boolean;
  /** Default priority for tasks */
  defaultPriority?: BeadsIssuePriority;
  /** Default task type */
  defaultType?: BeadsIssueType;
  /** Labels to add to all imported items */
  additionalLabels?: string[];
  /** Mark completed tasks as closed */
  closeCompletedTasks?: boolean;
  /** Minimum heading level to treat as epic (1-6) */
  epicHeadingLevel?: number;
}

/**
 * Import result for a single item
 */
export interface ImportedItem {
  originalTitle: string;
  id: string;
  type: 'epic' | 'task';
  status: string;
  parentId?: string;
  dependsOn: string[];
}

/**
 * Import result summary
 */
export interface ImportResult {
  success: boolean;
  epicCount: number;
  taskCount: number;
  completedCount: number;
  skippedCount: number;
  items: ImportedItem[];
  errors: string[];
  warnings: string[];
}

// ============================================
// Constants
// ============================================

const DEFAULT_OPTIONS: Required<ImportOptions> = {
  createEpics: true,
  inferDependencies: true,
  defaultPriority: 2,
  defaultType: 'task',
  additionalLabels: ['imported'],
  closeCompletedTasks: false,
  epicHeadingLevel: 2,
};

// Priority keywords to detect from text
const PRIORITY_KEYWORDS: Record<string, BeadsIssuePriority> = {
  critical: 0,
  urgent: 0,
  'p0': 0,
  high: 1,
  important: 1,
  'p1': 1,
  medium: 2,
  normal: 2,
  'p2': 2,
  low: 3,
  minor: 3,
  'p3': 3,
  'nice-to-have': 4,
  optional: 4,
  'p4': 4,
};

// Type keywords to detect from text
const TYPE_KEYWORDS: Record<string, BeadsIssueType> = {
  bug: 'bug',
  fix: 'bug',
  'bug fix': 'bug',
  feature: 'feature',
  feat: 'feature',
  enhancement: 'feature',
  task: 'task',
  todo: 'task',
  chore: 'chore',
  maintenance: 'chore',
  cleanup: 'chore',
  epic: 'epic',
};

// ============================================
// MarkdownPlanImporter Class
// ============================================

/**
 * Imports markdown plans into Beads epics and tasks
 */
export class MarkdownPlanImporter {
  private options: Required<ImportOptions>;

  constructor(options?: ImportOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Parse a markdown file and extract plan structure
   */
  parseMarkdown(content: string): ParsedMarkdownPlan {
    const lines = content.split('\n');
    const frontmatter = this.extractFrontmatter(lines);
    const { title, description } = this.extractTitleAndDescription(lines, frontmatter);
    const epics = this.extractEpics(lines);
    const orphanTasks = this.extractOrphanTasks(lines, epics);

    // Calculate totals
    let totalTasks = orphanTasks.length;
    let completedTasks = orphanTasks.filter((t) => t.completed).length;

    for (const epic of epics) {
      totalTasks += epic.tasks.length;
      completedTasks += epic.tasks.filter((t) => t.completed).length;
    }

    return {
      frontmatter,
      title,
      description,
      epics,
      orphanTasks,
      totalTasks,
      completedTasks,
    };
  }

  /**
   * Parse a markdown file from path
   */
  parseFile(filePath: string): ParsedMarkdownPlan {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const plan = this.parseMarkdown(content);

    // Use filename as title if not found
    if (!plan.title) {
      const ext = extname(filePath);
      plan.title = basename(filePath, ext)
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return plan;
  }

  /**
   * Extract YAML frontmatter from markdown
   */
  extractFrontmatter(lines: string[]): MarkdownFrontmatter {
    const frontmatter: MarkdownFrontmatter = {};

    if (lines[0]?.trim() !== '---') {
      return frontmatter;
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return frontmatter;
    }

    // Parse YAML-like frontmatter (simple key: value pairs)
    for (let i = 1; i < endIndex; i++) {
      const line = lines[i].trim();
      const colonIndex = line.indexOf(':');

      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        let value: string | string[] = line.substring(colonIndex + 1).trim();

        // Handle array values (comma-separated or YAML list)
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''));
        }

        // Remove quotes
        if (typeof value === 'string') {
          value = value.replace(/^["']|["']$/g, '');
        }

        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  /**
   * Extract document title and description
   */
  extractTitleAndDescription(
    lines: string[],
    frontmatter: MarkdownFrontmatter
  ): { title: string; description: string } {
    let title = frontmatter.title || '';
    let description = frontmatter.description || '';

    // Find first h1 heading for title
    for (const line of lines) {
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match && !title) {
        title = h1Match[1].trim();
        continue;
      }

      // First paragraph after title as description
      if (title && !description && line.trim() && !line.startsWith('#') && !line.startsWith('-')) {
        description = line.trim();
        break;
      }
    }

    return { title, description };
  }

  /**
   * Extract epics from headings
   */
  extractEpics(lines: string[]): ParsedEpic[] {
    if (!this.options.createEpics) {
      return [];
    }

    const epics: ParsedEpic[] = [];
    const headingPattern = new RegExp(`^#{${this.options.epicHeadingLevel},6}\\s+(.+)$`);

    let currentEpic: ParsedEpic | null = null;
    let currentDescription: string[] = [];
    let inEpicBody = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(headingPattern);

      if (headingMatch) {
        // Save previous epic
        if (currentEpic) {
          currentEpic.description = currentDescription.join('\n').trim();
          currentEpic.tasks = this.extractTasksFromRange(
            lines,
            currentEpic.lineNumber + 1,
            i - 1
          );
          epics.push(currentEpic);
        }

        // Start new epic
        const level = line.match(/^(#+)/)?.[1].length || 2;
        const title = this.cleanHeadingTitle(headingMatch[1]);
        const labels = this.extractLabelsFromText(title);
        const priority = this.detectPriorityFromText(title);

        currentEpic = {
          title,
          description: '',
          tasks: [],
          level,
          lineNumber: i,
          labels,
          priority,
        };

        currentDescription = [];
        inEpicBody = true;
      } else if (inEpicBody && currentEpic) {
        // Collect description until we hit a task list
        if (!line.match(/^[-*]\s*\[[ xX]?\]/)) {
          if (line.trim() && !line.startsWith('#')) {
            currentDescription.push(line);
          }
        }
      }
    }

    // Save last epic
    if (currentEpic) {
      currentEpic.description = currentDescription.join('\n').trim();
      currentEpic.tasks = this.extractTasksFromRange(
        lines,
        currentEpic.lineNumber + 1,
        lines.length - 1
      );
      epics.push(currentEpic);
    }

    return epics;
  }

  /**
   * Extract tasks from a range of lines
   */
  extractTasksFromRange(lines: string[], startLine: number, endLine: number): ParsedTask[] {
    const tasks: ParsedTask[] = [];
    const indentStack: { indent: number; index: number }[] = [];

    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      const line = lines[i];
      const task = this.parseTaskLine(line, i);

      if (task) {
        // Determine parent based on indentation
        while (
          indentStack.length > 0 &&
          indentStack[indentStack.length - 1].indent >= task.indent
        ) {
          indentStack.pop();
        }

        if (indentStack.length > 0) {
          const parentIdx = indentStack[indentStack.length - 1].index;
          task.parentIndex = parentIdx;
          tasks[parentIdx].childIndices.push(tasks.length);
        }

        indentStack.push({ indent: task.indent, index: tasks.length });
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Extract orphan tasks (not under any heading)
   */
  extractOrphanTasks(lines: string[], epics: ParsedEpic[]): ParsedTask[] {
    if (epics.length === 0) {
      // All tasks are orphans if no epics
      return this.extractTasksFromRange(lines, 0, lines.length - 1);
    }

    // Find tasks before first epic
    const firstEpicLine = epics[0]?.lineNumber || lines.length;
    return this.extractTasksFromRange(lines, 0, firstEpicLine - 1);
  }

  /**
   * Parse a single task line
   */
  parseTaskLine(line: string, lineNumber: number): ParsedTask | null {
    // Match task patterns: - [ ] Task, - [x] Task, * [ ] Task, etc.
    const taskMatch = line.match(/^(\s*)[-*]\s*\[([xX ]?)\]\s*(.+)$/);

    if (!taskMatch) {
      return null;
    }

    const [, whitespace, checkMark, rawTitle] = taskMatch;
    const indent = whitespace.length;
    const completed = checkMark.toLowerCase() === 'x';

    // Parse title and extract metadata
    const { title, notes, assignee } = this.parseTaskTitle(rawTitle);
    const priority = this.detectPriorityFromText(title);
    const type = this.detectTypeFromText(title);
    const labels = this.extractLabelsFromText(title);

    return {
      title,
      description: notes,
      completed,
      priority,
      type,
      labels,
      indent,
      lineNumber,
      parentIndex: null,
      childIndices: [],
      notes,
      assignee,
    };
  }

  /**
   * Parse task title and extract embedded metadata
   */
  parseTaskTitle(rawTitle: string): { title: string; notes: string; assignee?: string } {
    let title = rawTitle.trim();
    let notes = '';
    let assignee: string | undefined;

    // Extract assignee (@username)
    const assigneeMatch = title.match(/@(\w+)/);
    if (assigneeMatch) {
      assignee = assigneeMatch[1];
      title = title.replace(/@\w+/, '').trim();
    }

    // Extract notes in parentheses
    const notesMatch = title.match(/\(([^)]+)\)$/);
    if (notesMatch) {
      notes = notesMatch[1];
      title = title.replace(/\([^)]+\)$/, '').trim();
    }

    // Extract notes after dash or colon
    const separatorMatch = title.match(/\s+[-:]\s+(.+)$/);
    if (separatorMatch) {
      if (!notes) {
        notes = separatorMatch[1];
      }
      title = title.replace(/\s+[-:]\s+.+$/, '').trim();
    }

    // Clean up remaining markers
    title = title
      .replace(/\[P[0-4]\]/gi, '')
      .replace(/\[(bug|feature|task|chore|epic)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { title, notes, assignee };
  }

  /**
   * Detect priority from text content
   */
  detectPriorityFromText(text: string): BeadsIssuePriority {
    const lowerText = text.toLowerCase();

    // Check for explicit priority markers [P0], [P1], etc.
    const priorityMarker = lowerText.match(/\[p([0-4])\]/i);
    if (priorityMarker) {
      return parseInt(priorityMarker[1], 10) as BeadsIssuePriority;
    }

    // Check for priority keywords
    for (const [keyword, priority] of Object.entries(PRIORITY_KEYWORDS)) {
      if (lowerText.includes(keyword)) {
        return priority;
      }
    }

    return this.options.defaultPriority;
  }

  /**
   * Detect issue type from text content
   */
  detectTypeFromText(text: string): BeadsIssueType {
    const lowerText = text.toLowerCase();

    // Check for explicit type markers [bug], [feature], etc.
    const typeMarker = lowerText.match(/\[(bug|feature|task|chore|epic)\]/i);
    if (typeMarker) {
      return typeMarker[1] as BeadsIssueType;
    }

    // Check for type keywords
    for (const [keyword, type] of Object.entries(TYPE_KEYWORDS)) {
      if (lowerText.includes(keyword)) {
        return type;
      }
    }

    return this.options.defaultType;
  }

  /**
   * Extract labels from text (hashtags)
   */
  extractLabelsFromText(text: string): string[] {
    const labels: string[] = [];

    // Extract #hashtag labels
    const hashtagMatches = text.match(/#(\w+)/g);
    if (hashtagMatches) {
      for (const tag of hashtagMatches) {
        labels.push(tag.substring(1).toLowerCase());
      }
    }

    // Extract [label] markers
    const bracketMatches = text.match(/\[(\w+)\]/g);
    if (bracketMatches) {
      for (const match of bracketMatches) {
        const label = match.slice(1, -1).toLowerCase();
        // Skip known markers
        if (!['x', 'p0', 'p1', 'p2', 'p3', 'p4', 'bug', 'feature', 'task', 'chore', 'epic'].includes(label)) {
          labels.push(label);
        }
      }
    }

    return Array.from(new Set(labels));
  }

  /**
   * Clean heading title (remove phase numbers, etc.)
   */
  cleanHeadingTitle(title: string): string {
    return title
      .replace(/^Phase\s*\d+[:.]\s*/i, '')
      .replace(/^Step\s*\d+[:.]\s*/i, '')
      .replace(/^Part\s*\d+[:.]\s*/i, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();
  }

  /**
   * Build dependency graph from task nesting
   */
  buildDependencies(tasks: ParsedTask[]): Map<number, number[]> {
    const dependencies = new Map<number, number[]>();

    if (!this.options.inferDependencies) {
      return dependencies;
    }

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const deps: number[] = [];

      // Child tasks depend on parent task
      if (task.parentIndex !== null) {
        deps.push(task.parentIndex);
      }

      // Tasks with same parent depend on previous siblings
      const siblings = tasks.filter(
        (t, idx) => idx < i && t.parentIndex === task.parentIndex && t.indent === task.indent
      );
      if (siblings.length > 0) {
        // Optional: Add sequential dependency (uncomment if desired)
        // deps.push(tasks.indexOf(siblings[siblings.length - 1]));
      }

      if (deps.length > 0) {
        dependencies.set(i, deps);
      }
    }

    return dependencies;
  }

  /**
   * Get import statistics
   */
  getStatistics(plan: ParsedMarkdownPlan): {
    totalEpics: number;
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    tasksByPriority: Record<number, number>;
    tasksByType: Record<string, number>;
  } {
    const tasksByPriority: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    const tasksByType: Record<string, number> = {};

    const allTasks = [
      ...plan.orphanTasks,
      ...plan.epics.flatMap((e) => e.tasks),
    ];

    for (const task of allTasks) {
      tasksByPriority[task.priority]++;
      tasksByType[task.type] = (tasksByType[task.type] || 0) + 1;
    }

    return {
      totalEpics: plan.epics.length,
      totalTasks: plan.totalTasks,
      completedTasks: plan.completedTasks,
      pendingTasks: plan.totalTasks - plan.completedTasks,
      tasksByPriority,
      tasksByType,
    };
  }
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Create a new MarkdownPlanImporter with options
 */
export function createMarkdownImporter(options?: ImportOptions): MarkdownPlanImporter {
  return new MarkdownPlanImporter(options);
}

/**
 * Parse markdown content directly
 */
export function parseMarkdownPlan(content: string, options?: ImportOptions): ParsedMarkdownPlan {
  const importer = new MarkdownPlanImporter(options);
  return importer.parseMarkdown(content);
}

/**
 * Parse markdown file
 */
export function parseMarkdownFile(filePath: string, options?: ImportOptions): ParsedMarkdownPlan {
  const importer = new MarkdownPlanImporter(options);
  return importer.parseFile(filePath);
}

/**
 * Convert parsed plan to Beads issue format
 */
export function convertToBeadsIssue(
  task: ParsedTask,
  epicId?: string,
  additionalLabels: string[] = []
): Partial<BeadsIssue> {
  return {
    title: task.title,
    description: task.description || task.notes,
    status: task.completed ? 'closed' : 'open',
    priority: task.priority,
    type: task.type,
    labels: Array.from(new Set([...task.labels, ...additionalLabels])),
    assignee: task.assignee,
    notes: task.notes,
  };
}

export default MarkdownPlanImporter;
