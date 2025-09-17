import { LALOSystem } from './lalo.js';
import { validateEnvironment } from './config/index.js';

async function main() {
  try {
    // Validate environment
    validateEnvironment();

    console.log('🚀 Starting LALO MVP System...');

    // Initialize LALO system
    const lalo = new LALOSystem();
    await lalo.initialize();

    console.log('✅ LALO MVP System started successfully');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n📱 Shutting down LALO MVP System...');
      await lalo.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n📱 Shutting down LALO MVP System...');
      await lalo.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to start LALO MVP System:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { LALOSystem } from './lalo.js';
export * from './types/index.js';
export * from './config/index.js';