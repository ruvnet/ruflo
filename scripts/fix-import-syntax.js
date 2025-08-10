#!/usr/bin/env node

/**
 * Fix Import Syntax Issues
 * Fixes remaining syntax issues from module conversion
 */

import { promises as fs } from 'fs';

const fixes = [
  {
    file: 'src/swarm/prompt-manager.ts',
    from: 'import { promises as fs } from \'fs\';',
    to: 'const fs = (await import(\'fs\')).promises;'
  },
  {
    file: 'src/config/ruv-swarm-config.ts',
    from: 'import fs from \'fs\';',
    to: 'const fs = await import(\'fs\');'
  },
  {
    file: 'src/cli/commands/sparc.ts',
    from: 'import readline from \'readline\';',
    to: 'const readline = await import(\'readline\');'
  },
  {
    file: 'src/cli/commands/hive-mind/wizard.ts',
    from: 'import spinner from \'ora\'(\'Creating Hive Mind swarm...\').start();',
    to: 'const { default: ora } = await import(\'ora\'); const spinner = ora(\'Creating Hive Mind swarm...\').start();'
  },
  {
    file: 'src/cli/commands/hive-mind/task.ts',
    from: 'import Table from \'cli-table3\';',
    to: 'const { default: Table } = await import(\'cli-table3\');'
  }
];

async function fixFile(fix) {
  try {
    const content = await fs.readFile(fix.file, 'utf8');
    if (content.includes(fix.from)) {
      const fixed = content.replace(fix.from, fix.to);
      await fs.writeFile(fix.file, fixed);
      console.log(`✅ Fixed: ${fix.file}`);
      console.log(`   ${fix.from} → ${fix.to}`);
    } else {
      console.log(`⚠️  Pattern not found in: ${fix.file}`);
    }
  } catch (error) {
    console.log(`❌ Error fixing ${fix.file}: ${error.message}`);
  }
}

console.log('🔧 Fixing import syntax issues...\n');

for (const fix of fixes) {
  await fixFile(fix);
  console.log('');
}

console.log('✅ Import syntax fixes completed!');