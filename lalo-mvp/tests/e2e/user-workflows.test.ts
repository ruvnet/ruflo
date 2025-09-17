/**
 * LALO MVP End-to-End User Workflow Tests
 * Tests complete user journeys and real-world scenarios
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

// Test configuration
const CONFIG = {
  baseURL: process.env.LALO_BASE_URL || 'http://localhost:3000',
  timeout: 30000,
  users: {
    analyst: {
      email: 'analyst@example.com',
      password: 'TestPass123!',
      role: 'analyst',
      permissions: ['read:data', 'read:analytics', 'write:reports']
    },
    viewer: {
      email: 'viewer@example.com',
      password: 'ViewPass123!',
      role: 'viewer',
      permissions: ['read:basic']
    },
    admin: {
      email: 'admin@example.com',
      password: 'AdminPass123!',
      role: 'admin',
      permissions: ['*:*']
    }
  }
};

// Helper functions
async function loginUser(page: Page, userType: keyof typeof CONFIG.users) {
  const user = CONFIG.users[userType];

  await page.goto('/login');
  await page.fill('[data-testid="email"]', user.email);
  await page.fill('[data-testid="password"]', user.password);
  await page.click('[data-testid="login-button"]');

  // Wait for successful login
  await page.waitForURL('/dashboard');
  await expect(page.locator('[data-testid="user-role"]')).toContainText(user.role);
}

async function submitQuery(page: Page, query: string) {
  await page.fill('[data-testid="query-input"]', query);
  await page.click('[data-testid="submit-query"]');

  // Wait for processing to complete
  await page.waitForSelector('[data-testid="query-results"]', { timeout: 30000 });
}

test.describe('LALO MVP User Workflows', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test environment
    await page.goto('/');

    // Clear any existing session data
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test.describe('Authentication and Authorization', () => {
    test('should allow valid user login', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Verify dashboard elements are visible
      await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();
      await expect(page.locator('[data-testid="query-interface"]')).toBeVisible();
      await expect(page.locator('[data-testid="user-profile"]')).toContainText('analyst@example.com');
    });

    test('should reject invalid credentials', async ({ page }) => {
      await page.goto('/login');
      await page.fill('[data-testid="email"]', 'invalid@example.com');
      await page.fill('[data-testid="password"]', 'wrongpassword');
      await page.click('[data-testid="login-button"]');

      await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid credentials');
      await expect(page).toHaveURL('/login');
    });

    test('should enforce role-based access control', async ({ page }) => {
      await loginUser(page, 'viewer');

      // Try to access admin features
      await page.goto('/admin');
      await expect(page.locator('[data-testid="access-denied"]')).toBeVisible();
      await expect(page.locator('[data-testid="access-denied"]')).toContainText('insufficient permissions');
    });
  });

  test.describe('Natural Language Query Processing', () => {
    test('should process simple data queries', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Show me all users created this month');

      // Verify results
      await expect(page.locator('[data-testid="query-results"]')).toBeVisible();
      await expect(page.locator('[data-testid="sql-query"]')).toContainText('SELECT');
      await expect(page.locator('[data-testid="sql-query"]')).toContainText('created_at');
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible();

      // Check execution metadata
      await expect(page.locator('[data-testid="execution-time"]')).toBeVisible();
      await expect(page.locator('[data-testid="components-used"]')).toContainText('nl2sql');
    });

    test('should handle complex analytical queries', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Analyze user engagement patterns and show top performing departments with their growth rates');

      // Verify complex query processing
      await expect(page.locator('[data-testid="query-complexity"]')).toContainText('complex');
      await expect(page.locator('[data-testid="components-used"]')).toContainText('rag');
      await expect(page.locator('[data-testid="components-used"]')).toContainText('nl2sql');
      await expect(page.locator('[data-testid="components-used"]')).toContainText('langgraph');

      // Check for visualizations
      await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
      await expect(page.locator('[data-testid="insights-panel"]')).toBeVisible();
    });

    test('should use RAG for context-enriched queries', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'What are the best practices for user retention based on our documentation?');

      // Verify RAG integration
      await expect(page.locator('[data-testid="rag-documents"]')).toBeVisible();
      await expect(page.locator('[data-testid="document-sources"]')).toContainText('documentation');
      await expect(page.locator('[data-testid="relevance-scores"]')).toBeVisible();

      // Check that response includes documentation-based insights
      await expect(page.locator('[data-testid="ai-response"]')).toContainText('best practices');
      await expect(page.locator('[data-testid="confidence-score"]')).toBeVisible();
    });
  });

  test.describe('Governance and Security', () => {
    test('should enforce data access restrictions', async ({ page }) => {
      await loginUser(page, 'viewer');

      await submitQuery(page, 'Show me all employee salaries and social security numbers');

      // Should be blocked by governance
      await expect(page.locator('[data-testid="access-denied"]')).toBeVisible();
      await expect(page.locator('[data-testid="governance-message"]')).toContainText('insufficient permissions');
      await expect(page.locator('[data-testid="required-permissions"]')).toBeVisible();
    });

    test('should log all access attempts for audit', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Show user activity logs');

      // Navigate to audit trail (if user has permission)
      await page.click('[data-testid="audit-trail"]');

      await expect(page.locator('[data-testid="audit-entries"]')).toBeVisible();
      await expect(page.locator('[data-testid="audit-entry"]').first()).toContainText('query_execution');
      await expect(page.locator('[data-testid="audit-timestamp"]').first()).toBeVisible();
    });

    test('should handle sensitive data with proper masking', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Generate user report with contact information');

      // Check that sensitive data is masked
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible();

      // Email should be partially masked (e.g., j***@example.com)
      const emailCells = page.locator('[data-testid="email-cell"]');
      await expect(emailCells.first()).toContainText('***');

      // Check data masking indicator
      await expect(page.locator('[data-testid="data-masked-indicator"]')).toBeVisible();
    });
  });

  test.describe('Workflow Orchestration', () => {
    test('should execute multi-step workflows', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Create comprehensive user engagement report with visualizations');

      // Monitor workflow progress
      await expect(page.locator('[data-testid="workflow-progress"]')).toBeVisible();

      // Wait for each step to complete
      await expect(page.locator('[data-testid="step-auth"]')).toHaveClass(/completed/);
      await expect(page.locator('[data-testid="step-validate"]')).toHaveClass(/completed/);
      await expect(page.locator('[data-testid="step-process"]')).toHaveClass(/completed/);
      await expect(page.locator('[data-testid="step-generate"]')).toHaveClass(/completed/);

      // Verify final output
      await expect(page.locator('[data-testid="report-container"]')).toBeVisible();
      await expect(page.locator('[data-testid="chart-engagement"]')).toBeVisible();
      await expect(page.locator('[data-testid="export-options"]')).toBeVisible();
    });

    test('should handle workflow errors gracefully', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Submit query that will cause a workflow error
      await submitQuery(page, 'Query with intentional syntax error !!!invalid!!!');

      // Check error handling
      await expect(page.locator('[data-testid="error-container"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText('workflow error');
      await expect(page.locator('[data-testid="recovery-suggestions"]')).toBeVisible();

      // Verify system remains stable
      await expect(page.locator('[data-testid="query-interface"]')).toBeVisible();
      await expect(page.locator('[data-testid="try-again-button"]')).toBeVisible();
    });
  });

  test.describe('Performance and Responsiveness', () => {
    test('should respond to queries within acceptable timeframes', async ({ page }) => {
      await loginUser(page, 'analyst');

      const startTime = Date.now();

      await submitQuery(page, 'Show recent user activity');

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Should complete within 5 seconds
      expect(responseTime).toBeLessThan(5000);

      // Check performance metrics display
      await expect(page.locator('[data-testid="execution-time"]')).toBeVisible();
      const executionTimeText = await page.locator('[data-testid="execution-time"]').textContent();
      const executionTime = parseInt(executionTimeText?.match(/\\d+/)?.[0] || '0');

      expect(executionTime).toBeLessThan(2000); // 2 seconds server-side execution
    });

    test('should handle concurrent users efficiently', async ({ browser }) => {
      // Create multiple browser contexts for concurrent users
      const contexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
        browser.newContext()
      ]);

      const pages = await Promise.all(contexts.map(context => context.newPage()));

      // Login different users concurrently
      await Promise.all([
        loginUser(pages[0], 'analyst'),
        loginUser(pages[1], 'viewer'),
        loginUser(pages[2], 'admin')
      ]);

      // Submit queries concurrently
      const startTime = Date.now();

      await Promise.all([
        submitQuery(pages[0], 'Show user statistics'),
        submitQuery(pages[1], 'Show public data'),
        submitQuery(pages[2], 'Show system health')
      ]);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All queries should complete within reasonable time
      expect(totalTime).toBeLessThan(10000); // 10 seconds for all concurrent queries

      // Verify all pages show results
      for (const page of pages) {
        await expect(page.locator('[data-testid="query-results"]')).toBeVisible();
      }

      // Cleanup
      await Promise.all(contexts.map(context => context.close()));
    });
  });

  test.describe('Data Export and Reporting', () => {
    test('should export query results in multiple formats', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Show department performance metrics');

      // Test CSV export
      const [csvDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('[data-testid="export-csv"]')
      ]);

      expect(csvDownload.suggestedFilename()).toContain('.csv');

      // Test JSON export
      const [jsonDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.click('[data-testid="export-json"]')
      ]);

      expect(jsonDownload.suggestedFilename()).toContain('.json');

      // Test report generation
      await page.click('[data-testid="generate-report"]');
      await expect(page.locator('[data-testid="report-builder"]')).toBeVisible();

      // Configure report
      await page.selectOption('[data-testid="report-template"]', 'executive-summary');
      await page.click('[data-testid="include-charts"]');
      await page.click('[data-testid="create-report"]');

      // Wait for report generation
      await expect(page.locator('[data-testid="report-preview"]')).toBeVisible();
      await expect(page.locator('[data-testid="report-title"]')).toContainText('Department Performance');
    });
  });

  test.describe('Real-time Features', () => {
    test('should show live query execution progress', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Submit a complex query that takes time to process
      await page.fill('[data-testid="query-input"]', 'Generate comprehensive analytics dashboard with all user data');
      await page.click('[data-testid="submit-query"]');

      // Monitor live progress
      await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();
      await expect(page.locator('[data-testid="current-step"]')).toContainText('Processing');

      // Check component status updates
      await expect(page.locator('[data-testid="component-status-governance"]')).toContainText('completed');
      await expect(page.locator('[data-testid="component-status-rag"]')).toContainText('processing');

      // Wait for completion
      await page.waitForSelector('[data-testid="query-results"]', { timeout: 30000 });
      await expect(page.locator('[data-testid="progress-bar"]')).toHaveClass(/complete/);
    });

    test('should support query cancellation', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Submit a long-running query
      await page.fill('[data-testid="query-input"]', 'Generate extremely complex report with all historical data');
      await page.click('[data-testid="submit-query"]');

      // Wait for processing to start
      await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();

      // Cancel the query
      await page.click('[data-testid="cancel-query"]');

      // Verify cancellation
      await expect(page.locator('[data-testid="query-cancelled"]')).toBeVisible();
      await expect(page.locator('[data-testid="query-cancelled"]')).toContainText('cancelled');

      // Verify system is ready for new queries
      await expect(page.locator('[data-testid="query-input"]')).toBeEnabled();
    });
  });

  test.describe('Error Handling and Recovery', () => {
    test('should handle network connectivity issues', async ({ page, context }) => {
      await loginUser(page, 'analyst');

      // Submit a query
      await page.fill('[data-testid="query-input"]', 'Show user data');

      // Simulate network failure
      await context.setOffline(true);
      await page.click('[data-testid="submit-query"]');

      // Check offline handling
      await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible();
      await expect(page.locator('[data-testid="offline-message"]')).toContainText('connection lost');

      // Restore connection
      await context.setOffline(false);
      await page.click('[data-testid="retry-query"]');

      // Verify recovery
      await expect(page.locator('[data-testid="query-results"]')).toBeVisible();
      await expect(page.locator('[data-testid="offline-indicator"]')).not.toBeVisible();
    });

    test('should provide helpful error messages for invalid queries', async ({ page }) => {
      await loginUser(page, 'analyst');

      await submitQuery(page, 'Show me data from nonexistent_table with invalid_column');

      // Check error handling
      await expect(page.locator('[data-testid="query-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-type"]')).toContainText('schema_error');

      // Check suggestions
      await expect(page.locator('[data-testid="suggestions"]')).toBeVisible();
      await expect(page.locator('[data-testid="suggested-tables"]')).toContainText('users');
      await expect(page.locator('[data-testid="suggested-columns"]')).toContainText('name');

      // Test suggestion click
      await page.click('[data-testid="suggestion-users"]');
      await expect(page.locator('[data-testid="query-input"]')).toHaveValue('Show users');
    });
  });

  test.describe('Accessibility and Usability', () => {
    test('should be keyboard navigable', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Navigate using keyboard
      await page.keyboard.press('Tab'); // Move to query input
      await expect(page.locator('[data-testid="query-input"]')).toBeFocused();

      await page.keyboard.type('Show user data');
      await page.keyboard.press('Tab'); // Move to submit button
      await expect(page.locator('[data-testid="submit-query"]')).toBeFocused();

      await page.keyboard.press('Enter'); // Submit query

      // Verify results are accessible
      await page.waitForSelector('[data-testid="query-results"]');
      await page.keyboard.press('Tab'); // Move to results
      await expect(page.locator('[data-testid="results-table"]')).toBeFocused();
    });

    test('should support screen readers', async ({ page }) => {
      await loginUser(page, 'analyst');

      // Check ARIA labels and roles
      await expect(page.locator('[data-testid="query-input"]')).toHaveAttribute('aria-label', 'Natural language query input');
      await expect(page.locator('[data-testid="submit-query"]')).toHaveAttribute('aria-label', 'Submit query for processing');
      await expect(page.locator('[data-testid="results-table"]')).toHaveAttribute('role', 'table');

      // Check live regions for dynamic content
      await submitQuery(page, 'Show user statistics');
      await expect(page.locator('[data-testid="live-status"]')).toHaveAttribute('aria-live', 'polite');
      await expect(page.locator('[data-testid="live-status"]')).toContainText('Query completed');
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should work on mobile devices', async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 375, height: 667 }, // iPhone SE dimensions
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
      });

      const page = await context.newPage();

      await loginUser(page, 'analyst');

      // Check mobile layout
      await expect(page.locator('[data-testid="mobile-nav"]')).toBeVisible();
      await expect(page.locator('[data-testid="desktop-sidebar"]')).not.toBeVisible();

      // Test mobile query interface
      await page.click('[data-testid="mobile-menu"]');
      await page.click('[data-testid="query-option"]');

      await submitQuery(page, 'Show users');

      // Verify mobile results display
      await expect(page.locator('[data-testid="mobile-results"]')).toBeVisible();
      await expect(page.locator('[data-testid="results-scroll"]')).toBeVisible();

      await context.close();
    });
  });
});

test.describe('Hive Mind Collective Intelligence Features', () => {
  test('should learn from user interactions', async ({ page }) => {
    await loginUser(page, 'analyst');

    // Submit a query
    await submitQuery(page, 'Show top performers');

    // Provide feedback
    await page.click('[data-testid="feedback-thumbs-up"]');
    await page.fill('[data-testid="feedback-text"]', 'Great results, exactly what I needed');
    await page.click('[data-testid="submit-feedback"]');

    // Submit a similar query
    await submitQuery(page, 'Display best performing employees');

    // Check that the system learned from previous feedback
    await expect(page.locator('[data-testid="learning-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="improved-by-feedback"]')).toContainText('improved based on feedback');
  });

  test('should share insights across user sessions', async ({ browser }) => {
    // User 1 session
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await loginUser(page1, 'analyst');
    await submitQuery(page1, 'Analyze user engagement patterns');

    // Mark insights as valuable
    await page1.click('[data-testid="mark-insight-valuable"]');
    await context1.close();

    // User 2 session
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await loginUser(page2, 'admin');
    await submitQuery(page2, 'Show user engagement data');

    // Should benefit from previous user's insights
    await expect(page2.locator('[data-testid="collective-insight"]')).toBeVisible();
    await expect(page2.locator('[data-testid="insight-source"]')).toContainText('learned from analyst');

    await context2.close();
  });
});