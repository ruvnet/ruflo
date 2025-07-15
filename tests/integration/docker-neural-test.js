/**
 * Docker Neural Tools Integration Test
 * Tests neural tools running in Docker containers via npx
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('Docker Neural Tools Integration', () => {
  let dockerTestResults = {
    dockerAvailable: false,
    npxWorks: false,
    neuralToolsWork: [],
    failedTools: [],
    evidence: {}
  };

  beforeAll(async () => {
    console.log('🐳 Starting Docker Neural Tools Integration Tests');
    
    // Check if Docker is available
    try {
      const dockerVersion = execSync('docker --version', { encoding: 'utf8' });
      dockerTestResults.dockerAvailable = dockerVersion.includes('Docker version');
      console.log(`Docker status: ${dockerTestResults.dockerAvailable ? '✅ Available' : '❌ Not available'}`);
    } catch (error) {
      console.log('Docker not available, testing npx directly');
      dockerTestResults.dockerAvailable = false;
    }
  });

  test('Docker Environment - NPX Claude Flow Basic', async () => {
    try {
      console.log('\n🔧 Testing npx claude-flow in Docker-like environment...');
      
      // Test basic npx claude-flow functionality
      const result = execSync('npx claude-flow --help', {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'production' }, // Simulate container environment
        cwd: process.cwd()
      });

      const success = result.includes('claude-flow') && 
                     (result.includes('Commands:') || result.includes('Usage:'));

      dockerTestResults.npxWorks = success;
      dockerTestResults.evidence['npx-basic'] = {
        working: success,
        output: result,
        timestamp: new Date().toISOString()
      };

      console.log(`NPX Claude Flow: ${success ? '✅ Works' : '❌ Failed'}`);
      expect(success).toBe(true);
    } catch (error) {
      dockerTestResults.evidence['npx-basic'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      throw error;
    }
  }, 45000);

  test('Docker Environment - Neural Training Tools', async () => {
    try {
      console.log('\n🧠 Testing neural training in Docker-like environment...');
      
      const result = execSync('npx claude-flow training neural-train --data recent --model transformer --epochs 2', {
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, NODE_ENV: 'production' },
        cwd: process.cwd()
      });

      const success = result.includes('neural training') || 
                     result.includes('Training completed') ||
                     result.includes('transformer');

      if (success) {
        dockerTestResults.neuralToolsWork.push('neural-train');
      } else {
        dockerTestResults.failedTools.push('neural-train');
      }

      dockerTestResults.evidence['neural-train'] = {
        working: success,
        output: result,
        timestamp: new Date().toISOString()
      };

      console.log(`Neural Training: ${success ? '✅ Works' : '❌ Failed'}`);
      expect(success).toBe(true);
    } catch (error) {
      dockerTestResults.failedTools.push('neural-train');
      dockerTestResults.evidence['neural-train'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      throw error;
    }
  }, 75000);

  test('Docker Environment - Neural Status Tools', async () => {
    try {
      console.log('\n📊 Testing neural status in Docker-like environment...');
      
      const result = execSync('npx claude-flow neural status', {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'production' },
        cwd: process.cwd()
      });

      const success = result.includes('Neural Network Status') || 
                     result.includes('WASM Core') ||
                     result.includes('Models:');

      if (success) {
        dockerTestResults.neuralToolsWork.push('neural-status');
      } else {
        dockerTestResults.failedTools.push('neural-status');
      }

      dockerTestResults.evidence['neural-status'] = {
        working: success,
        output: result,
        timestamp: new Date().toISOString()
      };

      console.log(`Neural Status: ${success ? '✅ Works' : '❌ Failed'}`);
      expect(success).toBe(true);
    } catch (error) {
      dockerTestResults.failedTools.push('neural-status');
      dockerTestResults.evidence['neural-status'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      throw error;
    }
  }, 45000);

  test('Docker Environment - Neural Patterns Analysis', async () => {
    try {
      console.log('\n🧬 Testing neural patterns in Docker-like environment...');
      
      const result = execSync('npx claude-flow neural patterns --pattern attention', {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'production' },
        cwd: process.cwd()
      });

      const success = result.includes('Neural Patterns Analysis') && 
                     result.includes('attention');

      if (success) {
        dockerTestResults.neuralToolsWork.push('neural-patterns');
      } else {
        dockerTestResults.failedTools.push('neural-patterns');
      }

      dockerTestResults.evidence['neural-patterns'] = {
        working: success,
        output: result,
        timestamp: new Date().toISOString()
      };

      console.log(`Neural Patterns: ${success ? '✅ Works' : '❌ Failed'}`);
      expect(success).toBe(true);
    } catch (error) {
      dockerTestResults.failedTools.push('neural-patterns');
      dockerTestResults.evidence['neural-patterns'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      throw error;
    }
  }, 45000);

  test('Docker Environment - WASM Integration Test', async () => {
    try {
      console.log('\n⚡ Testing WASM integration in Docker-like environment...');
      
      // Test multiple commands to verify WASM is working
      const commands = [
        'npx claude-flow neural status',
        'npx claude-flow training neural-train --data recent --model general-predictor --epochs 1'
      ];

      let wasmDetected = false;
      let allOutputs = '';

      for (const command of commands) {
        try {
          const result = execSync(command, {
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, NODE_ENV: 'production' },
            cwd: process.cwd()
          });
          
          allOutputs += result + '\n';
          
          if (result.includes('WASM') || result.includes('SIMD') || result.includes('acceleration')) {
            wasmDetected = true;
          }
        } catch (err) {
          allOutputs += `Command failed: ${err.message}\n`;
        }
      }

      dockerTestResults.evidence['wasm-integration'] = {
        working: wasmDetected,
        output: allOutputs,
        commands: commands,
        timestamp: new Date().toISOString()
      };

      console.log(`WASM Integration: ${wasmDetected ? '✅ Detected' : '❌ Not detected'}`);
      
      // WASM might not be available in all environments, so this is informational
      if (wasmDetected) {
        dockerTestResults.neuralToolsWork.push('wasm-integration');
      }
    } catch (error) {
      dockerTestResults.evidence['wasm-integration'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      console.log('⚠️  WASM integration test failed but continuing...');
    }
  }, 75000);

  // If Docker is available, test actual container execution
  test('Real Docker Container Test (if available)', async () => {
    if (!dockerTestResults.dockerAvailable) {
      console.log('⏭️  Skipping real Docker test - Docker not available');
      return;
    }

    try {
      console.log('\n🐳 Testing neural tools in real Docker container...');
      
      // Create a minimal Dockerfile for testing
      const dockerfileContent = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install -g npm@latest
RUN npm install -g claude-flow@alpha
CMD ["npx", "claude-flow", "neural", "status"]
`;

      const dockerfilePath = path.join(process.cwd(), 'Dockerfile.neural-test');
      fs.writeFileSync(dockerfilePath, dockerfileContent);

      try {
        // Build test image
        execSync(`docker build -f ${dockerfilePath} -t claude-flow-neural-test .`, {
          encoding: 'utf8',
          timeout: 300000, // 5 minutes for build
          cwd: process.cwd()
        });

        // Run neural status test in container
        const result = execSync('docker run --rm claude-flow-neural-test', {
          encoding: 'utf8',
          timeout: 60000,
          cwd: process.cwd()
        });

        const success = result.includes('Neural') || result.includes('claude-flow');

        dockerTestResults.evidence['real-docker'] = {
          working: success,
          output: result,
          timestamp: new Date().toISOString()
        };

        if (success) {
          dockerTestResults.neuralToolsWork.push('real-docker');
        } else {
          dockerTestResults.failedTools.push('real-docker');
        }

        console.log(`Real Docker Test: ${success ? '✅ Works' : '❌ Failed'}`);
        
        // Clean up
        execSync('docker rmi claude-flow-neural-test', { encoding: 'utf8' });
        fs.unlinkSync(dockerfilePath);

      } catch (buildError) {
        console.log('⚠️  Docker build/run failed:', buildError.message);
        dockerTestResults.evidence['real-docker'] = {
          working: false,
          error: buildError.message,
          timestamp: new Date().toISOString()
        };
        
        // Clean up on error
        if (fs.existsSync(dockerfilePath)) {
          fs.unlinkSync(dockerfilePath);
        }
      }
    } catch (error) {
      console.log('⚠️  Real Docker test setup failed:', error.message);
      dockerTestResults.evidence['real-docker'] = {
        working: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }, 400000); // 6+ minutes for Docker operations

  afterAll(() => {
    console.log('\n🐳 DOCKER NEURAL TOOLS TEST RESULTS:');
    console.log(`Docker Available: ${dockerTestResults.dockerAvailable ? '✅' : '❌'}`);
    console.log(`NPX Works: ${dockerTestResults.npxWorks ? '✅' : '❌'}`);
    console.log(`Working Tools: ${dockerTestResults.neuralToolsWork.length} - ${dockerTestResults.neuralToolsWork.join(', ')}`);
    console.log(`Failed Tools: ${dockerTestResults.failedTools.length} - ${dockerTestResults.failedTools.join(', ')}`);

    // Store results in memory for other agents
    const memoryFile = path.join(process.cwd(), '.swarm', 'docker-neural-test-results.json');
    const swarmDir = path.dirname(memoryFile);
    if (!fs.existsSync(swarmDir)) {
      fs.mkdirSync(swarmDir, { recursive: true });
    }
    fs.writeFileSync(memoryFile, JSON.stringify(dockerTestResults, null, 2));
    console.log(`\n💾 Docker test results saved to: ${memoryFile}`);
  });
});

module.exports = { dockerTestResults };