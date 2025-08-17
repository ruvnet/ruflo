/**
 * GitHub Integration View - Interface for GitHub operations
 * Handles repository analysis, PR management, issue tracking, and more
 */

export default class GitHubIntegrationView {
  constructor(container, eventBus, viewConfig) {
    this.container = container;
    this.eventBus = eventBus;
    this.viewConfig = viewConfig;
    this.componentLibrary = null;
    this.repositories = new Map();
    this.pullRequests = new Map();
    this.issues = new Map();
    this.currentTab = 'overview';
    this.isInitialized = false;

    // GitHub tools
    this.githubTools = {
      repo_analyze: 'github_repo_analyze',
      pr_manage: 'github_pr_manage',
      issue_track: 'github_issue_track',
      release_coord: 'github_release_coord',
      workflow_auto: 'github_workflow_auto',
      code_review: 'github_code_review',
      sync_coord: 'github_sync_coord',
      metrics: 'github_metrics',
    };
  }

  /**
   * Initialize the GitHub integration view
   */
  async initialize() {
    if (this.isInitialized) return;

    // Get component library from event bus
    this.eventBus.emit('component-library:get', (library) => {
      this.componentLibrary = library;
    });

    // Setup event handlers
    this.setupEventHandlers();

    this.isInitialized = true;
  }

