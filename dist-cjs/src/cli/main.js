#!/usr/bin/env node
import { CLI } from './cli-core.js';
import { setupCommands } from './commands/index.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
async function main() {
    const cli = new CLI('claude-flow', 'Advanced AI Agent Orchestration System');
    setupCommands(cli);
    await cli.run();
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isMainModule = process.argv[1] === __filename || process.argv[1].endsWith('/main.js');
if (isMainModule) {
    main().catch((error)=>{
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

//# sourceMappingURL=main.js.map