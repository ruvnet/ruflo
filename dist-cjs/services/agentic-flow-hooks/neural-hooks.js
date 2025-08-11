"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var neural_hooks_exports = {};
__export(neural_hooks_exports, {
  neuralAdaptationHook: () => neuralAdaptationHook,
  neuralPatternDetectedHook: () => neuralPatternDetectedHook,
  neuralPredictionHook: () => neuralPredictionHook,
  postNeuralTrainHook: () => postNeuralTrainHook,
  preNeuralTrainHook: () => preNeuralTrainHook,
  registerNeuralHooks: () => registerNeuralHooks
});
module.exports = __toCommonJS(neural_hooks_exports);
var import_hook_manager = require("./hook-manager.js");
const preNeuralTrainHook = {
  id: "agentic-pre-neural-train",
  type: "pre-neural-train",
  priority: 100,
  handler: async (payload, context) => {
    const { operation, modelId, trainingData } = payload;
    if (operation !== "train" || !trainingData) {
      return { continue: true };
    }
    const sideEffects = [];
    const validation = validateTrainingData(trainingData);
    if (!validation.valid) {
      return {
        continue: false,
        sideEffects: [
          {
            type: "log",
            action: "write",
            data: {
              level: "error",
              message: "Invalid training data",
              data: validation
            }
          }
        ]
      };
    }
    const augmentedData = await augmentTrainingData(
      trainingData,
      modelId,
      context
    );
    const balancedData = balanceTrainingData(augmentedData);
    const preprocessedData = preprocessTrainingData(balancedData);
    sideEffects.push({
      type: "memory",
      action: "store",
      data: {
        key: `neural:training:${modelId}:${Date.now()}`,
        value: {
          originalSize: trainingData.inputs.length,
          augmentedSize: augmentedData.inputs.length,
          balancedSize: balancedData.inputs.length,
          epochs: balancedData.epochs,
          timestamp: Date.now()
        },
        ttl: 86400
        // 24 hours
      }
    });
    return {
      continue: true,
      modified: true,
      payload: {
        ...payload,
        trainingData: preprocessedData
      },
      sideEffects
    };
  }
};
const postNeuralTrainHook = {
  id: "agentic-post-neural-train",
  type: "post-neural-train",
  priority: 100,
  handler: async (payload, context) => {
    const { modelId, accuracy, trainingData } = payload;
    const sideEffects = [];
    const trainingResult = {
      modelId,
      accuracy,
      timestamp: Date.now(),
      sessionId: context.sessionId,
      dataSize: trainingData?.inputs.length || 0,
      epochs: trainingData?.epochs || 0
    };
    sideEffects.push({
      type: "memory",
      action: "store",
      data: {
        key: `neural:results:${modelId}:${Date.now()}`,
        value: trainingResult,
        ttl: 604800
        // 7 days
      }
    });
    await updateModelPerformance(modelId, accuracy, context);
    const shouldPromote = await evaluateModelPromotion(modelId, accuracy, context);
    if (shouldPromote) {
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "neural:model:promoted",
          data: { modelId, accuracy }
        }
      });
    }
    const patterns = await extractLearnedPatterns(modelId, context);
    if (patterns.length > 0) {
      sideEffects.push({
        type: "neural",
        action: "store-patterns",
        data: { patterns }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
const neuralPatternDetectedHook = {
  id: "agentic-neural-pattern-detected",
  type: "neural-pattern-detected",
  priority: 90,
  handler: async (payload, context) => {
    const { patterns } = payload;
    if (!patterns || patterns.length === 0) {
      return { continue: true };
    }
    const sideEffects = [];
    for (const pattern of patterns) {
      const significance = calculatePatternSignificance(pattern);
      if (significance > 0.7) {
        sideEffects.push({
          type: "memory",
          action: "store",
          data: {
            key: `pattern:significant:${pattern.id}`,
            value: {
              pattern,
              significance,
              detectedAt: Date.now(),
              context: context.metadata
            },
            ttl: 0
            // Permanent
          }
        });
        const adaptation = await generateAdaptation(pattern, context);
        if (adaptation) {
          sideEffects.push({
            type: "neural",
            action: "adapt",
            data: { adaptation }
          });
        }
      }
      context.neural.patterns.add(pattern);
    }
    const combinations = findPatternCombinations(patterns, context);
    if (combinations.length > 0) {
      sideEffects.push({
        type: "log",
        action: "write",
        data: {
          level: "info",
          message: "Pattern combinations detected",
          data: { combinations }
        }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
const neuralPredictionHook = {
  id: "agentic-neural-prediction",
  type: "neural-prediction",
  priority: 100,
  handler: async (payload, context) => {
    const { prediction, modelId } = payload;
    if (!prediction) {
      return { continue: true };
    }
    const sideEffects = [];
    if (prediction.confidence < 0.5) {
      const alternatives = await generateAlternatives(
        prediction.input,
        modelId,
        context
      );
      if (alternatives.length > 0) {
        return {
          continue: true,
          modified: true,
          payload: {
            ...payload,
            prediction: {
              ...prediction,
              alternatives: [...prediction.alternatives, ...alternatives]
            }
          },
          sideEffects: [
            {
              type: "metric",
              action: "increment",
              data: { name: "neural.predictions.low_confidence" }
            }
          ]
        };
      }
    }
    sideEffects.push({
      type: "memory",
      action: "store",
      data: {
        key: `prediction:${modelId}:${Date.now()}`,
        value: {
          input: prediction.input,
          output: prediction.output,
          confidence: prediction.confidence,
          timestamp: Date.now()
        },
        ttl: 86400
        // 24 hours
      }
    });
    sideEffects.push({
      type: "metric",
      action: "update",
      data: {
        name: `neural.predictions.confidence.${modelId}`,
        value: prediction.confidence
      }
    });
    return {
      continue: true,
      sideEffects
    };
  }
};
const neuralAdaptationHook = {
  id: "agentic-neural-adaptation",
  type: "neural-adaptation",
  priority: 90,
  handler: async (payload, context) => {
    const { adaptations, modelId } = payload;
    if (!adaptations || adaptations.length === 0) {
      return { continue: true };
    }
    const sideEffects = [];
    const validAdaptations = adaptations.filter(
      (a) => validateAdaptation(a, modelId, context)
    );
    if (validAdaptations.length === 0) {
      return { continue: true };
    }
    const sortedAdaptations = validAdaptations.sort(
      (a, b) => Math.abs(b.impact) - Math.abs(a.impact)
    );
    for (const adaptation of sortedAdaptations) {
      sideEffects.push({
        type: "memory",
        action: "store",
        data: {
          key: `adaptation:${modelId}:${adaptation.target}:${Date.now()}`,
          value: adaptation,
          ttl: 604800
          // 7 days
        }
      });
      switch (adaptation.type) {
        case "parameter":
          await applyParameterAdaptation(adaptation, modelId, context);
          break;
        case "architecture":
          await applyArchitectureAdaptation(adaptation, modelId, context);
          break;
        case "strategy":
          await applyStrategyAdaptation(adaptation, modelId, context);
          break;
      }
      sideEffects.push({
        type: "metric",
        action: "increment",
        data: { name: `neural.adaptations.${adaptation.type}` }
      });
    }
    const totalImpact = sortedAdaptations.reduce(
      (sum, a) => sum + Math.abs(a.impact),
      0
    );
    if (totalImpact > 0.5) {
      sideEffects.push({
        type: "neural",
        action: "retrain",
        data: {
          modelId,
          reason: "significant_adaptations",
          adaptations: sortedAdaptations.length
        }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
function validateTrainingData(data) {
  const errors = [];
  if (!data.inputs || data.inputs.length === 0) {
    errors.push("No input data provided");
  }
  if (!data.outputs || data.outputs.length === 0) {
    errors.push("No output data provided");
  }
  if (data.inputs.length !== data.outputs.length) {
    errors.push("Input and output lengths do not match");
  }
  if (data.batchSize <= 0) {
    errors.push("Invalid batch size");
  }
  if (data.epochs <= 0) {
    errors.push("Invalid number of epochs");
  }
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : void 0
  };
}
__name(validateTrainingData, "validateTrainingData");
async function augmentTrainingData(data, modelId, context) {
  const historicalPatterns = await loadHistoricalPatterns(modelId, context);
  const augmented = {
    ...data,
    inputs: [...data.inputs],
    outputs: [...data.outputs],
    labels: data.labels ? [...data.labels] : void 0,
    weights: data.weights ? [...data.weights] : void 0
  };
  for (const pattern of historicalPatterns) {
    if (pattern.type === "success" && pattern.confidence > 0.8) {
      augmented.inputs.push(pattern.context.input);
      augmented.outputs.push(pattern.context.output);
      if (augmented.weights) {
        augmented.weights.push(pattern.confidence);
      }
    }
  }
  return augmented;
}
__name(augmentTrainingData, "augmentTrainingData");
function balanceTrainingData(data) {
  if (!data.labels) {
    return data;
  }
  const labelCounts = /* @__PURE__ */ new Map();
  for (const label of data.labels) {
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const minCount = Math.min(...labelCounts.values());
  const balanced = {
    ...data,
    inputs: [],
    outputs: [],
    labels: [],
    weights: data.weights ? [] : void 0
  };
  const labelIndices = /* @__PURE__ */ new Map();
  data.labels.forEach((label, i) => {
    if (!labelIndices.has(label)) {
      labelIndices.set(label, []);
    }
    labelIndices.get(label).push(i);
  });
  for (const [label, indices] of labelIndices.entries()) {
    const sampled = indices.sort(() => Math.random() - 0.5).slice(0, minCount);
    for (const idx of sampled) {
      balanced.inputs.push(data.inputs[idx]);
      balanced.outputs.push(data.outputs[idx]);
      balanced.labels.push(label);
      if (data.weights && balanced.weights) {
        balanced.weights.push(data.weights[idx]);
      }
    }
  }
  return balanced;
}
__name(balanceTrainingData, "balanceTrainingData");
function preprocessTrainingData(data) {
  const processed = {
    ...data,
    inputs: data.inputs.map((input) => normalizeInput(input)),
    outputs: data.outputs.map((output) => normalizeOutput(output))
  };
  return processed;
}
__name(preprocessTrainingData, "preprocessTrainingData");
function normalizeInput(input) {
  return input;
}
__name(normalizeInput, "normalizeInput");
function normalizeOutput(output) {
  return output;
}
__name(normalizeOutput, "normalizeOutput");
async function updateModelPerformance(modelId, accuracy, context) {
  const perfKey = `model:performance:${modelId}`;
  const history = await context.memory.cache.get(perfKey) || [];
  history.push({
    accuracy,
    timestamp: Date.now(),
    sessionId: context.sessionId
  });
  if (history.length > 100) {
    history.shift();
  }
  await context.memory.cache.set(perfKey, history);
}
__name(updateModelPerformance, "updateModelPerformance");
async function evaluateModelPromotion(modelId, accuracy, context) {
  const perfKey = `model:performance:${modelId}`;
  const history = await context.memory.cache.get(perfKey) || [];
  if (history.length < 10) {
    return false;
  }
  const recent = history.slice(-10);
  const avgAccuracy = recent.reduce(
    (sum, h) => sum + h.accuracy,
    0
  ) / recent.length;
  return avgAccuracy > 0.85 && accuracy > 0.85;
}
__name(evaluateModelPromotion, "evaluateModelPromotion");
async function extractLearnedPatterns(modelId, context) {
  return [];
}
__name(extractLearnedPatterns, "extractLearnedPatterns");
function calculatePatternSignificance(pattern) {
  const baseScore = pattern.confidence;
  const occurrenceBonus = Math.min(pattern.occurrences / 100, 0.2);
  return Math.min(baseScore + occurrenceBonus, 1);
}
__name(calculatePatternSignificance, "calculatePatternSignificance");
async function generateAdaptation(pattern, context) {
  if (pattern.type === "failure" && pattern.confidence > 0.8) {
    return {
      type: "parameter",
      target: "learning_rate",
      oldValue: context.neural.training.learningRate,
      newValue: context.neural.training.learningRate * 0.9,
      reason: `High confidence failure pattern detected: ${pattern.id}`,
      impact: -0.1
    };
  }
  if (pattern.type === "optimization" && pattern.confidence > 0.9) {
    return {
      type: "strategy",
      target: "batch_size",
      oldValue: 32,
      newValue: 64,
      reason: `Optimization opportunity detected: ${pattern.id}`,
      impact: 0.2
    };
  }
  return null;
}
__name(generateAdaptation, "generateAdaptation");
function findPatternCombinations(patterns, context) {
  const combinations = [];
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const pattern1 = patterns[i];
      const pattern2 = patterns[j];
      if (areRelatedPatterns(pattern1, pattern2)) {
        const significance = (pattern1.confidence + pattern2.confidence) / 2 * 1.2;
        combinations.push({
          patterns: [pattern1, pattern2],
          significance: Math.min(significance, 1)
        });
      }
    }
  }
  return combinations;
}
__name(findPatternCombinations, "findPatternCombinations");
function areRelatedPatterns(p1, p2) {
  return p1.type === p2.type || Object.keys(p1.context).some((key) => key in p2.context);
}
__name(areRelatedPatterns, "areRelatedPatterns");
async function generateAlternatives(input, modelId, context) {
  return [];
}
__name(generateAlternatives, "generateAlternatives");
function validateAdaptation(adaptation, modelId, context) {
  if (Math.abs(adaptation.impact) > 0.5) {
    return context.neural.training.epoch > 10;
  }
  return true;
}
__name(validateAdaptation, "validateAdaptation");
async function applyParameterAdaptation(adaptation, modelId, context) {
}
__name(applyParameterAdaptation, "applyParameterAdaptation");
async function applyArchitectureAdaptation(adaptation, modelId, context) {
}
__name(applyArchitectureAdaptation, "applyArchitectureAdaptation");
async function applyStrategyAdaptation(adaptation, modelId, context) {
}
__name(applyStrategyAdaptation, "applyStrategyAdaptation");
async function loadHistoricalPatterns(modelId, context) {
  const patterns = [];
  const patternKeys = await context.memory.cache.get(`patterns:${modelId}`) || [];
  for (const key of patternKeys.slice(-100)) {
    const pattern = await context.memory.cache.get(key);
    if (pattern) {
      patterns.push(pattern);
    }
  }
  return patterns;
}
__name(loadHistoricalPatterns, "loadHistoricalPatterns");
function registerNeuralHooks() {
  import_hook_manager.agenticHookManager.register(preNeuralTrainHook);
  import_hook_manager.agenticHookManager.register(postNeuralTrainHook);
  import_hook_manager.agenticHookManager.register(neuralPatternDetectedHook);
  import_hook_manager.agenticHookManager.register(neuralPredictionHook);
  import_hook_manager.agenticHookManager.register(neuralAdaptationHook);
}
__name(registerNeuralHooks, "registerNeuralHooks");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  neuralAdaptationHook,
  neuralPatternDetectedHook,
  neuralPredictionHook,
  postNeuralTrainHook,
  preNeuralTrainHook,
  registerNeuralHooks
});
//# sourceMappingURL=neural-hooks.js.map
