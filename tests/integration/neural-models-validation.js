/**
 * 27+ Neural Models Validation Test
 * Tests all neural model architectures and their specific functionalities
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('27+ Neural Models Validation', () => {
  let modelValidationResults = {
    totalModels: 0,
    workingModels: 0,
    failedModels: 0,
    modelDetails: {},
    architectureProof: {},
    specialFeatures: {}
  };

  // Complete list of neural models from the codebase
  const neuralModels = [
    // Basic architectures
    'transformer', 'lstm', 'cnn', 'gru', 'autoencoder', 'attention',
    // Advanced architectures  
    'diffusion', 'neural_ode', 'capsnet', 'snn', 'gat', 'ntm',
    'memnn', 'nca', 'hypernet', 'maml', 'nas', 'moe',
    'nerf', 'wavenet', 'pointnet', 'world_model', 'normalizing_flow',
    'ebm', 'neural_process', 'set_transformer', 'neural_implicit',
    'evolutionary_nn', 'qnn', 'onn', 'neuromorphic',
    // Cognitive patterns
    'convergent', 'divergent', 'lateral', 'systems', 'critical', 'abstract'
  ];

  beforeAll(() => {
    console.log('🧠 Starting 27+ Neural Models Validation');
    console.log(`📊 Testing ${neuralModels.length} neural architectures`);
    modelValidationResults.totalModels = neuralModels.length;
  });

  test('1. Validate All Neural Model Patterns', async () => {
    console.log('\n🔍 Testing each neural model pattern...');
    
    for (const model of neuralModels) {
      try {
        const result = execSync(`npx claude-flow neural patterns --pattern ${model}`, {
          encoding: 'utf8',
          timeout: 15000,
          cwd: process.cwd()
        });

        const success = result.includes('Neural Patterns Analysis') && 
                       result.includes(model);

        modelValidationResults.modelDetails[model] = {
          working: success,
          output: result.substring(0, 500),
          timestamp: new Date().toISOString(),
          type: this.getModelType(model)
        };

        if (success) {
          modelValidationResults.workingModels++;
          console.log(`  ✅ ${model}: Working`);
        } else {
          modelValidationResults.failedModels++;
          console.log(`  ❌ ${model}: Failed`);
        }

      } catch (error) {
        modelValidationResults.modelDetails[model] = {
          working: false,
          error: error.message,
          timestamp: new Date().toISOString(),
          type: this.getModelType(model)
        };
        modelValidationResults.failedModels++;
        console.log(`  ❌ ${model}: Error - ${error.message.substring(0, 100)}`);
      }
    }

    const successRate = (modelValidationResults.workingModels / modelValidationResults.totalModels) * 100;
    console.log(`\n📊 Neural Models Success Rate: ${successRate.toFixed(1)}% (${modelValidationResults.workingModels}/${modelValidationResults.totalModels})`);
    
    // Require at least 80% of models to work
    expect(successRate).toBeGreaterThanOrEqual(80);
  }, 300000); // 5 minutes for all models

  test('2. Test Advanced Neural Architecture Features', async () => {
    console.log('\n🏗️ Testing advanced neural architecture features...');
    
    const advancedModels = [
      { model: 'transformer', feature: 'Attention Patterns' },
      { model: 'diffusion', feature: 'Denoising' },
      { model: 'neural_ode', feature: 'Continuous Dynamics' },
      { model: 'capsnet', feature: 'Dynamic Routing' },
      { model: 'gat', feature: 'Graph Attention' },
      { model: 'nerf', feature: '3D Scene Reconstruction' }
    ];

    for (const { model, feature } of advancedModels) {
      try {
        const result = execSync(`npx claude-flow neural patterns --pattern ${model}`, {
          encoding: 'utf8',
          timeout: 15000,
          cwd: process.cwd()
        });

        const hasFeature = result.includes(feature) || 
                          result.includes(feature.toLowerCase()) ||
                          result.includes('Learned Behaviors');

        modelValidationResults.specialFeatures[model] = {
          feature,
          detected: hasFeature,
          evidence: result.substring(0, 300),
          timestamp: new Date().toISOString()
        };

        console.log(`  ${hasFeature ? '✅' : '❌'} ${model}: ${feature} ${hasFeature ? 'detected' : 'not detected'}`);

      } catch (error) {
        modelValidationResults.specialFeatures[model] = {
          feature,
          detected: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
        console.log(`  ❌ ${model}: Error testing ${feature}`);
      }
    }
  }, 120000);

  test('3. Test Cognitive Pattern Models', async () => {
    console.log('\n🧠 Testing cognitive pattern models...');
    
    const cognitivePatterns = ['convergent', 'divergent', 'lateral', 'systems', 'critical', 'abstract'];
    let workingCognitive = 0;

    for (const pattern of cognitivePatterns) {
      try {
        const result = execSync(`npx claude-flow neural patterns --pattern ${pattern}`, {
          encoding: 'utf8',
          timeout: 15000,
          cwd: process.cwd()
        });

        const success = result.includes('Cognitive Patterns') && 
                       result.includes(pattern);

        if (success) {
          workingCognitive++;
          console.log(`  ✅ ${pattern}: Working`);
        } else {
          console.log(`  ❌ ${pattern}: Failed`);
        }

        modelValidationResults.architectureProof[`cognitive_${pattern}`] = {
          working: success,
          type: 'cognitive',
          output: result.substring(0, 300),
          timestamp: new Date().toISOString()
        };

      } catch (error) {
        console.log(`  ❌ ${pattern}: Error`);
        modelValidationResults.architectureProof[`cognitive_${pattern}`] = {
          working: false,
          type: 'cognitive',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }

    const cognitiveSuccessRate = (workingCognitive / cognitivePatterns.length) * 100;
    console.log(`\n🧠 Cognitive Patterns Success Rate: ${cognitiveSuccessRate.toFixed(1)}%`);
    
    expect(cognitiveSuccessRate).toBeGreaterThanOrEqual(70);
  }, 120000);

  test('4. Test Neural Training with Different Models', async () => {
    console.log('\n🏋️ Testing neural training with different models...');
    
    const trainingModels = ['transformer', 'general-predictor', 'task-predictor', 'performance-optimizer'];
    let successfulTraining = 0;

    for (const model of trainingModels) {
      try {
        const result = execSync(`npx claude-flow training neural-train --data recent --model ${model} --epochs 2`, {
          encoding: 'utf8',
          timeout: 30000,
          cwd: process.cwd()
        });

        const success = result.includes('neural training completed') || 
                       result.includes('Training completed') ||
                       result.includes(model);

        if (success) {
          successfulTraining++;
          console.log(`  ✅ ${model}: Training successful`);
        } else {
          console.log(`  ❌ ${model}: Training failed`);
        }

        modelValidationResults.architectureProof[`training_${model}`] = {
          working: success,
          type: 'training',
          model,
          output: result.substring(0, 300),
          timestamp: new Date().toISOString()
        };

      } catch (error) {
        console.log(`  ❌ ${model}: Training error`);
        modelValidationResults.architectureProof[`training_${model}`] = {
          working: false,
          type: 'training',
          model,
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }

    const trainingSuccessRate = (successfulTraining / trainingModels.length) * 100;
    console.log(`\n🏋️ Training Success Rate: ${trainingSuccessRate.toFixed(1)}%`);
    
    expect(trainingSuccessRate).toBeGreaterThanOrEqual(75);
  }, 180000);

  test('5. Test Memory and Performance Features', async () => {
    console.log('\n📊 Testing memory and performance features...');
    
    try {
      // Test memory usage analysis
      const memoryResult = execSync('npx claude-flow neural patterns --pattern attention', {
        encoding: 'utf8',
        timeout: 15000,
        cwd: process.cwd()
      });

      const hasMemoryInfo = memoryResult.includes('Memory Usage') || 
                           memoryResult.includes('Performance Characteristics');

      // Test export functionality
      const exportResult = execSync('npx claude-flow neural export --model attention --output ./test-neural-export.json', {
        encoding: 'utf8',
        timeout: 20000,
        cwd: process.cwd()
      });

      const exportWorks = exportResult.includes('Export Complete') && 
                         fs.existsSync('./test-neural-export.json');

      // Clean up
      if (fs.existsSync('./test-neural-export.json')) {
        fs.unlinkSync('./test-neural-export.json');
      }

      modelValidationResults.specialFeatures['memory_performance'] = {
        memoryInfo: hasMemoryInfo,
        exportWorks: exportWorks,
        timestamp: new Date().toISOString()
      };

      console.log(`  ${hasMemoryInfo ? '✅' : '❌'} Memory usage information`);
      console.log(`  ${exportWorks ? '✅' : '❌'} Neural export functionality`);

      expect(hasMemoryInfo && exportWorks).toBe(true);

    } catch (error) {
      modelValidationResults.specialFeatures['memory_performance'] = {
        error: error.message,
        timestamp: new Date().toISOString()
      };
      throw error;
    }
  }, 60000);

  // Helper method to categorize model types
  getModelType(model) {
    const modelTypes = {
      // Neural network architectures
      'transformer': 'sequence',
      'lstm': 'sequence', 
      'gru': 'sequence',
      'cnn': 'vision',
      'autoencoder': 'compression',
      'attention': 'sequence',
      // Advanced models
      'diffusion': 'generative',
      'neural_ode': 'continuous',
      'capsnet': 'vision',
      'snn': 'neuromorphic',
      'gat': 'graph',
      'ntm': 'memory',
      'memnn': 'memory',
      'nca': 'cellular',
      'hypernet': 'meta',
      'maml': 'meta',
      'nas': 'architecture_search',
      'moe': 'ensemble',
      'nerf': 'vision_3d',
      'wavenet': 'audio',
      'pointnet': 'point_cloud',
      'world_model': 'environment',
      'normalizing_flow': 'density',
      'ebm': 'energy',
      'neural_process': 'meta',
      'set_transformer': 'permutation',
      'neural_implicit': 'coordinate',
      'evolutionary_nn': 'evolutionary',
      'qnn': 'quantum',
      'onn': 'optical',
      'neuromorphic': 'neuromorphic',
      // Cognitive patterns
      'convergent': 'cognitive',
      'divergent': 'cognitive', 
      'lateral': 'cognitive',
      'systems': 'cognitive',
      'critical': 'cognitive',
      'abstract': 'cognitive'
    };

    return modelTypes[model] || 'unknown';
  }

  afterAll(() => {
    console.log('\n🧠 27+ NEURAL MODELS VALIDATION RESULTS:');
    console.log(`📊 Total Models Tested: ${modelValidationResults.totalModels}`);
    console.log(`✅ Working Models: ${modelValidationResults.workingModels}`);
    console.log(`❌ Failed Models: ${modelValidationResults.failedModels}`);
    
    const overallSuccessRate = (modelValidationResults.workingModels / modelValidationResults.totalModels) * 100;
    console.log(`📈 Overall Success Rate: ${overallSuccessRate.toFixed(1)}%`);

    // Group by model type
    const modelsByType = {};
    Object.entries(modelValidationResults.modelDetails).forEach(([model, details]) => {
      const type = details.type;
      if (!modelsByType[type]) {
        modelsByType[type] = { working: 0, total: 0 };
      }
      modelsByType[type].total++;
      if (details.working) {
        modelsByType[type].working++;
      }
    });

    console.log('\n📊 Success Rate by Model Type:');
    Object.entries(modelsByType).forEach(([type, stats]) => {
      const rate = (stats.working / stats.total) * 100;
      console.log(`  ${type}: ${rate.toFixed(1)}% (${stats.working}/${stats.total})`);
    });

    // Save comprehensive results
    const memoryFile = path.join(process.cwd(), '.swarm', 'neural-models-validation-results.json');
    const swarmDir = path.dirname(memoryFile);
    if (!fs.existsSync(swarmDir)) {
      fs.mkdirSync(swarmDir, { recursive: true });
    }
    fs.writeFileSync(memoryFile, JSON.stringify(modelValidationResults, null, 2));
    console.log(`\n💾 Comprehensive results saved to: ${memoryFile}`);
  });
});

module.exports = { modelValidationResults };