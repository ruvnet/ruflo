import { verificationHookManager } from './hooks.js';
export async function testVerificationSystem() {
    console.log('🧪 Testing Verification System...');
    try {
        const metrics = verificationHookManager.getMetrics();
        console.log('✅ Metrics retrieved:', metrics);
        verificationHookManager.addPreTaskChecker({
            id: 'test-checker',
            name: 'Test Checker',
            description: 'A simple test checker',
            priority: 50,
            check: async (context)=>({
                    passed: true,
                    score: 1.0,
                    message: 'Test check passed'
                })
        });
        console.log('✅ Test checker added successfully');
        verificationHookManager.updateConfig({
            preTask: {
                enabled: true,
                checkers: [],
                failureStrategy: 'warn'
            }
        });
        console.log('✅ Configuration updated successfully');
        console.log('🎉 Verification system test completed successfully!');
    } catch (error) {
        console.error('❌ Verification system test failed:', error);
        throw error;
    }
}
if (require.main === module) {
    testVerificationSystem().catch(console.error);
}

//# sourceMappingURL=test-verification.js.map