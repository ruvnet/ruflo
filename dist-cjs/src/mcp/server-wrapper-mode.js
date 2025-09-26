#!/usr/bin/env node
import { ClaudeCodeMCPWrapper } from './claude-code-wrapper.js';
const isWrapperMode = process.env.CLAUDE_FLOW_WRAPPER_MODE === 'true' || process.argv.includes('--wrapper');
async function main() {
    if (isWrapperMode) {
        console.error('Starting Claude-Flow MCP in wrapper mode...');
        const wrapper = new ClaudeCodeMCPWrapper();
        await wrapper.run();
    } else {
        console.error('Starting Claude-Flow MCP in direct mode...');
        const { runMCPServer } = await import('./server.js');
        await runMCPServer();
    }
}
main().catch((error)=>{
    console.error('Fatal error:', error);
    process.exit(1);
});

//# sourceMappingURL=server-wrapper-mode.js.map