/**
 * @claude-flow/browser - Workflow Templates Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowManager,
  getWorkflowManager,
  listWorkflows,
  getWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
} from '../src/infrastructure/workflow-templates.js';

describe('WorkflowManager', () => {
  let manager: WorkflowManager;

  beforeEach(() => {
    manager = new WorkflowManager();
  });

  describe('listTemplates', () => {
    it('should list all templates', () => {
      const templates = manager.listTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should filter by category', () => {
      const authTemplates = manager.listTemplates('authentication');
      expect(authTemplates.every(t => t.category === 'authentication')).toBe(true);
    });
  });

  describe('getTemplate', () => {
    it('should get template by ID', () => {
      const template = manager.getTemplate('login-basic');
      expect(template).toBeDefined();
      expect(template?.name).toBe('Basic Login');
    });

    it('should return undefined for non-existent template', () => {
      const template = manager.getTemplate('non-existent');
      expect(template).toBeUndefined();
    });
  });

  describe('registerTemplate', () => {
    it('should register a custom template', () => {
      const customTemplate: WorkflowTemplate = {
        id: 'custom-workflow',
        name: 'Custom Workflow',
        description: 'A custom workflow for testing',
        category: 'testing',
        tags: ['custom', 'test'],
        estimatedDuration: 1000,
        variables: [
          { name: 'url', type: 'string', required: true, description: 'URL to test' },
        ],
        steps: [
          { id: 'open', action: 'open', target: '\${url}' },
        ],
      };

      manager.registerTemplate(customTemplate);
      const retrieved = manager.getTemplate('custom-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Custom Workflow');
    });
  });

  describe('searchTemplates', () => {
    it('should search templates by query', () => {
      const results = manager.searchTemplates('login');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(t => t.name.toLowerCase().includes('login'))).toBe(true);
    });

    it('should search by tags', () => {
      const results = manager.searchTemplates('scrape');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array for no matches', () => {
      const results = manager.searchTemplates('xyznonexistent');
      expect(results.length).toBe(0);
    });
  });

  describe('validateVariables', () => {
    it('should validate required variables', () => {
      const result = manager.validateVariables('login-basic', {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('url'))).toBe(true);
    });

    it('should pass with all required variables', () => {
      const result = manager.validateVariables('login-basic', {
        url: 'https://example.com/login',
        username: 'testuser',
        password: 'testpass',
      });
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should validate number types', () => {
      const result = manager.validateVariables('uptime-check', {
        url: 'https://example.com',
        timeout: 'not-a-number',
      });
      expect(result.errors.some(e => e.includes('timeout') && e.includes('number'))).toBe(true);
    });

    it('should return error for non-existent template', () => {
      const result = manager.validateVariables('non-existent', {});
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });
  });

  describe('interpolateStep', () => {
    it('should interpolate variables in step', () => {
      const step = {
        id: 'test',
        action: 'fill' as const,
        target: '\${selector}',
        value: '\${value}',
      };

      const interpolated = manager.interpolateStep(step, {
        selector: '#username',
        value: 'testuser',
      });

      expect(interpolated.target).toBe('#username');
      expect(interpolated.value).toBe('testuser');
    });

    it('should preserve unmatched placeholders', () => {
      const step = {
        id: 'test',
        action: 'open' as const,
        target: '\${missing}',
      };

      const interpolated = manager.interpolateStep(step, {});
      expect(interpolated.target).toBe('${missing}');
    });
  });
});

describe('WORKFLOW_TEMPLATES', () => {
  it('should include authentication templates', () => {
    const authTemplates = WORKFLOW_TEMPLATES.filter(t => t.category === 'authentication');
    expect(authTemplates.length).toBeGreaterThanOrEqual(2);
    expect(authTemplates.some(t => t.id === 'login-basic')).toBe(true);
  });

  it('should include data extraction templates', () => {
    const dataTemplates = WORKFLOW_TEMPLATES.filter(t => t.category === 'data-extraction');
    expect(dataTemplates.length).toBeGreaterThanOrEqual(1);
  });

  it('should include testing templates', () => {
    const testTemplates = WORKFLOW_TEMPLATES.filter(t => t.category === 'testing');
    expect(testTemplates.length).toBeGreaterThanOrEqual(1);
  });

  it('should include monitoring templates', () => {
    const monitorTemplates = WORKFLOW_TEMPLATES.filter(t => t.category === 'monitoring');
    expect(monitorTemplates.length).toBeGreaterThanOrEqual(1);
  });

  describe('template validation', () => {
    it('all templates should have required fields', () => {
      for (const template of WORKFLOW_TEMPLATES) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.steps).toBeDefined();
        expect(Array.isArray(template.steps)).toBe(true);
        expect(template.steps.length).toBeGreaterThan(0);
      }
    });

    it('all steps should have required fields', () => {
      for (const template of WORKFLOW_TEMPLATES) {
        for (const step of template.steps) {
          expect(step.id).toBeDefined();
          expect(step.action).toBeDefined();
        }
      }
    });

    it('all variables should have required fields', () => {
      for (const template of WORKFLOW_TEMPLATES) {
        for (const variable of template.variables) {
          expect(variable.name).toBeDefined();
          expect(variable.type).toBeDefined();
          expect(typeof variable.required).toBe('boolean');
          expect(variable.description).toBeDefined();
        }
      }
    });
  });
});

describe('factory functions', () => {
  it('getWorkflowManager should return singleton', () => {
    const manager1 = getWorkflowManager();
    const manager2 = getWorkflowManager();
    expect(manager1).toBe(manager2);
  });

  it('listWorkflows should return templates', () => {
    const workflows = listWorkflows();
    expect(workflows.length).toBeGreaterThan(0);
  });

  it('listWorkflows should filter by category', () => {
    const authWorkflows = listWorkflows('authentication');
    expect(authWorkflows.every(w => w.category === 'authentication')).toBe(true);
  });

  it('getWorkflow should return template by ID', () => {
    const workflow = getWorkflow('login-basic');
    expect(workflow).toBeDefined();
    expect(workflow?.id).toBe('login-basic');
  });
});
