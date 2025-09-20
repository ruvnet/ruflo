import { jest } from '@jest/globals';
import { GitHubIntegration } from '../../lib/github-integration.js';

describe('GitHubIntegration Unit Tests', () => {
  let githubIntegration;

  beforeEach(async () => {
    githubIntegration = new GitHubIntegration();
    await githubIntegration.init();
  });

  afterEach(async () => {
    if (githubIntegration && githubIntegration.cleanup) {
      await githubIntegration.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(githubIntegration.initialized).toBe(true);
      expect(githubIntegration.octokit).toBeDefined();
      expect(githubIntegration.repositories).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(githubIntegration.config.defaultBranch).toBe('main');
      expect(githubIntegration.config.autoMergeEnabled).toBe(false);
      expect(githubIntegration.config.reviewRequired).toBe(true);
    });

    test('should initialize helper components', () => {
      expect(githubIntegration.analyzer).toBeDefined();
      expect(githubIntegration.prManager).toBeDefined();
      expect(githubIntegration.issueTracker).toBeDefined();
      expect(githubIntegration.releaseCoordinator).toBeDefined();
      expect(githubIntegration.workflowAutomator).toBeDefined();
      expect(githubIntegration.codeReviewer).toBeDefined();
      expect(githubIntegration.syncCoordinator).toBeDefined();
      expect(githubIntegration.metricsCollector).toBeDefined();
    });
  });

  describe('Repository Analysis', () => {
    test('should analyze repository with code quality analysis', async () => {
      const result = await githubIntegration.execute('github_repo_analyze', {
        repo: 'testowner/testrepo',
        analysis_type: 'code_quality'
      });

      expect(result.repo).toBe('testowner/testrepo');
      expect(result.analysis_type).toBe('code_quality');
      expect(result.repository).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.analysis.score).toBeGreaterThan(0);
    });

    test('should analyze repository with performance analysis', async () => {
      const result = await githubIntegration.execute('github_repo_analyze', {
        repo: 'testowner/testrepo',
        analysis_type: 'performance'
      });

      expect(result.analysis_type).toBe('performance');
      expect(result.analysis.metrics).toBeDefined();
      expect(result.analysis.metrics.buildTime).toBeDefined();
    });

    test('should analyze repository with security analysis', async () => {
      const result = await githubIntegration.execute('github_repo_analyze', {
        repo: 'testowner/testrepo',
        analysis_type: 'security'
      });

      expect(result.analysis_type).toBe('security');
      expect(result.analysis.vulnerabilities).toBeDefined();
      expect(Array.isArray(result.analysis.vulnerabilities)).toBe(true);
    });

    test('should analyze repository with dependency analysis', async () => {
      const result = await githubIntegration.execute('github_repo_analyze', {
        repo: 'testowner/testrepo',
        analysis_type: 'dependencies'
      });

      expect(result.analysis_type).toBe('dependencies');
      expect(result.analysis.total).toBeGreaterThanOrEqual(0);
      expect(result.analysis.outdated).toBeGreaterThanOrEqual(0);
      expect(result.analysis.vulnerable).toBeGreaterThanOrEqual(0);
    });

    test('should throw error for invalid repository format', async () => {
      await expect(
        githubIntegration.execute('github_repo_analyze', {
          repo: 'invalid-repo-format',
          analysis_type: 'code_quality'
        })
      ).rejects.toThrow('Repository must be in format owner/repo');
    });

    test('should throw error for unknown analysis type', async () => {
      await expect(
        githubIntegration.execute('github_repo_analyze', {
          repo: 'testowner/testrepo',
          analysis_type: 'unknown_type'
        })
      ).rejects.toThrow('Unknown analysis type: unknown_type');
    });
  });

  describe('Pull Request Management', () => {
    test('should review pull request', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'review',
        pr_number: 123
      });

      expect(result.repo).toBe('testowner/testrepo');
      expect(result.action).toBe('review');
      expect(result.pr_number).toBe(123);
      expect(result.result.status).toBe('reviewed');
    });

    test('should merge pull request', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'merge',
        pr_number: 123
      });

      expect(result.action).toBe('merge');
      expect(result.result.status).toBe('merged');
      expect(result.result.merge_commit).toBeDefined();
    });

    test('should close pull request', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'close',
        pr_number: 123
      });

      expect(result.action).toBe('close');
      expect(result.result.status).toBe('closed');
      expect(result.result.closed_at).toBeDefined();
    });

    test('should create pull request', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'create',
        options: { title: 'Test PR', base: 'main', head: 'feature' }
      });

      expect(result.action).toBe('create');
      expect(result.result.status).toBe('created');
      expect(result.result.pr_number).toBeGreaterThan(0);
    });

    test('should update pull request', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'update',
        pr_number: 123,
        options: { title: 'Updated PR Title' }
      });

      expect(result.action).toBe('update');
      expect(result.result.status).toBe('updated');
    });

    test('should list pull requests', async () => {
      const result = await githubIntegration.execute('github_pr_manage', {
        repo: 'testowner/testrepo',
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(result.result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.result.prs)).toBe(true);
    });

    test('should throw error for unknown PR action', async () => {
      await expect(
        githubIntegration.execute('github_pr_manage', {
          repo: 'testowner/testrepo',
          action: 'unknown_action',
          pr_number: 123
        })
      ).rejects.toThrow('Unknown PR action: unknown_action');
    });
  });

  describe('Issue Tracking', () => {
    test('should list issues', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(result.result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.result.issues)).toBe(true);
    });

    test('should create issue', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'create',
        options: { title: 'Test Issue', body: 'Issue description' }
      });

      expect(result.action).toBe('create');
      expect(result.result.status).toBe('created');
      expect(result.result.issue_number).toBeGreaterThan(0);
    });

    test('should update issue', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'update',
        issue_number: 45,
        options: { title: 'Updated Issue Title' }
      });

      expect(result.action).toBe('update');
      expect(result.issue_number).toBe(45);
      expect(result.result.status).toBe('updated');
    });

    test('should close issue', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'close',
        issue_number: 45
      });

      expect(result.action).toBe('close');
      expect(result.result.status).toBe('closed');
    });

    test('should assign issue', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'assign',
        issue_number: 45,
        options: { assignee: 'testuser' }
      });

      expect(result.action).toBe('assign');
      expect(result.result.status).toBe('assigned');
      expect(result.result.assignee).toBe('testuser');
    });

    test('should label issue', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'label',
        issue_number: 45,
        options: { labels: ['bug', 'high-priority'] }
      });

      expect(result.action).toBe('label');
      expect(result.result.status).toBe('labeled');
      expect(result.result.labels).toEqual(['bug', 'high-priority']);
    });

    test('should triage issues', async () => {
      const result = await githubIntegration.execute('github_issue_track', {
        repo: 'testowner/testrepo',
        action: 'triage'
      });

      expect(result.action).toBe('triage');
      expect(result.result.status).toBe('triaged');
      expect(result.result.processed).toBeGreaterThan(0);
      expect(result.result.categorized).toBeDefined();
    });

    test('should throw error for unknown issue action', async () => {
      await expect(
        githubIntegration.execute('github_issue_track', {
          repo: 'testowner/testrepo',
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown issue action: unknown_action');
    });
  });

  describe('Release Coordination', () => {
    test('should create release', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'create'
      });

      expect(result.action).toBe('create');
      expect(result.version).toBe('1.0.0');
      expect(result.result.status).toBe('created');
      expect(result.result.tag).toBe('v1.0.0');
    });

    test('should update release', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'update'
      });

      expect(result.action).toBe('update');
      expect(result.result.status).toBe('updated');
    });

    test('should publish release', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'publish'
      });

      expect(result.action).toBe('publish');
      expect(result.result.status).toBe('published');
      expect(result.result.published_at).toBeDefined();
    });

    test('should delete release', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'delete'
      });

      expect(result.action).toBe('delete');
      expect(result.result.status).toBe('deleted');
    });

    test('should list releases', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(result.result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.result.releases)).toBe(true);
    });

    test('should create draft release', async () => {
      const result = await githubIntegration.execute('github_release_coord', {
        repo: 'testowner/testrepo',
        version: '1.0.0',
        action: 'draft'
      });

      expect(result.action).toBe('draft');
      expect(result.result.status).toBe('draft_created');
      expect(result.result.draft).toBe(true);
    });

    test('should throw error for unknown release action', async () => {
      await expect(
        githubIntegration.execute('github_release_coord', {
          repo: 'testowner/testrepo',
          version: '1.0.0',
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown release action: unknown_action');
    });
  });

  describe('Workflow Automation', () => {
    test('should trigger workflow', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'ci.yml',
        action: 'trigger'
      });

      expect(result.action).toBe('trigger');
      expect(result.workflow).toBe('ci.yml');
      expect(result.result.status).toBe('triggered');
      expect(result.result.run_id).toBeGreaterThan(0);
    });

    test('should cancel workflow', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'ci.yml',
        action: 'cancel'
      });

      expect(result.action).toBe('cancel');
      expect(result.result.status).toBe('cancelled');
    });

    test('should list workflows', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'ci.yml',
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(result.result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.result.workflows)).toBe(true);
    });

    test('should get workflow status', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'ci.yml',
        action: 'status'
      });

      expect(result.action).toBe('status');
      expect(result.result.status).toBe('completed');
      expect(result.result.conclusion).toBeDefined();
    });

    test('should create workflow', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'new-workflow.yml',
        action: 'create'
      });

      expect(result.action).toBe('create');
      expect(result.result.status).toBe('created');
      expect(result.result.file_path).toBeDefined();
    });

    test('should update workflow', async () => {
      const result = await githubIntegration.execute('github_workflow_auto', {
        repo: 'testowner/testrepo',
        workflow: 'ci.yml',
        action: 'update'
      });

      expect(result.action).toBe('update');
      expect(result.result.status).toBe('updated');
    });

    test('should throw error for unknown workflow action', async () => {
      await expect(
        githubIntegration.execute('github_workflow_auto', {
          repo: 'testowner/testrepo',
          workflow: 'ci.yml',
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown workflow action: unknown_action');
    });
  });

  describe('Code Review', () => {
    test('should perform automated code review', async () => {
      const result = await githubIntegration.execute('github_code_review', {
        repo: 'testowner/testrepo',
        pr: 123,
        review_type: 'automated'
      });

      expect(result.repo).toBe('testowner/testrepo');
      expect(result.pr).toBe(123);
      expect(result.review_type).toBe('automated');
      expect(result.review.overall_score).toBeGreaterThan(0);
      expect(result.review.issues_found).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.review.suggestions)).toBe(true);
    });

    test('should perform manual code review', async () => {
      const result = await githubIntegration.execute('github_code_review', {
        repo: 'testowner/testrepo',
        pr: 123,
        review_type: 'manual'
      });

      expect(result.review_type).toBe('manual');
      expect(result.review.files_reviewed).toBeGreaterThan(0);
      expect(result.review.lines_reviewed).toBeGreaterThan(0);
    });
  });

  describe('Repository Sync Coordination', () => {
    test('should sync repositories', async () => {
      const result = await githubIntegration.execute('github_sync_coord', {
        repos: ['owner1/repo1', 'owner2/repo2'],
        action: 'sync'
      });

      expect(result.action).toBe('sync');
      expect(result.repositories).toEqual(['owner1/repo1', 'owner2/repo2']);
      expect(result.result.status).toBe('synced');
      expect(result.result.repositories).toBe(2);
    });

    test('should compare repositories', async () => {
      const result = await githubIntegration.execute('github_sync_coord', {
        repos: ['owner1/repo1', 'owner2/repo2'],
        action: 'compare'
      });

      expect(result.action).toBe('compare');
      expect(result.result.status).toBe('compared');
      expect(Array.isArray(result.result.differences)).toBe(true);
    });

    test('should merge repositories', async () => {
      const result = await githubIntegration.execute('github_sync_coord', {
        repos: ['owner1/repo1', 'owner2/repo2'],
        action: 'merge'
      });

      expect(result.action).toBe('merge');
      expect(result.result.status).toBe('merged');
      expect(result.result.conflicts_resolved).toBeGreaterThanOrEqual(0);
    });

    test('should get sync status', async () => {
      const result = await githubIntegration.execute('github_sync_coord', {
        repos: ['owner1/repo1', 'owner2/repo2'],
        action: 'status'
      });

      expect(result.action).toBe('status');
      expect(Array.isArray(result.result.repositories)).toBe(true);
      expect(result.result.repositories).toHaveLength(2);
    });

    test('should throw error for unknown sync action', async () => {
      await expect(
        githubIntegration.execute('github_sync_coord', {
          repos: ['owner1/repo1'],
          action: 'unknown_action'
        })
      ).rejects.toThrow('Unknown sync action: unknown_action');
    });
  });

  describe('Metrics Collection', () => {
    test('should collect all metrics', async () => {
      const result = await githubIntegration.execute('github_metrics', {
        repo: 'testowner/testrepo',
        metrics: ['all'],
        timeframe: '30d'
      });

      expect(result.repo).toBe('testowner/testrepo');
      expect(result.metrics).toEqual(['all']);
      expect(result.timeframe).toBe('30d');
      expect(result.data.metrics.commits).toBeDefined();
      expect(result.data.metrics.pull_requests).toBeDefined();
      expect(result.data.metrics.issues).toBeDefined();
      expect(result.data.metrics.contributors).toBeDefined();
    });

    test('should collect specific metrics', async () => {
      const result = await githubIntegration.execute('github_metrics', {
        repo: 'testowner/testrepo',
        metrics: ['commits', 'prs'],
        timeframe: '7d'
      });

      expect(result.metrics).toEqual(['commits', 'prs']);
      expect(result.data.metrics.commits).toBeDefined();
      expect(result.data.metrics.pull_requests).toBeDefined();
      expect(result.data.metrics.issues).toBeUndefined();
    });

    test('should collect metrics with default parameters', async () => {
      const result = await githubIntegration.execute('github_metrics', {
        repo: 'testowner/testrepo'
      });

      expect(result.metrics).toEqual(['all']);
      expect(result.timeframe).toBe('30d');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown tool', async () => {
      await expect(
        githubIntegration.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown GitHub tool: unknown_tool');
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await githubIntegration.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.initialized).toBe(true);
      expect(health.repositories).toBeGreaterThanOrEqual(0);
      expect(health.activeOperations).toBeGreaterThanOrEqual(0);
      expect(health.github.authenticated).toBe(true);
    });

    test('should report capabilities', () => {
      const capabilities = githubIntegration.getCapabilities();

      expect(capabilities).toContain('repository-analysis');
      expect(capabilities).toContain('pull-request-management');
      expect(capabilities).toContain('issue-tracking');
      expect(capabilities).toContain('release-coordination');
      expect(capabilities).toContain('workflow-automation');
      expect(capabilities).toContain('code-review');
      expect(capabilities).toContain('repository-sync');
      expect(capabilities).toContain('metrics-collection');
    });

    test('should report healthy when initialized', () => {
      expect(githubIntegration.isHealthy()).toBe(true);
    });

    test('should get rate limit information', async () => {
      const rateLimit = await githubIntegration.getRateLimit();

      expect(rateLimit.remaining).toBeGreaterThanOrEqual(0);
      expect(rateLimit.limit).toBeGreaterThan(0);
      expect(rateLimit.resetTime).toBeGreaterThan(Date.now());
    });
  });
});