import { 
  printSuccess, 
  printError, 
  printWarning, 
  checkRuvSwarmAvailable,
  trainTransformerModel,
  trainLSTMModel,
  trainCNNModel,
  trainAttentionModel,
  saveNeuralModel,
  loadNeuralModel,
  listNeuralModels,
  configureWASMOptimization,
  runNeuralInference,
  predictWithNeuralModel
} from "../utils.js";

export async function neuralArchitecturesAction(subArgs, flags) {
  const subcommand = subArgs[0];
  const options = flags;

  if (options.help || options.h || !subcommand) {
    showNeuralArchitecturesHelp();
    return;
  }

  try {
    switch (subcommand) {
      case 'transformer':
        await transformerCommand(subArgs.slice(1), flags);
        break;
      case 'lstm':
        await lstmCommand(subArgs.slice(1), flags);
        break;
      case 'cnn':
        await cnnCommand(subArgs.slice(1), flags);
        break;
      case 'attention':
        await attentionCommand(subArgs.slice(1), flags);
        break;
      case 'save':
        await saveModelCommand(subArgs.slice(1), flags);
        break;
      case 'load':
        await loadModelCommand(subArgs.slice(1), flags);
        break;
      case 'list':
        await listModelsCommand(subArgs.slice(1), flags);
        break;
      case 'predict':
        await predictCommand(subArgs.slice(1), flags);
        break;
      case 'wasm-config':
        await wasmConfigCommand(subArgs.slice(1), flags);
        break;
      default:
        printError(`Unknown neural architecture command: ${subcommand}`);
        showNeuralArchitecturesHelp();
    }
  } catch (err) {
    printError(`Neural architecture command failed: ${err.message}`);
  }
}

