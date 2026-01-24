/**
 * Financial Risk Plugin - Bridge Tests
 *
 * Tests for FinancialEconomyBridge and FinancialSparseBridge initialization, lifecycle, and methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FinancialEconomyBridge } from '../src/bridges/economy-bridge.js';
import { FinancialSparseBridge } from '../src/bridges/sparse-bridge.js';

// Mock WASM modules
vi.mock('../src/bridges/economy-wasm.js', () => ({
  initWasm: vi.fn().mockResolvedValue(undefined),
  wasmAvailable: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/bridges/sparse-wasm.js', () => ({
  initWasm: vi.fn().mockResolvedValue(undefined),
  wasmAvailable: vi.fn().mockReturnValue(false),
}));

describe('FinancialEconomyBridge', () => {
  let bridge: FinancialEconomyBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new FinancialEconomyBridge();
  });

  afterEach(() => {
    try {
      bridge.destroy();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should create bridge instance', () => {
      expect(bridge).toBeInstanceOf(FinancialEconomyBridge);
    });

    it('should initialize successfully', async () => {
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });

    it('should initialize with custom config', async () => {
      await bridge.initialize({
        precision: 8,
        randomSeed: 42,
        defaultScenarios: 5000,
      });
      expect(bridge.initialized).toBe(true);
    });

    it('should handle double initialization gracefully', async () => {
      await bridge.initialize();
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should destroy successfully', async () => {
      await bridge.initialize();
      bridge.destroy();
      expect(bridge.initialized).toBe(false);
    });

    it('should handle destroy when not initialized', () => {
      expect(() => bridge.destroy()).not.toThrow();
    });

    it('should reinitialize after destroy', async () => {
      await bridge.initialize();
      bridge.destroy();
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });
  });

  describe('Risk Calculations', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should calculate risk metrics for portfolio', async () => {
      const holdings = [
        { symbol: 'AAPL', value: 100000 },
        { symbol: 'GOOGL', value: 150000 },
      ];

      const metrics = await bridge.calculateRiskMetrics(holdings, {
        confidenceLevel: 0.95,
        horizon: '1d',
      });

      expect(metrics).toHaveProperty('var');
      expect(metrics).toHaveProperty('volatility');
    });

    it('should handle empty portfolio', async () => {
      const metrics = await bridge.calculateRiskMetrics([], {
        confidenceLevel: 0.95,
        horizon: '1d',
      });

      expect(metrics.var).toBe(0);
    });

    it('should run Monte Carlo simulation', async () => {
      const holdings = [
        { symbol: 'SPY', value: 500000 },
      ];

      const result = await bridge.runMonteCarloSimulation(holdings, {
        scenarios: 1000,
        horizon: 10,
      });

      expect(result).toHaveProperty('scenarios');
      expect(result).toHaveProperty('percentiles');
    });
  });

  describe('Audit Trail', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should generate calculation proof', async () => {
      const holdings = [{ symbol: 'TEST', value: 100000 }];

      await bridge.calculateRiskMetrics(holdings, {
        confidenceLevel: 0.95,
        horizon: '1d',
      });

      const proof = await bridge.generateCalculationProof();

      expect(proof).toHaveProperty('timestamp');
      expect(proof).toHaveProperty('hash');
    });
  });

  describe('JavaScript Fallback', () => {
    it('should work without WASM', async () => {
      const fallbackBridge = new FinancialEconomyBridge();
      await fallbackBridge.initialize();

      expect(fallbackBridge.initialized).toBe(true);

      fallbackBridge.destroy();
    });
  });

  describe('Memory Management', () => {
    it('should release resources on destroy', async () => {
      await bridge.initialize();
      bridge.destroy();
      expect(bridge.initialized).toBe(false);
    });

    it('should handle multiple init/destroy cycles', async () => {
      for (let i = 0; i < 3; i++) {
        await bridge.initialize();
        bridge.destroy();
      }
      expect(bridge.initialized).toBe(false);
    });
  });
});

describe('FinancialSparseBridge', () => {
  let bridge: FinancialSparseBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new FinancialSparseBridge();
  });

  afterEach(() => {
    try {
      bridge.destroy();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should create bridge instance', () => {
      expect(bridge).toBeInstanceOf(FinancialSparseBridge);
    });

    it('should initialize successfully', async () => {
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });

    it('should initialize with custom config', async () => {
      await bridge.initialize({
        inputDim: 256,
        hiddenDim: 128,
        sparsityThreshold: 0.01,
      });
      expect(bridge.initialized).toBe(true);
    });

    it('should handle double initialization gracefully', async () => {
      await bridge.initialize();
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should destroy successfully', async () => {
      await bridge.initialize();
      bridge.destroy();
      expect(bridge.initialized).toBe(false);
    });

    it('should handle destroy when not initialized', () => {
      expect(() => bridge.destroy()).not.toThrow();
    });
  });

  describe('Anomaly Detection', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should detect anomalies in transactions', async () => {
      const transactions = [
        { id: 't1', amount: 100, timestamp: new Date().toISOString(), parties: ['A', 'B'] },
        { id: 't2', amount: 150, timestamp: new Date().toISOString(), parties: ['A', 'C'] },
        { id: 't3', amount: 10000000, timestamp: new Date().toISOString(), parties: ['X', 'Y', 'Z'] }, // Anomaly
      ];

      const result = await bridge.detectAnomalies(transactions);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty transactions', async () => {
      const result = await bridge.detectAnomalies([]);
      expect(result).toEqual([]);
    });
  });

  describe('Market Regime Classification', () => {
    beforeEach(async () => {
      await bridge.initialize();
    });

    it('should classify market regime', async () => {
      const prices = Array(50).fill(100).map((v, i) => v + (Math.random() - 0.5) * 10 + i * 0.1);

      const result = await bridge.classifyMarketRegime(prices);

      expect(result).toHaveProperty('regime');
      expect(result).toHaveProperty('confidence');
    });
  });

  describe('JavaScript Fallback', () => {
    it('should work without WASM', async () => {
      const fallbackBridge = new FinancialSparseBridge();
      await fallbackBridge.initialize();

      expect(fallbackBridge.initialized).toBe(true);

      fallbackBridge.destroy();
    });
  });

  describe('Memory Management', () => {
    it('should release resources on destroy', async () => {
      await bridge.initialize();
      bridge.destroy();
      expect(bridge.initialized).toBe(false);
    });

    it('should handle multiple init/destroy cycles', async () => {
      for (let i = 0; i < 3; i++) {
        await bridge.initialize();
        bridge.destroy();
      }
      expect(bridge.initialized).toBe(false);
    });
  });
});
