#!/usr/bin/env node

/**
 * Script to create GitHub issues from markdown templates
 * Requires GITHUB_TOKEN environment variable
 * Usage: GITHUB_TOKEN=your_token node create-issues-api.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_OWNER || 'jamaleb67';
const REPO_NAME = process.env.GITHUB_REPO || 'claude-flow';

// Issue templates
const issueFiles = [
  '01-truth-score-implementation.md',
  '02-typescript-upgrade.md',
  '03-linting-cleanup.md',
  '04-ci-hardening.md'
];

// Parse markdown to extract title and labels
function parseMarkdown(content) {
  const lines = content.split('\n');
  let title = '';
  const labels = [];
  let body = content;

  // Extract title (first # heading)
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.replace('# ', '').trim();
      break;
    }
  }

  // Extract labels from the Labels section
  const labelsMatch = content.match(/## Labels\n`([^`]+)`/);
  if (labelsMatch) {
    const labelStr = labelsMatch[1];
    labels.push(...labelStr.split('`,').map(l => l.replace(/`/g, '').trim()));
  }

  // Remove the Labels section from body
  body = body.replace(/## Labels\n`[^`]+`\n?/, '');

  return { title, body, labels };
}

// Create GitHub issue via API
function createIssue(title, body, labels) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      title,
      body,
      labels
    });

    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Node.js GitHub Issue Creator',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          const issue = JSON.parse(responseBody);
          resolve(issue);
        } else {
          reject(new Error(`Failed to create issue: ${res.statusCode} ${responseBody}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

// Main execution
async function main() {
  if (!GITHUB_TOKEN) {
    console.error('Error: GITHUB_TOKEN environment variable is required');
    console.error('Usage: GITHUB_TOKEN=your_token node create-issues-api.js');
    process.exit(1);
  }

  console.log(`Creating issues for ${REPO_OWNER}/${REPO_NAME}...\n`);

  for (const fileName of issueFiles) {
    try {
      const filePath = path.join(__dirname, fileName);
      const content = fs.readFileSync(filePath, 'utf8');
      const { title, body, labels } = parseMarkdown(content);

      console.log(`Creating issue: ${title}...`);
      const issue = await createIssue(title, body, labels);
      console.log(`✓ Created: ${issue.html_url}`);
      console.log(`  Issue #${issue.number}\n`);

      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`✗ Failed to create issue from ${fileName}:`);
      console.error(`  ${error.message}\n`);
    }
  }

  console.log('Done!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
