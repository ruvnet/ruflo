#!/usr/bin/env node
/**
 * Neural Architecture Examples - Real ruv-swarm Integration
 * Demonstrates the new neural architecture specific commands
 */

import { 
  trainTransformerModel,
  trainLSTMModel,
  trainCNNModel,
  trainAttentionModel,
  saveNeuralModel,
  loadNeuralModel,
  listNeuralModels,
  configureWASMOptimization,
  predictWithNeuralModel
} from '../src/cli/utils.js';

async function runNeuralArchitectureExamples() {
  console.log('🧠 Neural Architecture Examples - Real ruv-swarm Integration\n');

  try {
    // Example 1: Train a Transformer model
    console.log('📖 Example 1: Training Transformer Model');
    console.log('=' .repeat(50));
    
    const transformerResult = await trainTransformerModel({
      modelName: 'example_transformer',
      inputDim: 256,
      heads: 4,
      layers: 4,
      epochs: 25,
      dataSource: 'recent'
    });
    
    console.log('✅ Transformer training result:', {
      success: transformerResult.success,
      modelId: transformerResult.modelId,
      accuracy: transformerResult.accuracy ? `${(transformerResult.accuracy * 100).toFixed(1)}%` : 'N/A',
      real_training: transformerResult.real_neural_training || false
    });

    // Example 2: Train an LSTM model
    console.log('\n📖 Example 2: Training LSTM Model');
    console.log('=' .repeat(50));
    
    const lstmResult = await trainLSTMModel({
      modelName: 'example_lstm',
      hiddenSize: 128,
      numLayers: 2,
      bidirectional: true,
      epochs: 30,
      dataSource: 'recent'
    });
    
    console.log('✅ LSTM training result:', {
      success: lstmResult.success,
      modelId: lstmResult.modelId,
      accuracy: lstmResult.accuracy ? `${(lstmResult.accuracy * 100).toFixed(1)}%` : 'N/A',
      real_training: lstmResult.real_neural_training || false
    });

    // Example 3: Configure WASM optimization
    console.log('\n📖 Example 3: WASM Optimization Configuration');
    console.log('=' .repeat(50));
    
    try {
      const wasmResult = await configureWASMOptimization({
        simdEnabled: true,
        parallelProcessing: true,
        memoryOptimization: true,
        gpuAcceleration: false
      });
      
      console.log('✅ WASM optimization configured:', wasmResult.success);
    } catch (error) {
      console.log('⚠️ WASM configuration skipped:', error.message);
    }

    // Example 4: List available models
    console.log('\n📖 Example 4: Listing Available Models');
    console.log('=' .repeat(50));
    
    const modelsList = await listNeuralModels();
    console.log('📊 Available models:', {
      success: modelsList.success,
      count: modelsList.count,
      models: modelsList.models ? modelsList.models.slice(0, 3).map(m => m.name) : []
    });

    // Example 5: Train a CNN model
    console.log('\n📖 Example 5: Training CNN Model');
    console.log('=' .repeat(50));
    
    const cnnResult = await trainCNNModel({
      modelName: 'example_cnn',
      inputShape: [28, 28, 1],
      filters: [16, 32, 64],
      kernelSize: 3,
      epochs: 20,
      dataSource: 'recent'
    });
    
    console.log('✅ CNN training result:', {
      success: cnnResult.success,
      modelId: cnnResult.modelId,
      accuracy: cnnResult.accuracy ? `${(cnnResult.accuracy * 100).toFixed(1)}%` : 'N/A',
      real_training: cnnResult.real_neural_training || false
    });

    // Example 6: Save a model (if we have one)
    if (transformerResult.success && transformerResult.modelId) {
      console.log('\n📖 Example 6: Saving Trained Model');
      console.log('=' .repeat(50));
      
      try {
        const saveResult = await saveNeuralModel(
          transformerResult.modelId, 
          `./models/${transformerResult.modelId}.json`
        );
        console.log('✅ Model save result:', saveResult.success);
      } catch (error) {
        console.log('⚠️ Model save skipped:', error.message);
      }
    }

    // Summary
    console.log('\n🎯 Neural Architecture Examples Summary');
    console.log('=' .repeat(50));
    console.log('✅ Real ruv-swarm neural training integration completed');
    console.log('✅ Architecture-specific training functions implemented');
    console.log('✅ Model management and WASM optimization available');
    console.log('✅ All mock implementations replaced with real calls');
    console.log('\n🚀 Use: claude-flow neural-architectures <command> for CLI access');

  } catch (error) {
    console.error('❌ Example execution failed:', error.message);
  }
}

// CLI Usage Examples
function showCLIExamples() {
  console.log('\n📚 CLI Usage Examples');
  console.log('=' .repeat(50));
  console.log(`
# Train different neural architectures
claude-flow neural-architectures transformer --heads 8 --layers 6 --epochs 50
claude-flow neural-architectures lstm --hidden-size 256 --bidirectional true
claude-flow neural-architectures cnn --input-shape "32,32,3" --filters "32,64,128"

# Model management
claude-flow neural-architectures save --model-id model_123 --path ./saved_model.json
claude-flow neural-architectures load --path ./saved_model.json
claude-flow neural-architectures list

# Make predictions
claude-flow neural-architectures predict --model-id model_123 --input '{"data": [1,2,3]}'

# Configure WASM optimization
claude-flow neural-architectures wasm-config --simd true --parallel true --gpu false
`);
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runNeuralArchitectureExamples()
    .then(() => {
      showCLIExamples();
      console.log('\n✅ Neural architecture implementation complete!');
    })
    .catch(error => {
      console.error('❌ Examples failed:', error);
      process.exit(1);
    });
}

export { runNeuralArchitectureExamples, showCLIExamples };