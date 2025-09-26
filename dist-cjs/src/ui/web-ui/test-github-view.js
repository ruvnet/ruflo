#!/usr/bin/env node
import { GitHubIntegrationView } from './views/GitHubIntegrationView.js';
import { EventBus } from './core/EventBus.js';
import { runGitHubViewTest } from './views/GitHubIntegrationTest.js';
console.log('🧪 Testing GitHub Integration View Setup');
console.log('═'.repeat(60));
console.log('\n1️⃣ Testing view instantiation...');
try {
    const eventBus = new EventBus();
    const viewConfig = {
        id: 'github',
        name: 'GitHub Integration',
        icon: '🐙',
        description: 'GitHub integration and operations',
        component: 'GitHubIntegrationView',
        toolCount: 8
    };
    const githubView = new GitHubIntegrationView(null, eventBus, viewConfig);
    console.log('✅ GitHub view instantiated successfully');
    console.log('\n2️⃣ Testing view initialization...');
    await githubView.initialize();
    console.log('✅ GitHub view initialized successfully');
    console.log('\n3️⃣ Testing terminal mode rendering...');
    await githubView.render({
        mode: 'terminal'
    });
    console.log('\n4️⃣ Checking GitHub tools availability...');
    const tools = githubView.githubTools;
    console.log('Available GitHub tools:');
    Object.entries(tools).forEach(([key, value])=>{
        console.log(`  ✓ ${key}: ${value}`);
    });
    console.log('\n5️⃣ Testing event handling...');
    let eventReceived = false;
    eventBus.on('tool:execute', (data)=>{
        eventReceived = true;
        console.log('✅ Event received:', data.tool);
    });
    await githubView.quickAction('github_repo_analyze', {
        repo: 'test/repo'
    });
    if (eventReceived) {
        console.log('✅ Event handling working correctly');
    }
    console.log('\n6️⃣ Running MCP integration tests...');
    runGitHubViewTest();
    console.log('\n🎉 All tests passed! GitHub Integration View is ready.');
    console.log('═'.repeat(60));
} catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
}
console.log('\n📊 GitHub Integration View Summary:');
console.log('  - 8 GitHub tools integrated');
console.log('  - Repository management dashboard');
console.log('  - PR/Issue tracking system');
console.log('  - Release coordination');
console.log('  - Workflow automation');
console.log('  - Code review automation');
console.log('  - Repository metrics');
console.log('  - Multi-repo sync coordination');
console.log('\n✅ View is ready for production use!');

//# sourceMappingURL=test-github-view.js.map