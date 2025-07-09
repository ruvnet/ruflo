#!/usr/bin/env node

/**
 * CI-friendly installation script
 * Skips optional dependencies and handles errors gracefully
 */

console.log('Installing Claude-Flow (CI mode)...');

// In CI, we skip Deno installation and other optional components
if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.CONTINUOUS_INTEGRATION) {
  console.log('CI environment detected - skipping optional components');
  console.log('Claude-Flow core installation completed!');
  process.exit(0);
}

// For non-CI environments, check if we should install optional components
import('./install.js').catch(error => {
  console.warn('Optional components installation failed:', error.message);
  console.log('Claude-Flow core installation completed (without optional components)');
  // Don't fail the installation
  process.exit(0);
});