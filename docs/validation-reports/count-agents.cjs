#!/usr/bin/env node
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('docs/validation-reports/agents-list.json', 'utf-8'));

const uniqueAgents = new Set(data.map(a => a.name));
console.log('Total agent files:', data.length);
console.log('Unique agent names:', uniqueAgents.size);
console.log('\nDuplicates:');
const nameCount = {};
data.forEach(a => {
  nameCount[a.name] = (nameCount[a.name] || 0) + 1;
});
Object.entries(nameCount).filter(([_, count]) => count > 1).forEach(([name, count]) => {
  console.log(`  - ${name}: ${count} files`);
});

// Categorize agents
console.log('\n=== AGENT CATEGORIZATION ===\n');

const categories = {};
data.forEach(agent => {
  const cat = agent.category.split('/')[0]; // Get top-level category
  if (!categories[cat]) categories[cat] = [];
  categories[cat].push(agent.name);
});

Object.entries(categories).sort().forEach(([category, agents]) => {
  const unique = [...new Set(agents)];
  console.log(`${category}: ${unique.length} unique agents`);
  unique.sort().forEach(name => console.log(`  - ${name}`));
  console.log();
});
