/**
 * Beads Import Module Tests
 *
 * Tests for the MarkdownPlanImporter that converts markdown plans
 * to Beads epics and tasks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MarkdownPlanImporter,
  createMarkdownImporter,
  parseMarkdownPlan,
  convertToBeadsIssue,
  type ParsedMarkdownPlan,
  type ParsedTask,
  type ParsedEpic,
} from '../../src/beads/import.js';

describe('MarkdownPlanImporter', () => {
  let importer: MarkdownPlanImporter;

  beforeEach(() => {
    importer = new MarkdownPlanImporter();
  });

  describe('YAML Frontmatter Parsing', () => {
    it('should extract frontmatter from markdown', () => {
      const content = `---
title: My Plan
description: A test plan
priority: high
labels: [backend, api]
---

# Project Plan

Some content here.`;

      const plan = importer.parseMarkdown(content);

      expect(plan.frontmatter.title).toBe('My Plan');
      expect(plan.frontmatter.description).toBe('A test plan');
      expect(plan.frontmatter.priority).toBe('high');
      expect(plan.frontmatter.labels).toEqual(['backend', 'api']);
    });

    it('should handle frontmatter with quotes', () => {
      const content = `---
title: "Quoted Title"
description: 'Single quoted'
---

# Content`;

      const plan = importer.parseMarkdown(content);

      expect(plan.frontmatter.title).toBe('Quoted Title');
      expect(plan.frontmatter.description).toBe('Single quoted');
    });

    it('should handle missing frontmatter', () => {
      const content = `# Simple Plan

- [ ] Task 1
- [ ] Task 2`;

      const plan = importer.parseMarkdown(content);

      expect(plan.frontmatter).toEqual({});
    });

    it('should handle incomplete frontmatter', () => {
      const content = `---
title: Incomplete
`;

      const plan = importer.parseMarkdown(content);

      // Should not crash, returns empty since no closing ---
      expect(plan.frontmatter).toEqual({});
    });
  });

  describe('Task Parsing', () => {
    it('should parse basic task lists', () => {
      const content = `# Tasks

- [ ] Implement feature A
- [ ] Write tests
- [x] Setup project`;

      const plan = importer.parseMarkdown(content);

      expect(plan.totalTasks).toBe(3);
      expect(plan.completedTasks).toBe(1);
    });

    it('should parse tasks with different markers', () => {
      const content = `# Tasks

- [ ] Dash unchecked
- [x] Dash checked
- [X] Dash uppercase checked
* [ ] Asterisk unchecked
* [x] Asterisk checked`;

      const plan = importer.parseMarkdown(content);

      expect(plan.totalTasks).toBe(5);
      expect(plan.completedTasks).toBe(3);
    });

    it('should extract task metadata from title', () => {
      const content = `# Tasks

- [ ] [P0] Critical bug fix @john #backend
- [ ] Add authentication feature #security`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      expect(tasks.length).toBe(2);
      expect(tasks[0].priority).toBe(0); // P0 = critical
      expect(tasks[0].assignee).toBe('john');
      expect(tasks[0].labels).toContain('backend');

      // "feature" keyword in text should detect feature type
      expect(tasks[1].type).toBe('feature');
      expect(tasks[1].labels).toContain('security');
    });

    it('should detect priority from keywords', () => {
      const content = `# Tasks

- [ ] Critical: Fix memory leak
- [ ] High priority login fix
- [ ] Low priority cleanup`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      expect(tasks[0].priority).toBe(0); // critical
      expect(tasks[1].priority).toBe(1); // high
      expect(tasks[2].priority).toBe(3); // low
    });

    it('should detect task type from keywords', () => {
      const content = `# Tasks

- [ ] Bug: Fix null pointer
- [ ] Feature: Add dark mode
- [ ] Chore: Update dependencies`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      expect(tasks[0].type).toBe('bug');
      expect(tasks[1].type).toBe('feature');
      expect(tasks[2].type).toBe('chore');
    });

    it('should parse nested tasks and track indentation', () => {
      const content = `# Tasks

- [ ] Parent task
  - [ ] Child task 1
  - [ ] Child task 2
    - [ ] Grandchild task`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      expect(tasks.length).toBe(4);
      expect(tasks[0].indent).toBe(0);
      expect(tasks[1].indent).toBe(2);
      expect(tasks[2].indent).toBe(2);
      expect(tasks[3].indent).toBe(4);

      // Check parent-child relationships
      expect(tasks[1].parentIndex).toBe(0);
      expect(tasks[2].parentIndex).toBe(0);
      expect(tasks[3].parentIndex).toBe(2);
    });

    it('should extract notes from parentheses', () => {
      const content = `# Tasks

- [ ] Implement caching (use Redis for production)`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      expect(tasks[0].title).toBe('Implement caching');
      expect(tasks[0].notes).toBe('use Redis for production');
    });
  });

  describe('Epic/Phase Parsing', () => {
    it('should extract epics from h2 headings', () => {
      const content = `# Project Plan

## Phase 1: Setup

- [ ] Initialize project
- [ ] Configure tools

## Phase 2: Development

- [ ] Implement core features
- [ ] Write tests`;

      const plan = importer.parseMarkdown(content);

      expect(plan.epics.length).toBe(2);
      expect(plan.epics[0].title).toBe('Setup');
      expect(plan.epics[0].tasks.length).toBe(2);
      expect(plan.epics[1].title).toBe('Development');
      expect(plan.epics[1].tasks.length).toBe(2);
    });

    it('should clean phase/step prefixes from epic titles', () => {
      const content = `# Plan

## Phase 1: Authentication
## Step 2: Database Setup
## Part 3: API Design
## 4. Testing`;

      const plan = importer.parseMarkdown(content);

      expect(plan.epics[0].title).toBe('Authentication');
      expect(plan.epics[1].title).toBe('Database Setup');
      expect(plan.epics[2].title).toBe('API Design');
      expect(plan.epics[3].title).toBe('Testing');
    });

    it('should extract epic descriptions', () => {
      const content = `# Plan

## Authentication

This phase covers all authentication-related tasks.
We will implement OAuth2 and JWT tokens.

- [ ] Setup OAuth
- [ ] Implement JWT`;

      const plan = importer.parseMarkdown(content);

      expect(plan.epics[0].description).toContain('authentication-related tasks');
    });

    it('should handle different heading levels', () => {
      const importer3 = new MarkdownPlanImporter({ epicHeadingLevel: 3 });

      const content = `# Plan

## Section A

### Epic 1

- [ ] Task 1

### Epic 2

- [ ] Task 2`;

      const plan = importer3.parseMarkdown(content);

      expect(plan.epics.length).toBe(2);
      expect(plan.epics[0].title).toBe('Epic 1');
      expect(plan.epics[1].title).toBe('Epic 2');
    });
  });

  describe('Orphan Tasks', () => {
    it('should collect tasks before first heading as orphans', () => {
      const content = `# Project Plan

Some introduction text.

- [ ] Pre-phase task 1
- [ ] Pre-phase task 2

## Phase 1

- [ ] Phase task`;

      const plan = importer.parseMarkdown(content);

      expect(plan.orphanTasks.length).toBe(2);
      expect(plan.orphanTasks[0].title).toBe('Pre-phase task 1');
      expect(plan.epics[0].tasks.length).toBe(1);
    });

    it('should treat all tasks as orphans when no epics', () => {
      const importerNoEpics = new MarkdownPlanImporter({ createEpics: false });

      const content = `# Tasks

## Section

- [ ] Task 1
- [ ] Task 2`;

      const plan = importerNoEpics.parseMarkdown(content);

      expect(plan.epics.length).toBe(0);
      expect(plan.orphanTasks.length).toBe(2);
    });
  });

  describe('Dependency Inference', () => {
    it('should build dependencies from nesting', () => {
      const content = `# Tasks

- [ ] Parent
  - [ ] Child 1
  - [ ] Child 2`;

      const plan = importer.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      const deps = importer.buildDependencies(tasks);

      // Children depend on parent
      expect(deps.get(1)).toContain(0);
      expect(deps.get(2)).toContain(0);
    });

    it('should skip dependencies when disabled', () => {
      const importerNoDeps = new MarkdownPlanImporter({ inferDependencies: false });

      const content = `# Tasks

- [ ] Parent
  - [ ] Child`;

      const plan = importerNoDeps.parseMarkdown(content);
      const tasks = plan.orphanTasks.length > 0
        ? plan.orphanTasks
        : plan.epics[0]?.tasks || [];

      const deps = importerNoDeps.buildDependencies(tasks);

      expect(deps.size).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should calculate correct statistics', () => {
      const content = `# Plan

## Phase 1

- [ ] [P0] Critical task
- [x] [P1] High priority task
- [ ] [P2] Medium task

## Phase 2

- [ ] Bug fix for login
- [x] Feature for dashboard`;

      const plan = importer.parseMarkdown(content);
      const stats = importer.getStatistics(plan);

      expect(stats.totalEpics).toBe(2);
      expect(stats.totalTasks).toBe(5);
      expect(stats.completedTasks).toBe(2);
      expect(stats.pendingTasks).toBe(3);
      expect(stats.tasksByPriority[0]).toBe(1); // critical
      expect(stats.tasksByPriority[1]).toBe(1); // high
      expect(stats.tasksByType.bug).toBe(1);
      expect(stats.tasksByType.feature).toBe(1);
    });
  });

  describe('Title and Description Extraction', () => {
    it('should extract title from h1 heading', () => {
      const content = `# My Project Plan

This is a description of the project.

## Phase 1`;

      const plan = importer.parseMarkdown(content);

      expect(plan.title).toBe('My Project Plan');
      expect(plan.description).toBe('This is a description of the project.');
    });

    it('should use frontmatter title over h1', () => {
      const content = `---
title: Frontmatter Title
---

# Heading Title

## Phase 1`;

      const plan = importer.parseMarkdown(content);

      expect(plan.title).toBe('Frontmatter Title');
    });
  });

  describe('Convenience Functions', () => {
    it('should create importer with factory function', () => {
      const importer = createMarkdownImporter({ defaultPriority: 1 });
      expect(importer).toBeInstanceOf(MarkdownPlanImporter);
    });

    it('should parse content directly', () => {
      const content = `# Plan

- [ ] Task`;

      const plan = parseMarkdownPlan(content);
      expect(plan.totalTasks).toBe(1);
    });

    it('should convert task to Beads issue format', () => {
      const task: ParsedTask = {
        title: 'Test task',
        description: 'Task description',
        completed: false,
        priority: 1,
        type: 'feature',
        labels: ['api'],
        indent: 0,
        lineNumber: 10,
        parentIndex: null,
        childIndices: [],
        notes: 'Some notes',
        assignee: 'developer',
      };

      const issue = convertToBeadsIssue(task, 'epic-123', ['imported']);

      expect(issue.title).toBe('Test task');
      expect(issue.description).toBe('Task description');
      expect(issue.status).toBe('open');
      expect(issue.priority).toBe(1);
      expect(issue.type).toBe('feature');
      expect(issue.labels).toContain('api');
      expect(issue.labels).toContain('imported');
      expect(issue.assignee).toBe('developer');
    });

    it('should mark completed tasks as closed', () => {
      const task: ParsedTask = {
        title: 'Completed task',
        description: '',
        completed: true,
        priority: 2,
        type: 'task',
        labels: [],
        indent: 0,
        lineNumber: 1,
        parentIndex: null,
        childIndices: [],
        notes: '',
      };

      const issue = convertToBeadsIssue(task);

      expect(issue.status).toBe('closed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const plan = importer.parseMarkdown('');

      expect(plan.totalTasks).toBe(0);
      expect(plan.epics.length).toBe(0);
      expect(plan.orphanTasks.length).toBe(0);
    });

    it('should handle content with no tasks', () => {
      const content = `# Plan

Just some text, no tasks.

## Section

More text.`;

      const plan = importer.parseMarkdown(content);

      expect(plan.totalTasks).toBe(0);
    });

    it('should handle malformed task lines', () => {
      const content = `# Tasks

- Not a task (no checkbox)
- [ ] Valid task 1
- [x] Valid task 2`;

      const plan = importer.parseMarkdown(content);

      // Only valid checkbox tasks should be parsed
      expect(plan.totalTasks).toBe(2);
    });

    it('should handle special characters in task titles', () => {
      const content = `# Tasks

- [ ] Task with "quotes" and 'apostrophes'
- [ ] Task with special chars: !@#$%^&*()
- [ ] Task with unicode:
- [ ] Task with emoji: :rocket:`;

      const plan = importer.parseMarkdown(content);

      expect(plan.totalTasks).toBe(4);
    });

    it('should handle very long task titles', () => {
      const longTitle = 'A'.repeat(500);
      const content = `# Tasks

- [ ] ${longTitle}`;

      const plan = importer.parseMarkdown(content);

      expect(plan.totalTasks).toBe(1);
      expect(plan.orphanTasks[0].title.length).toBeGreaterThan(400);
    });

    it('should handle mixed content types', () => {
      const content = `# Plan

Some intro text.

## Phase 1

| Col 1 | Col 2 |
|-------|-------|
| A     | B     |

- [ ] Real task

> Blockquote

- [ ] Another task`;

      const plan = importer.parseMarkdown(content);

      // Parser finds tasks even in mixed content (it's line-based)
      expect(plan.totalTasks).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Real-World Examples', () => {
    it('should parse a typical project plan', () => {
      const content = `---
title: Backend API Development
version: 1.0.0
author: Team Lead
---

# Backend API Development Plan

This plan outlines the development of our REST API.

## Phase 1: Foundation

Setup the basic project structure and tooling.

- [ ] [P1] Initialize Node.js project
- [ ] Configure TypeScript
- [ ] Setup ESLint and Prettier
- [x] Create Git repository

## Phase 2: Core Features

Implement the main API endpoints.

- [ ] [feature] User authentication @alice #security
  - [ ] JWT token generation
  - [ ] Password hashing
  - [ ] Session management
- [ ] [feature] User CRUD operations @bob
- [ ] [feature] Data validation middleware

## Phase 3: Testing

Comprehensive test coverage.

- [ ] [P0] Setup test framework
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Setup CI/CD pipeline`;

      const plan = importer.parseMarkdown(content);

      expect(plan.title).toBe('Backend API Development');
      expect(plan.frontmatter.version).toBe('1.0.0');
      expect(plan.epics.length).toBe(3);
      // Total tasks include all checked and unchecked items
      expect(plan.totalTasks).toBeGreaterThanOrEqual(10);
      expect(plan.completedTasks).toBe(1);

      // Check nested tasks in Phase 2
      const phase2 = plan.epics[1];
      expect(phase2.title).toBe('Core Features');
      const authTask = phase2.tasks.find((t) => t.title.includes('User authentication'));
      expect(authTask).toBeDefined();
      expect(authTask?.assignee).toBe('alice');
      expect(authTask?.labels).toContain('security');
    });
  });
});
