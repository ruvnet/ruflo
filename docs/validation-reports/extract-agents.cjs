#!/usr/bin/env node
/**
 * Extract agent names and details from .claude/agents directory
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const agentsDir = path.join(process.cwd(), '.claude/agents');
const agents = [];

function findAgentFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findAgentFiles(fullPath, baseDir);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Skip README and MIGRATION files
      if (entry.name === 'README.md' || entry.name === 'MIGRATION_SUMMARY.md') {
        continue;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);

        if (match) {
          const frontmatter = yaml.parse(match[1]);

          if (frontmatter.name) {
            const relativePath = fullPath.replace(baseDir + '/', '');
            const category = path.dirname(relativePath);

            agents.push({
              name: frontmatter.name,
              type: frontmatter.type || 'unknown',
              category: category,
              description: frontmatter.metadata?.description || frontmatter.description || 'No description',
              file: relativePath
            });
          }
        }
      } catch (err) {
        console.error(`Error parsing ${fullPath}: ${err.message}`);
      }
    }
  }
}

findAgentFiles(agentsDir);

// Sort by name
agents.sort((a, b) => a.name.localeCompare(b.name));

// Output as JSON
console.log(JSON.stringify(agents, null, 2));