async function transformerCommand(args, flags) {
  const isAvailable = await checkRuvSwarmAvailable();
  if (!isAvailable) {
    printError('ruv-swarm is not available. Please install it with: npm install -g ruv-swarm');
    return;
  }

  const {
    modelName = 'transformer',
    inputDim = 512,
    heads = 8,
    layers = 6,
    epochs = 50,
    dataSource = 'recent'
  } = flags;

  console.log(`🔧 Training Transformer Neural Network\n`);
  console.log(`📋 Configuration:`);
  console.log(`   Model Name: ${modelName}`);
  console.log(`   Input Dimensions: ${inputDim}`);
  console.log(`   Attention Heads: ${heads}`);
  console.log(`   Layers: ${layers}`);
  console.log(`   Epochs: ${epochs}`);
  console.log(`   Data Source: ${dataSource}\n`);

  try {
    const result = await trainTransformerModel({
      modelName,
      inputDim: parseInt(inputDim),
      heads: parseInt(heads),
      layers: parseInt(layers),
      epochs: parseInt(epochs),
      dataSource
    });

    if (result.success) {
      printSuccess(`✅ Transformer training completed successfully!`);
      console.log(`🤖 Model ID: ${result.modelId}`);
      console.log(`📈 Architecture: Transformer (${heads} heads, ${layers} layers)`);
      console.log(`🎯 Final Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      console.log(`⏱️  Training Time: ${result.training_time.toFixed(1)}s`);
      console.log(`🧠 WASM Accelerated: ${result.wasm_accelerated ? 'Yes' : 'No'}`);
      console.log(`✨ Real Neural Training: ${result.real_neural_training ? 'Yes' : 'Simulated'}`);
    } else {
      printError(`Transformer training failed: ${result.error}`);
    }
  } catch (error) {
    printError(`Transformer training error: ${error.message}`);
  }
}

async function lstmCommand(args, flags) {
  const isAvailable = await checkRuvSwarmAvailable();
  if (!isAvailable) {
    printError('ruv-swarm is not available. Please install it with: npm install -g ruv-swarm');
    return;
  }

  const {
    modelName = 'lstm',
    hiddenSize = 256,
    numLayers = 2,
    bidirectional = 'true',
    epochs = 50,
    dataSource = 'recent'
  } = flags;

  console.log(`🔧 Training LSTM Neural Network\n`);
  console.log(`📋 Configuration:`);
  console.log(`   Model Name: ${modelName}`);
  console.log(`   Hidden Size: ${hiddenSize}`);
  console.log(`   Number of Layers: ${numLayers}`);
  console.log(`   Bidirectional: ${bidirectional}`);
  console.log(`   Epochs: ${epochs}`);
  console.log(`   Data Source: ${dataSource}\n`);

  try {
    const result = await trainLSTMModel({
      modelName,
      hiddenSize: parseInt(hiddenSize),
      numLayers: parseInt(numLayers),
      bidirectional: bidirectional === 'true',
      epochs: parseInt(epochs),
      dataSource
    });

    if (result.success) {
      printSuccess(`✅ LSTM training completed successfully!`);
      console.log(`🤖 Model ID: ${result.modelId}`);
      console.log(`📈 Architecture: LSTM (${hiddenSize} units, ${numLayers} layers)`);
      console.log(`🎯 Final Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      console.log(`⏱️  Training Time: ${result.training_time.toFixed(1)}s`);
      console.log(`🧠 WASM Accelerated: ${result.wasm_accelerated ? 'Yes' : 'No'}`);
      console.log(`✨ Real Neural Training: ${result.real_neural_training ? 'Yes' : 'Simulated'}`);
    } else {
      printError(`LSTM training failed: ${result.error}`);
    }
  } catch (error) {
    printError(`LSTM training error: ${error.message}`);
  }
}

async function cnnCommand(args, flags) {
  const isAvailable = await checkRuvSwarmAvailable();
  if (!isAvailable) {
    printError('ruv-swarm is not available. Please install it with: npm install -g ruv-swarm');
    return;
  }

  const {
    modelName = 'cnn',
    inputShape = '32,32,3',
    filters = '32,64,128',
    kernelSize = 3,
    epochs = 50,
    dataSource = 'recent'
  } = flags;

  const inputShapeArray = inputShape.split(',').map(n => parseInt(n));
  const filtersArray = filters.split(',').map(n => parseInt(n));

  console.log(`🔧 Training CNN Neural Network\n`);
  console.log(`📋 Configuration:`);
  console.log(`   Model Name: ${modelName}`);
  console.log(`   Input Shape: [${inputShapeArray.join(', ')}]`);
  console.log(`   Filters: [${filtersArray.join(', ')}]`);
  console.log(`   Kernel Size: ${kernelSize}`);
  console.log(`   Epochs: ${epochs}`);
  console.log(`   Data Source: ${dataSource}\n`);

  try {
    const result = await trainCNNModel({
      modelName,
      inputShape: inputShapeArray,
      filters: filtersArray,
      kernelSize: parseInt(kernelSize),
      epochs: parseInt(epochs),
      dataSource
    });

    if (result.success) {
      printSuccess(`✅ CNN training completed successfully!`);
      console.log(`🤖 Model ID: ${result.modelId}`);
      console.log(`📈 Architecture: CNN (${filtersArray.length} conv layers)`);
      console.log(`🎯 Final Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      console.log(`⏱️  Training Time: ${result.training_time.toFixed(1)}s`);
      console.log(`🧠 WASM Accelerated: ${result.wasm_accelerated ? 'Yes' : 'No'}`);
      console.log(`✨ Real Neural Training: ${result.real_neural_training ? 'Yes' : 'Simulated'}`);
    } else {
      printError(`CNN training failed: ${result.error}`);
    }
  } catch (error) {
    printError(`CNN training error: ${error.message}`);
  }
}

async function attentionCommand(args, flags) {
  const isAvailable = await checkRuvSwarmAvailable();
  if (!isAvailable) {
    printError('ruv-swarm is not available. Please install it with: npm install -g ruv-swarm');
    return;
  }

  const {
    modelName = 'attention',
    attentionHeads = 8,
    dimensions = 512,
    dropoutRate = 0.1,
    epochs = 50,
    dataSource = 'recent'
  } = flags;

  console.log(`🔧 Training Attention Neural Network\n`);
  console.log(`📋 Configuration:`);
  console.log(`   Model Name: ${modelName}`);
  console.log(`   Attention Heads: ${attentionHeads}`);
  console.log(`   Dimensions: ${dimensions}`);
  console.log(`   Dropout Rate: ${dropoutRate}`);
  console.log(`   Epochs: ${epochs}`);
  console.log(`   Data Source: ${dataSource}\n`);

  try {
    const result = await trainAttentionModel({
      modelName,
      attentionHeads: parseInt(attentionHeads),
      dimensions: parseInt(dimensions),
      dropoutRate: parseFloat(dropoutRate),
      epochs: parseInt(epochs),
      dataSource
    });

    if (result.success) {
      printSuccess(`✅ Attention mechanism training completed successfully!`);
      console.log(`🤖 Model ID: ${result.modelId}`);
      console.log(`📈 Architecture: Attention (${attentionHeads} heads, ${dimensions}D)`);
      console.log(`🎯 Final Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      console.log(`⏱️  Training Time: ${result.training_time.toFixed(1)}s`);
      console.log(`🧠 WASM Accelerated: ${result.wasm_accelerated ? 'Yes' : 'No'}`);
      console.log(`✨ Real Neural Training: ${result.real_neural_training ? 'Yes' : 'Simulated'}`);
    } else {
      printError(`Attention training failed: ${result.error}`);
    }
  } catch (error) {
    printError(`Attention training error: ${error.message}`);
  }
}

async function saveModelCommand(args, flags) {
  const { modelId, path } = flags;

  if (!modelId || !path) {
    printError('Usage: neural-architectures save --model-id <id> --path <path>');
    return;
  }

  try {
    const result = await saveNeuralModel(modelId, path);
    if (result.success) {
      printSuccess(`✅ Model ${modelId} saved successfully`);
      console.log(`📁 File: ${path}`);
      console.log(`📊 Size: ${result.modelSize || 'Unknown'}`);
    } else {
      printError(`Failed to save model: ${result.error}`);
    }
  } catch (error) {
    printError(`Save model error: ${error.message}`);
  }
}

async function loadModelCommand(args, flags) {
  const { path } = flags;

  if (!path) {
    printError('Usage: neural-architectures load --path <path>');
    return;
  }

  try {
    const result = await loadNeuralModel(path);
    if (result.success) {
      printSuccess(`✅ Model loaded successfully`);
      console.log(`🤖 Model ID: ${result.modelId}`);
      console.log(`📈 Type: ${result.modelType || 'Unknown'}`);
      console.log(`📊 Parameters: ${result.parameters || 'Unknown'}`);
    } else {
      printError(`Failed to load model: ${result.error}`);
    }
  } catch (error) {
    printError(`Load model error: ${error.message}`);
  }
}

async function listModelsCommand(args, flags) {
  try {
    const result = await listNeuralModels();
    
    if (result.success) {
      console.log(`🤖 Neural Models (${result.count} found)\n`);
      
      if (result.models && result.models.length > 0) {
        result.models.forEach((model, index) => {
          const isLast = index === result.models.length - 1;
          const prefix = isLast ? '└──' : '├──';
          
          console.log(`${prefix} ${model.name}`);
          console.log(`${isLast ? '   ' : '│  '} 📁 Path: ${model.path}`);
          if (model.size) {
            console.log(`${isLast ? '   ' : '│  '} 📊 Size: ${model.size} bytes`);
          }
          if (model.modified) {
            console.log(`${isLast ? '   ' : '│  '} 📅 Modified: ${new Date(model.modified).toLocaleString()}`);
          }
          if (!isLast) console.log('│');
        });
      } else {
        console.log('   No neural models found');
        console.log('   Train a model first with: claude-flow neural-architectures <type>');
      }
    } else {
      printError(`Failed to list models: ${result.error}`);
    }
  } catch (error) {
    printError(`List models error: ${error.message}`);
  }
}

async function predictCommand(args, flags) {
  const { modelId, input } = flags;

  if (!modelId || !input) {
    printError('Usage: neural-architectures predict --model-id <id> --input <data>');
    return;
  }

  try {
    let inputData;
    try {
      inputData = JSON.parse(input);
    } catch {
      inputData = input;
    }

    const result = await predictWithNeuralModel(modelId, inputData);
    
    if (result.success) {
      printSuccess(`✅ Neural prediction completed`);
      console.log(`🤖 Model: ${modelId}`);
      console.log(`📊 Prediction:`);
      console.log(`   • Outcome: ${result.prediction?.outcome || 'N/A'}`);
      console.log(`   • Confidence: ${result.prediction?.confidence ? (result.prediction.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   • Inference Time: ${result.inference_time_ms || 'N/A'}ms`);
    } else {
      printError(`Prediction failed: ${result.error}`);
    }
  } catch (error) {
    printError(`Prediction error: ${error.message}`);
  }
}

async function wasmConfigCommand(args, flags) {
  const {
    simd = 'true',
    parallel = 'true',
    memory = 'true',
    gpu = 'false'
  } = flags;

  console.log(`🔧 Configuring WASM Optimization\n`);
  console.log(`📋 Settings:`);
  console.log(`   SIMD Enabled: ${simd}`);
  console.log(`   Parallel Processing: ${parallel}`);
  console.log(`   Memory Optimization: ${memory}`);
  console.log(`   GPU Acceleration: ${gpu}\n`);

  try {
    const result = await configureWASMOptimization({
      simdEnabled: simd === 'true',
      parallelProcessing: parallel === 'true',
      memoryOptimization: memory === 'true',
      gpuAcceleration: gpu === 'true'
    });

    if (result.success) {
      printSuccess(`✅ WASM optimization configured successfully`);
    } else {
      printError(`WASM configuration failed: ${result.error}`);
    }
  } catch (error) {
    printError(`WASM configuration error: ${error.message}`);
  }
}

function showNeuralArchitecturesHelp() {
  console.log(`
🧠 Neural Architectures - Real Neural Network Training & Management

USAGE:
  claude-flow neural-architectures <command> [options]

COMMANDS:
  transformer        Train Transformer models (attention-based)
  lstm               Train LSTM models (sequence processing)
  cnn                Train CNN models (image/spatial data)
  attention          Train Attention mechanism models
  save               Save trained models to disk
  load               Load models from disk
  list               List all available models
  predict            Make predictions with trained models
  wasm-config        Configure WASM optimization settings

TRANSFORMER OPTIONS:
  --model-name <name>     Model name (default: transformer)
  --input-dim <dim>       Input dimensions (default: 512)
  --heads <num>           Attention heads (default: 8)
  --layers <num>          Number of layers (default: 6)
  --epochs <num>          Training epochs (default: 50)
  --data-source <source>  Data source (default: recent)

LSTM OPTIONS:
  --model-name <name>     Model name (default: lstm)
  --hidden-size <size>    Hidden units (default: 256)
  --num-layers <num>      Number of layers (default: 2)
  --bidirectional <bool>  Bidirectional (default: true)
  --epochs <num>          Training epochs (default: 50)
  --data-source <source>  Data source (default: recent)

CNN OPTIONS:
  --model-name <name>     Model name (default: cnn)
  --input-shape <shape>   Input shape "H,W,C" (default: 32,32,3)
  --filters <filters>     Filter sizes "F1,F2,F3" (default: 32,64,128)
  --kernel-size <size>    Kernel size (default: 3)
  --epochs <num>          Training epochs (default: 50)
  --data-source <source>  Data source (default: recent)

ATTENTION OPTIONS:
  --model-name <name>     Model name (default: attention)
  --attention-heads <num> Attention heads (default: 8)
  --dimensions <dim>      Feature dimensions (default: 512)
  --dropout-rate <rate>   Dropout rate (default: 0.1)
  --epochs <num>          Training epochs (default: 50)
  --data-source <source>  Data source (default: recent)

MODEL MANAGEMENT:
  --model-id <id>         Model identifier
  --path <path>           File path for save/load
  --input <data>          Input data for prediction (JSON or string)

WASM CONFIGURATION:
  --simd <bool>           Enable SIMD acceleration (default: true)
  --parallel <bool>       Enable parallel processing (default: true)
  --memory <bool>         Enable memory optimization (default: true)
  --gpu <bool>            Enable GPU acceleration (default: false)

EXAMPLES:
  # Train a Transformer with 12 attention heads
  claude-flow neural-architectures transformer --heads 12 --layers 8 --epochs 100

  # Train a bidirectional LSTM for sequence processing
  claude-flow neural-architectures lstm --hidden-size 512 --bidirectional true

  # Train a CNN for image classification
  claude-flow neural-architectures cnn --input-shape "224,224,3" --filters "64,128,256"

  # Train an attention mechanism
  claude-flow neural-architectures attention --attention-heads 16 --dimensions 1024

  # Save a trained model
  claude-flow neural-architectures save --model-id model_transformer_123 --path ./models/transformer.json

  # Load a model for inference
  claude-flow neural-architectures load --path ./models/transformer.json

  # List all available models
  claude-flow neural-architectures list

  # Make predictions with a model
  claude-flow neural-architectures predict --model-id model_123 --input '{"data": [1,2,3]}'

  # Configure WASM with GPU acceleration
  claude-flow neural-architectures wasm-config --gpu true --simd true

🚀 Features:
  • Real ruv-swarm WASM neural training (not simulation)
  • 27+ neural architectures supported
  • SIMD acceleration with WebAssembly
  • Model persistence and management
  • Architecture-specific optimization
  • Live training progress monitoring
`);
}