  /**
   * Render the view with given parameters
   */
  async render(params = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
      this.createGitHubInterface();
    } else {
      // Terminal mode
      this.renderTerminalMode(params);
    }
  }

  /**
   * Create GitHub interface for browser
   */
  createGitHubInterface() {
    // Create tab container
    const tabs = [
      { label: '🏠 Overview', content: this.createOverviewTab() },
      { label: '📁 Repositories', content: this.createRepositoriesTab() },
      { label: '🔄 Pull Requests', content: this.createPullRequestsTab() },
      { label: '📋 Issues', content: this.createIssuesTab() },
      { label: '🚀 Releases', content: this.createReleasesTab() },
      { label: '🤖 Automation', content: this.createAutomationTab() },
      { label: '📊 Analytics', content: this.createAnalyticsTab() },
      { label: '🔍 Code Review', content: this.createCodeReviewTab() },
    ];

    if (this.componentLibrary) {
      const tabContainer = this.componentLibrary.getComponent('TabContainer')(tabs);
      this.container.appendChild(tabContainer.element);
    } else {
      // Fallback without component library
      this.createFallbackInterface();
    }
  }

  /**
   * Create overview tab content
   */
  createOverviewTab() {
    return `
      <div class="github-overview">
        <div class="stats-grid">
          <div id="repos-stat" class="stat-card">
            <div class="stat-icon">📁</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Repositories</div>
            </div>
          </div>
          <div id="prs-stat" class="stat-card">
            <div class="stat-icon">🔄</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Open PRs</div>
            </div>
          </div>
          <div id="issues-stat" class="stat-card">
            <div class="stat-icon">📋</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Open Issues</div>
            </div>
          </div>
          <div id="workflows-stat" class="stat-card">
            <div class="stat-icon">⚡</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Active Workflows</div>
            </div>
          </div>
        </div>
        
        <div class="github-tools">
          <h3>🔧 Quick Actions</h3>
          <div class="tool-buttons">
            <button onclick="window.githubView.analyzeRepository()" class="github-btn primary">
              📊 Analyze Repository
            </button>
            <button onclick="window.githubView.createPullRequest()" class="github-btn secondary">
              🔄 Create PR
            </button>
            <button onclick="window.githubView.trackIssues()" class="github-btn secondary">
              📋 Track Issues
            </button>
            <button onclick="window.githubView.checkMetrics()" class="github-btn secondary">
              📈 View Metrics
            </button>
          </div>
        </div>

        <div class="recent-activity">
          <h3>📈 Recent GitHub Activity</h3>
          <div id="github-activity-log" class="activity-list">
            <div class="activity-item">
              <span class="activity-time">--:--</span>
              <span class="activity-desc">No recent activity</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create repositories tab content
   */
  createRepositoriesTab() {
    return `
      <div class="github-repositories">
        <div class="repo-management">
          <h3>📁 Repository Management</h3>
          
          <div class="repo-actions">
            <button onclick="window.githubView.browseRepositories()" class="github-btn primary">
              🔍 Browse Repositories
            </button>
            <button onclick="window.githubView.analyzeRepository()" class="github-btn secondary">
              📊 Analyze Repository
            </button>
            <button onclick="window.githubView.syncRepositories()" class="github-btn secondary">
              🔄 Sync Repos
            </button>
          </div>
          
          <div class="repo-search">
            <input type="text" id="repo-search" placeholder="Search repositories..." class="search-input">
          </div>
        </div>
        
        <div class="repo-analysis">
          <h3>📊 Repository Analysis</h3>
          <div class="analysis-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="analyze-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>Analysis Type:</label>
              <select id="analysis-type">
                <option value="code_quality">Code Quality</option>
                <option value="performance">Performance</option>
                <option value="security">Security</option>
              </select>
            </div>
            <button onclick="window.githubView.runRepoAnalysis()" class="github-btn primary">
              📊 Analyze
            </button>
          </div>
          
          <div id="analysis-results" class="analysis-display">
            <!-- Analysis results will appear here -->
          </div>
        </div>
        
        <div class="repo-list">
          <h3>📋 Repository List</h3>
          <div id="repositories-list" class="repo-grid">
            <!-- Repository cards will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create pull requests tab content
   */
  createPullRequestsTab() {
    return `
      <div class="github-pull-requests">
        <div class="pr-management">
          <h3>🔄 Pull Request Management</h3>
          
          <div class="pr-actions">
            <button onclick="window.githubView.createPullRequest()" class="github-btn primary">
              ➕ Create PR
            </button>
            <button onclick="window.githubView.reviewPullRequests()" class="github-btn secondary">
              👀 Review PRs
            </button>
            <button onclick="window.githubView.mergePullRequest()" class="github-btn secondary">
              🔀 Merge PR
            </button>
          </div>
        </div>
        
        <div class="pr-dashboard">
          <h3>📊 PR Dashboard</h3>
          <div class="pr-filters">
            <select id="pr-filter-status">
              <option value="all">All PRs</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="merged">Merged</option>
            </select>
            <select id="pr-filter-repo">
              <option value="">All Repositories</option>
            </select>
          </div>
          
          <div id="pr-list" class="pr-list">
            <!-- PR cards will be populated here -->
          </div>
        </div>
        
        <div class="pr-actions-panel">
          <h3>⚡ PR Actions</h3>
          <div class="form-group">
            <label>Repository:</label>
            <input type="text" id="pr-repo" placeholder="owner/repo">
          </div>
          <div class="form-group">
            <label>PR Number:</label>
            <input type="number" id="pr-number" placeholder="123">
          </div>
          <div class="form-group">
            <label>Action:</label>
            <select id="pr-action">
              <option value="review">Review</option>
              <option value="merge">Merge</option>
              <option value="close">Close</option>
            </select>
          </div>
          <button onclick="window.githubView.executePRAction()" class="github-btn primary">
            ⚡ Execute Action
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Create issues tab content
   */
  createIssuesTab() {
    return `
      <div class="github-issues">
        <div class="issue-tracking">
          <h3>📋 Issue Tracking & Triage</h3>
          
          <div class="issue-actions">
            <button onclick="window.githubView.createIssue()" class="github-btn primary">
              ➕ Create Issue
            </button>
            <button onclick="window.githubView.triageIssues()" class="github-btn secondary">
              🏷️ Triage Issues
            </button>
            <button onclick="window.githubView.trackIssues()" class="github-btn secondary">
              📊 Track Progress
            </button>
          </div>
        </div>
        
        <div class="issue-dashboard">
          <h3>📊 Issue Dashboard</h3>
          <div class="issue-stats">
            <div class="issue-stat">
              <span class="stat-label">Open</span>
              <span id="open-issues" class="stat-value">0</span>
            </div>
            <div class="issue-stat">
              <span class="stat-label">In Progress</span>
              <span id="progress-issues" class="stat-value">0</span>
            </div>
            <div class="issue-stat">
              <span class="stat-label">Closed</span>
              <span id="closed-issues" class="stat-value">0</span>
            </div>
          </div>
          
          <div class="issue-filters">
            <input type="text" id="issue-search" placeholder="Search issues..." class="search-input">
            <select id="issue-filter-label">
              <option value="">All Labels</option>
              <option value="bug">Bug</option>
              <option value="enhancement">Enhancement</option>
              <option value="documentation">Documentation</option>
            </select>
          </div>
          
          <div id="issue-list" class="issue-list">
            <!-- Issue cards will be populated here -->
          </div>
        </div>
        
        <div class="issue-triage">
          <h3>🏷️ Issue Triage</h3>
          <div class="triage-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="triage-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>Action:</label>
              <select id="triage-action">
                <option value="auto_label">Auto Label</option>
                <option value="assign">Auto Assign</option>
                <option value="prioritize">Prioritize</option>
              </select>
            </div>
            <button onclick="window.githubView.runTriage()" class="github-btn primary">
              🏷️ Run Triage
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create releases tab content
   */
  createReleasesTab() {
    return `
      <div class="github-releases">
        <div class="release-coordination">
          <h3>🚀 Release Coordination</h3>
          
          <div class="release-actions">
            <button onclick="window.githubView.createRelease()" class="github-btn primary">
              🚀 Create Release
            </button>
            <button onclick="window.githubView.coordinateRelease()" class="github-btn secondary">
              📅 Coordinate Release
            </button>
            <button onclick="window.githubView.checkReleaseStatus()" class="github-btn secondary">
              📊 Check Status
            </button>
          </div>
        </div>
        
        <div class="release-planning">
          <h3>📅 Release Planning</h3>
          <div class="release-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="release-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>Version:</label>
              <input type="text" id="release-version" placeholder="v1.0.0">
            </div>
            <div class="form-group">
              <label>Release Date:</label>
              <input type="date" id="release-date">
            </div>
            <div class="form-group">
              <label>Release Notes:</label>
              <textarea id="release-notes" placeholder="Enter release notes..."></textarea>
            </div>
            <button onclick="window.githubView.planRelease()" class="github-btn primary">
              📅 Plan Release
            </button>
          </div>
        </div>
        
        <div class="release-history">
          <h3>📋 Release History</h3>
          <div id="release-list" class="release-list">
            <!-- Release cards will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create automation tab content
   */
  createAutomationTab() {
    return `
      <div class="github-automation">
        <div class="workflow-automation">
          <h3>🤖 Workflow Automation</h3>
          
          <div class="automation-actions">
            <button onclick="window.githubView.createWorkflow()" class="github-btn primary">
              ➕ Create Workflow
            </button>
            <button onclick="window.githubView.manageWorkflows()" class="github-btn secondary">
              ⚙️ Manage Workflows
            </button>
            <button onclick="window.githubView.runWorkflow()" class="github-btn secondary">
              ▶️ Run Workflow
            </button>
          </div>
        </div>
        
        <div class="workflow-builder">
          <h3>🔧 Workflow Builder</h3>
          <div class="workflow-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="workflow-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>Workflow Name:</label>
              <input type="text" id="workflow-name" placeholder="CI/CD Pipeline">
            </div>
            <div class="form-group">
              <label>Trigger:</label>
              <select id="workflow-trigger">
                <option value="push">On Push</option>
                <option value="pull_request">On Pull Request</option>
                <option value="schedule">Scheduled</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div class="form-group">
              <label>Workflow Steps:</label>
              <textarea id="workflow-steps" placeholder="Define workflow steps..."></textarea>
            </div>
            <button onclick="window.githubView.buildWorkflow()" class="github-btn primary">
              🔨 Build Workflow
            </button>
          </div>
        </div>
        
        <div class="automation-templates">
          <h3>📋 Automation Templates</h3>
          <div class="template-grid">
            <div class="template-card">
              <h4>🧪 Test Automation</h4>
              <p>Automated testing on every PR</p>
              <button onclick="window.githubView.useTemplate('test')" class="github-btn">Use</button>
            </div>
            <div class="template-card">
              <h4>📦 Release Automation</h4>
              <p>Automated releases with changelog</p>
              <button onclick="window.githubView.useTemplate('release')" class="github-btn">Use</button>
            </div>
            <div class="template-card">
              <h4>🔍 Code Review</h4>
              <p>Automated code review checks</p>
              <button onclick="window.githubView.useTemplate('review')" class="github-btn">Use</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create analytics tab content
   */
  createAnalyticsTab() {
    return `
      <div class="github-analytics">
        <div class="metrics-overview">
          <h3>📊 Repository Metrics</h3>
          
          <div class="metrics-actions">
            <button onclick="window.githubView.fetchMetrics()" class="github-btn primary">
              📊 Fetch Metrics
            </button>
            <button onclick="window.githubView.generateReport()" class="github-btn secondary">
              📄 Generate Report
            </button>
            <button onclick="window.githubView.exportMetrics()" class="github-btn secondary">
              💾 Export Data
            </button>
          </div>
        </div>
        
        <div class="metrics-dashboard">
          <h3>📈 Metrics Dashboard</h3>
          <div class="metrics-grid">
            <div class="metric-card">
              <h4>📝 Commits</h4>
              <div id="commits-chart" class="chart-container">
                <!-- Commits chart will be rendered here -->
              </div>
              <div class="metric-stats">
                <span>Total: <span id="total-commits">0</span></span>
                <span>This Week: <span id="week-commits">0</span></span>
              </div>
            </div>
            
            <div class="metric-card">
              <h4>🔄 Pull Requests</h4>
              <div id="pr-chart" class="chart-container">
                <!-- PR chart will be rendered here -->
              </div>
              <div class="metric-stats">
                <span>Merged: <span id="merged-prs">0</span></span>
                <span>Avg Time: <span id="avg-pr-time">--</span></span>
              </div>
            </div>
            
            <div class="metric-card">
              <h4>📋 Issues</h4>
              <div id="issues-chart" class="chart-container">
                <!-- Issues chart will be rendered here -->
              </div>
              <div class="metric-stats">
                <span>Resolved: <span id="resolved-issues">0</span></span>
                <span>Avg Time: <span id="avg-issue-time">--</span></span>
              </div>
            </div>
            
            <div class="metric-card">
              <h4>👥 Contributors</h4>
              <div id="contributors-chart" class="chart-container">
                <!-- Contributors chart will be rendered here -->
              </div>
              <div class="metric-stats">
                <span>Active: <span id="active-contributors">0</span></span>
                <span>New: <span id="new-contributors">0</span></span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="custom-metrics">
          <h3>🎯 Custom Metrics</h3>
          <div class="custom-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="metrics-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>Metric Type:</label>
              <select id="metric-type">
                <option value="code_churn">Code Churn</option>
                <option value="review_time">Review Time</option>
                <option value="deployment_frequency">Deployment Frequency</option>
                <option value="lead_time">Lead Time</option>
              </select>
            </div>
            <div class="form-group">
              <label>Time Period:</label>
              <select id="metric-period">
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="1y">Last year</option>
              </select>
            </div>
            <button onclick="window.githubView.analyzeMetric()" class="github-btn primary">
              📊 Analyze
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create code review tab content
   */
  createCodeReviewTab() {
    return `
      <div class="github-code-review">
        <div class="review-automation">
          <h3>🔍 Automated Code Review</h3>
          
          <div class="review-actions">
            <button onclick="window.githubView.startCodeReview()" class="github-btn primary">
              🔍 Start Review
            </button>
            <button onclick="window.githubView.configureReview()" class="github-btn secondary">
              ⚙️ Configure Rules
            </button>
            <button onclick="window.githubView.viewReviewHistory()" class="github-btn secondary">
              📋 Review History
            </button>
          </div>
        </div>
        
        <div class="review-configuration">
          <h3>⚙️ Review Configuration</h3>
          <div class="config-form">
            <div class="form-group">
              <label>Repository:</label>
              <input type="text" id="review-repo" placeholder="owner/repo">
            </div>
            <div class="form-group">
              <label>PR Number:</label>
              <input type="number" id="review-pr" placeholder="123">
            </div>
            <div class="form-group">
              <label>Review Type:</label>
              <select id="review-type">
                <option value="full">Full Review</option>
                <option value="security">Security Focus</option>
                <option value="performance">Performance Focus</option>
                <option value="style">Code Style</option>
              </select>
            </div>
            <div class="form-group">
              <label>Auto-Suggestions:</label>
              <input type="checkbox" id="auto-suggestions" checked>
            </div>
            <button onclick="window.githubView.runCodeReview()" class="github-btn primary">
              🔍 Run Review
            </button>
          </div>
        </div>
        
        <div class="review-results">
          <h3>📊 Review Results</h3>
          <div id="review-summary" class="review-summary">
            <!-- Review summary will appear here -->
          </div>
          
          <div id="review-findings" class="review-findings">
            <!-- Review findings will be listed here -->
          </div>
        </div>
        
        <div class="review-rules">
          <h3>📋 Review Rules</h3>
          <div class="rules-list">
            <div class="rule-item">
              <input type="checkbox" checked>
              <span>Check for security vulnerabilities</span>
            </div>
            <div class="rule-item">
              <input type="checkbox" checked>
              <span>Verify test coverage</span>
            </div>
            <div class="rule-item">
              <input type="checkbox" checked>
              <span>Check code complexity</span>
            </div>
            <div class="rule-item">
              <input type="checkbox" checked>
              <span>Validate documentation</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create fallback interface without component library
   */
  createFallbackInterface() {
    this.container.innerHTML = `
      <div class="github-fallback">
        <h2>🐙 GitHub Integration</h2>
        <p>Complete GitHub operations interface with 8 integrated tools</p>
        
        <div class="tool-sections">
          <div class="tool-section">
            <h3>📁 Repository Management</h3>
            <button onclick="window.githubView.quickAction('github_repo_analyze')">Analyze Repository</button>
            <button onclick="window.githubView.quickAction('github_sync_coord')">Sync Repositories</button>
            <button onclick="window.githubView.quickAction('github_metrics')">View Metrics</button>
          </div>
          
          <div class="tool-section">
            <h3>🔄 PR & Issues</h3>
            <button onclick="window.githubView.quickAction('github_pr_manage')">Manage PRs</button>
            <button onclick="window.githubView.quickAction('github_issue_track')">Track Issues</button>
            <button onclick="window.githubView.quickAction('github_code_review')">Code Review</button>
          </div>
          
          <div class="tool-section">
            <h3>🚀 Automation</h3>
            <button onclick="window.githubView.quickAction('github_workflow_auto')">Workflow Automation</button>
            <button onclick="window.githubView.quickAction('github_release_coord')">Release Coordination</button>
          </div>
        </div>
        
        <div id="github-output" class="output-area">
          <h3>📊 Output</h3>
          <pre id="output-content">Ready for GitHub operations...</pre>
        </div>
      </div>
    `;
  }

  /**
   * Render terminal mode
   */
  renderTerminalMode(params) {
    console.log('\n🐙 GitHub Integration Operations');
    console.log('═'.repeat(50));
    console.log('Available Tools (8):');
    console.log('  📊 github_repo_analyze   - Repository analysis');
    console.log('  🔄 github_pr_manage      - PR management');
    console.log('  📋 github_issue_track    - Issue tracking');
    console.log('  🚀 github_release_coord  - Release coordination');
    console.log('  🤖 github_workflow_auto  - Workflow automation');
    console.log('  🔍 github_code_review    - Code reviews');
    console.log('  🔄 github_sync_coord     - Multi-repo sync');
    console.log('  📊 github_metrics        - Repository metrics');
    console.log('═'.repeat(50));

    if (params.tool) {
      console.log(`\n🔧 Executing: ${params.tool}`);
      this.quickAction(params.tool, params);
    }
  }

  /**
   * Quick action handler
   */
  async quickAction(toolName, params = {}) {
    try {
      console.log(`🔧 Executing ${toolName}...`);

      // Emit tool execution event
      this.eventBus.emit('tool:execute', {
        tool: toolName,
        params: params,
        source: 'github-view',
      });

      // Handle specific tool actions
      switch (toolName) {
        case 'github_repo_analyze':
          await this.handleRepoAnalysis(params);
          break;
        case 'github_pr_manage':
          await this.handlePRManagement(params);
          break;
        case 'github_issue_track':
          await this.handleIssueTracking(params);
          break;
        case 'github_code_review':
          await this.handleCodeReview(params);
          break;
        default:
          console.log(`Tool ${toolName} executed`);
      }
    } catch (error) {
      console.error(`❌ Error executing ${toolName}:`, error);
    }
  }

  /**
   * Handle repository analysis
   */
  async handleRepoAnalysis(params) {
    const analysisParams = {
      repo: params.repo || 'owner/repo',
      analysis_type: params.analysis_type || 'code_quality',
    };

    console.log('📊 Analyzing repository with parameters:', analysisParams);

    // Update UI if in browser mode
    if (this.container) {
      const resultsEl = document.getElementById('analysis-results');
      if (resultsEl) {
        resultsEl.innerHTML = '<div class="analysis-running">Analysis in progress...</div>';
      }
    }
  }

  /**
   * Handle PR management
   */
  async handlePRManagement(params) {
    const prParams = {
      repo: params.repo || 'owner/repo',
      action: params.action || 'review',
      pr_number: params.pr_number,
    };

    console.log('🔄 Managing PR with parameters:', prParams);

    // Update UI if in browser mode
    if (this.container) {
      this.updatePRList();
    }
  }

  /**
   * Handle issue tracking
   */
  async handleIssueTracking(params) {
    const issueParams = {
      repo: params.repo || 'owner/repo',
      action: params.action || 'track',
    };

    console.log('📋 Tracking issues with parameters:', issueParams);

    // Update UI if in browser mode
    if (this.container) {
      this.updateIssueList();
    }
  }

  /**
   * Handle code review
   */
  async handleCodeReview(params) {
    const reviewParams = {
      repo: params.repo || 'owner/repo',
      pr: params.pr || 1,
      type: params.type || 'full',
    };

    console.log('🔍 Running code review with parameters:', reviewParams);

    // Update UI if in browser mode
    if (this.container) {
      const summaryEl = document.getElementById('review-summary');
      if (summaryEl) {
        summaryEl.innerHTML = '<div class="review-running">Code review in progress...</div>';
      }
    }
  }

  /**
   * Repository analysis functions
   */
  async analyzeRepository() {
    const repo =
      document.getElementById('analyze-repo')?.value || prompt('Enter repository (owner/repo):');
    if (!repo) return;

    this.quickAction('github_repo_analyze', { repo });
  }

  async runRepoAnalysis() {
    const repo = document.getElementById('analyze-repo')?.value;
    const analysisType = document.getElementById('analysis-type')?.value;

    if (!repo) {
      alert('Please enter a repository');
      return;
    }

    this.quickAction('github_repo_analyze', { repo, analysis_type: analysisType });
  }

  /**
   * PR management functions
   */
  async createPullRequest() {
    const repo = prompt('Enter repository (owner/repo):');
    if (!repo) return;

    console.log('🔄 Creating pull request for:', repo);
    this.eventBus.emit('tool:execute', {
      tool: 'github_pr_create',
      params: { repo },
      source: 'github-view',
    });
  }

  async executePRAction() {
    const repo = document.getElementById('pr-repo')?.value;
    const prNumber = document.getElementById('pr-number')?.value;
    const action = document.getElementById('pr-action')?.value;

    if (!repo || !prNumber) {
      alert('Please enter repository and PR number');
      return;
    }

    this.quickAction('github_pr_manage', { repo, pr_number: prNumber, action });
  }

  /**
   * Issue tracking functions
   */
  async trackIssues() {
    const repo = prompt('Enter repository (owner/repo):');
    if (!repo) return;

    this.quickAction('github_issue_track', { repo, action: 'track' });
  }

  async runTriage() {
    const repo = document.getElementById('triage-repo')?.value;
    const action = document.getElementById('triage-action')?.value;

    if (!repo) {
      alert('Please enter a repository');
      return;
    }

    this.quickAction('github_issue_track', { repo, action });
  }

  /**
   * Metrics functions
   */
  async checkMetrics() {
    const repo = prompt('Enter repository (owner/repo):');
    if (!repo) return;

    this.quickAction('github_metrics', { repo });
  }

  async fetchMetrics() {
    const repo =
      document.getElementById('metrics-repo')?.value || prompt('Enter repository (owner/repo):');
    if (!repo) return;

    this.quickAction('github_metrics', { repo });
  }

  /**
   * Code review functions
   */
  async startCodeReview() {
    const repo =
      document.getElementById('review-repo')?.value || prompt('Enter repository (owner/repo):');
    const pr = document.getElementById('review-pr')?.value || prompt('Enter PR number:');

    if (!repo || !pr) return;

    this.quickAction('github_code_review', { repo, pr });
  }

  async runCodeReview() {
    const repo = document.getElementById('review-repo')?.value;
    const pr = document.getElementById('review-pr')?.value;
    const reviewType = document.getElementById('review-type')?.value;

    if (!repo || !pr) {
      alert('Please enter repository and PR number');
      return;
    }

    this.quickAction('github_code_review', { repo, pr, type: reviewType });
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Listen for tool results
    this.eventBus.on('tool:executed', (data) => {
      if (data.source === 'github-view') {
        this.handleToolResult(data);
      }
    });

    // Listen for real-time updates
    this.eventBus.on('ui:real-time:update', () => {
      this.updateStats();
    });

    // Listen for repository updates
    this.eventBus.on('github:repo:updated', (data) => {
      this.updateRepositoryList(data);
    });

    // Listen for PR updates
    this.eventBus.on('github:pr:updated', (data) => {
      this.updatePRList(data);
    });

    // Listen for issue updates
    this.eventBus.on('github:issue:updated', (data) => {
      this.updateIssueList(data);
    });

    // Make this view instance globally accessible for button handlers
    if (typeof window !== 'undefined') {
      window.githubView = this;
    }
  }

  /**
   * Handle tool execution results
   */
  handleToolResult(data) {
    console.log(`✅ Tool ${data.tool} completed:`, data.result);

    // Update UI based on result
    if (this.container) {
      this.updateUIWithResult(data.tool, data.result);
    }
  }

  /**
   * Update UI with tool results
   */
  updateUIWithResult(toolName, result) {
    switch (toolName) {
      case 'github_repo_analyze':
        this.updateAnalysisResults(result);
        break;
      case 'github_pr_manage':
        this.updatePRResults(result);
        break;
      case 'github_issue_track':
        this.updateIssueResults(result);
        break;
      case 'github_code_review':
        this.updateReviewResults(result);
        break;
      case 'github_metrics':
        this.updateMetricsResults(result);
        break;
    }
  }

  /**
   * Update analysis results
   */
  updateAnalysisResults(result) {
    const resultsEl = document.getElementById('analysis-results');
    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="analysis-complete">
          <h4>📊 Analysis Complete</h4>
          <div class="analysis-scores">
            <div class="score-item">
              <span class="score-label">Code Quality:</span>
              <span class="score-value">${result.code_quality || 'N/A'}</span>
            </div>
            <div class="score-item">
              <span class="score-label">Security:</span>
              <span class="score-value">${result.security || 'N/A'}</span>
            </div>
            <div class="score-item">
              <span class="score-label">Performance:</span>
              <span class="score-value">${result.performance || 'N/A'}</span>
            </div>
          </div>
          <div class="analysis-details">${result.details || ''}</div>
        </div>
      `;
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    // Update repository count
    const reposStatEl = document.getElementById('repos-stat');
    if (reposStatEl) {
      const valueEl = reposStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.repositories.size;
    }

    // Update PR count
    const prsStatEl = document.getElementById('prs-stat');
    if (prsStatEl) {
      const valueEl = prsStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.pullRequests.size;
    }

    // Update issue count
    const issuesStatEl = document.getElementById('issues-stat');
    if (issuesStatEl) {
      const valueEl = issuesStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.issues.size;
    }
  }

  /**
   * Update repository list
   */
  updateRepositoryList(data) {
    const listEl = document.getElementById('repositories-list');
    if (listEl) {
      // Update repository cards
      console.log('Updating repository list:', data);
    }
  }

  /**
   * Update PR list
   */
  updatePRList(data) {
    const listEl = document.getElementById('pr-list');
    if (listEl) {
      // Update PR cards
      console.log('Updating PR list:', data);
    }
  }

  /**
   * Update issue list
   */
  updateIssueList(data) {
    const listEl = document.getElementById('issue-list');
    if (listEl) {
      // Update issue cards
      console.log('Updating issue list:', data);
    }
  }

  /**
   * Update review results
   */
  updateReviewResults(result) {
    const summaryEl = document.getElementById('review-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="review-complete">
          <h4>🔍 Review Complete</h4>
          <div class="review-score">Overall Score: ${result.score || 'N/A'}</div>
          <div class="review-stats">
            <span>Issues Found: ${result.issues || 0}</span>
            <span>Suggestions: ${result.suggestions || 0}</span>
          </div>
        </div>
      `;
    }

    const findingsEl = document.getElementById('review-findings');
    if (findingsEl && result.findings) {
      findingsEl.innerHTML = result.findings
        .map(
          (finding) => `
        <div class="finding-item">
          <span class="finding-type">${finding.type}</span>
          <span class="finding-desc">${finding.description}</span>
        </div>
      `,
        )
        .join('');
    }
  }

  /**
   * Update metrics results
   */
  updateMetricsResults(result) {
    // Update metric values
    if (result.commits) {
      const commitsEl = document.getElementById('total-commits');
      if (commitsEl) commitsEl.textContent = result.commits.total || 0;
    }

    if (result.pull_requests) {
      const mergedEl = document.getElementById('merged-prs');
      if (mergedEl) mergedEl.textContent = result.pull_requests.merged || 0;
    }

    if (result.issues) {
      const resolvedEl = document.getElementById('resolved-issues');
      if (resolvedEl) resolvedEl.textContent = result.issues.resolved || 0;
    }
  }

  /**
   * Destroy view and cleanup
   */
  destroy() {
    // Clear any intervals or timeouts
    // Remove event listeners
    // Clean up resources
    console.log('🐙 GitHub Integration View destroyed');
  }
}

// Make view accessible globally for button handlers
if (typeof window !== 'undefined') {
  window.githubView = null;
}

// Add GitHub-specific styles
if (typeof document !== 'undefined') {
  const githubStyles = document.createElement('style');
  githubStyles.textContent = `
    .github-overview {
      padding: 20px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .stat-card {
      display: flex;
      align-items: center;
      background: #2a2a2a;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #444;
    }
    
    .stat-icon {
      font-size: 24px;
      margin-right: 12px;
    }
    
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #00d4ff;
    }
    
    .stat-label {
      color: #888;
      font-size: 14px;
    }
    
    .github-tools {
      margin: 24px 0;
    }
    
    .tool-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .github-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .github-btn.primary {
      background: #00d4ff;
      color: #000;
    }
    
    .github-btn.primary:hover {
      background: #00b8e6;
    }
    
    .github-btn.secondary {
      background: #444;
      color: #fff;
    }
    
    .github-btn.secondary:hover {
      background: #555;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 4px;
      color: #fff;
      font-weight: 500;
    }
    
    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 8px 12px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .form-group textarea {
      height: 100px;
      resize: vertical;
    }
    
    .search-input {
      width: 100%;
      padding: 8px 12px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      margin: 16px 0;
    }
    
    .repo-grid,
    .pr-list,
    .issue-list,
    .release-list {
      display: grid;
      gap: 16px;
      margin-top: 16px;
    }
    
    .template-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    
    .template-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
    }
    
    .template-card h4 {
      margin: 0 0 8px 0;
      color: #00d4ff;
    }
    
    .template-card p {
      margin: 0 0 12px 0;
      color: #888;
      font-size: 14px;
    }
    
    .metric-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
    }
    
    .metric-card h4 {
      margin: 0 0 12px 0;
      color: #fff;
    }
    
    .chart-container {
      height: 150px;
      background: #1a1a1a;
      border-radius: 4px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
    }
    
    .metric-stats {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
    }
    
    .metric-stats span {
      color: #888;
    }
    
    .metric-stats span span {
      color: #00d4ff;
      font-weight: bold;
    }
    
    .pr-filters,
    .issue-filters {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .pr-filters select,
    .issue-filters select {
      flex: 1;
      padding: 8px 12px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .issue-stats {
      display: flex;
      gap: 24px;
      margin: 16px 0;
    }
    
    .issue-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .issue-stat .stat-label {
      font-size: 14px;
      color: #888;
    }
    
    .issue-stat .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #00d4ff;
    }
    
    .analysis-display,
    .review-summary,
    .review-findings {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 16px;
      margin-top: 16px;
    }
    
    .analysis-scores,
    .review-stats {
      display: flex;
      gap: 24px;
      margin: 12px 0;
    }
    
    .score-item {
      display: flex;
      gap: 8px;
    }
    
    .score-label {
      color: #888;
    }
    
    .score-value {
      color: #00d4ff;
      font-weight: bold;
    }
    
    .rules-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .rule-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
    }
    
    .rule-item input[type="checkbox"] {
      width: auto;
    }
    
    .finding-item {
      display: flex;
      gap: 12px;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    
    .finding-type {
      padding: 2px 8px;
      background: #444;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
    }
    
    .finding-desc {
      flex: 1;
      color: #ccc;
    }
    
    .activity-list {
      max-height: 200px;
      overflow-y: auto;
    }
    
    .activity-item {
      display: flex;
      gap: 12px;
      padding: 8px;
      border-bottom: 1px solid #333;
    }
    
    .activity-time {
      color: #666;
      font-size: 12px;
    }
    
    .activity-desc {
      color: #ccc;
      flex: 1;
    }
  `;
  document.head.appendChild(githubStyles);
}
