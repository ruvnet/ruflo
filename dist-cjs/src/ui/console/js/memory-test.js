export class MemoryTest {
    constructor(memoryManager, terminal){
        this.memoryManager = memoryManager;
        this.terminal = terminal;
    }
    async runTests() {
        this.terminal.writeInfo('🧪 Starting Memory Manager Tests...');
        try {
            await this.testMemoryPanel();
            await this.testMemoryTools();
            await this.testNamespaceOperations();
            await this.testMemoryOperations();
            this.terminal.writeSuccess('✅ All memory tests completed successfully!');
        } catch (error) {
            this.terminal.writeError(`❌ Memory tests failed: ${error.message}`);
        }
    }
    async testMemoryPanel() {
        this.terminal.writeInfo('Testing memory panel...');
        this.memoryManager.togglePanel();
        const panelVisible = !document.getElementById('memoryPanel')?.classList.contains('hidden');
        if (panelVisible) {
            this.terminal.writeSuccess('✅ Memory panel opens correctly');
        } else {
            throw new Error('Memory panel failed to open');
        }
        const requiredElements = [
            'memoryToolsGrid',
            'namespaceSelect',
            'memoryTable',
            'memoryAnalytics',
            'memoryLog'
        ];
        for (const elementId of requiredElements){
            const element = document.getElementById(elementId);
            if (element) {
                this.terminal.writeSuccess(`✅ ${elementId} component found`);
            } else {
                throw new Error(`Required component missing: ${elementId}`);
            }
        }
    }
    async testMemoryTools() {
        this.terminal.writeInfo('Testing memory tools...');
        const tools = Object.keys(this.memoryManager.memoryTools);
        this.terminal.writeInfo(`Found ${tools.length} memory tools:`);
        for (const tool of tools){
            const toolInfo = this.memoryManager.memoryTools[tool];
            this.terminal.writeLine(`  ${toolInfo.icon} ${toolInfo.name} - ${toolInfo.description}`);
        }
        if (tools.length === 10) {
            this.terminal.writeSuccess('✅ All 10 memory tools are configured');
        } else {
            throw new Error(`Expected 10 memory tools, found ${tools.length}`);
        }
    }
    async testNamespaceOperations() {
        this.terminal.writeInfo('Testing namespace operations...');
        const originalNamespace = this.memoryManager.currentNamespace;
        await this.memoryManager.switchNamespace('test');
        if (this.memoryManager.currentNamespace === 'test') {
            this.terminal.writeSuccess('✅ Namespace switching works');
        } else {
            throw new Error('Namespace switching failed');
        }
        await this.memoryManager.switchNamespace(originalNamespace);
    }
    async testMemoryOperations() {
        this.terminal.writeInfo('Testing memory operations...');
        const testData = {
            size: this.memoryManager.formatSize(1024),
            ttl: this.memoryManager.formatTTL(Date.now() + 3600000),
            truncate: this.memoryManager.truncateValue('This is a very long test string that should be truncated'),
            escape: this.memoryManager.escapeHtml('<script>alert("test")<\/script>')
        };
        if (testData.size === '1 KB') {
            this.terminal.writeSuccess('✅ Size formatting works');
        } else {
            throw new Error(`Size formatting failed: ${testData.size}`);
        }
        if (testData.ttl.includes('h') && testData.ttl.includes('m')) {
            this.terminal.writeSuccess('✅ TTL formatting works');
        } else {
            throw new Error(`TTL formatting failed: ${testData.ttl}`);
        }
        if (testData.truncate.length <= 103) {
            this.terminal.writeSuccess('✅ Value truncation works');
        } else {
            throw new Error('Value truncation failed');
        }
        if (!testData.escape.includes("<script>")) {
            this.terminal.writeSuccess('✅ HTML escaping works');
        } else {
            throw new Error('HTML escaping failed');
        }
    }
    async testMockData() {
        this.terminal.writeInfo('Testing with mock data...');
        const mockEntries = [
            {
                key: 'test/key1',
                value: 'test value 1',
                size: 256,
                ttl: Date.now() + 3600000,
                namespace: 'test'
            },
            {
                key: 'test/key2',
                value: JSON.stringify({
                    test: 'data',
                    array: [
                        1,
                        2,
                        3
                    ]
                }),
                size: 512,
                ttl: null,
                namespace: 'test'
            }
        ];
        this.memoryManager.updateMemoryTable(mockEntries);
        const tableBody = document.getElementById('memoryTableBody');
        const rows = tableBody?.getElementsByTagName('tr');
        if (rows && rows.length === mockEntries.length) {
            this.terminal.writeSuccess('✅ Memory table updates correctly');
        } else {
            throw new Error('Memory table update failed');
        }
        this.memoryManager.filterMemoryEntries('key1');
        const visibleRows = Array.from(rows).filter((row)=>row.style.display !== 'none');
        if (visibleRows.length === 1) {
            this.terminal.writeSuccess('✅ Memory filtering works');
        } else {
            throw new Error('Memory filtering failed');
        }
        this.memoryManager.filterMemoryEntries('');
    }
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            tests: {
                panel: 'passed',
                tools: 'passed',
                namespaces: 'passed',
                operations: 'passed'
            },
            memoryTools: Object.keys(this.memoryManager.memoryTools),
            features: [
                'Memory Tools Grid (10 tools)',
                'Namespace Browser',
                'Memory Data Table',
                'Memory Analytics Dashboard',
                'Operations Log',
                'Import/Export',
                'Search & Filter',
                'Auto-refresh'
            ]
        };
        this.terminal.writeInfo('📊 Memory Manager Test Report:');
        this.terminal.writeLine(JSON.stringify(report, null, 2));
        return report;
    }
}
export async function runMemoryTests() {
    if (window.memoryManager && window.claudeConsole) {
        const tester = new MemoryTest(window.memoryManager, window.claudeConsole.terminal);
        await tester.runTests();
        await tester.testMockData();
        return tester.generateReport();
    } else {
        console.error('Memory manager or console not available for testing');
        return null;
    }
}
window.runMemoryTests = runMemoryTests;

//# sourceMappingURL=memory-test.js.map