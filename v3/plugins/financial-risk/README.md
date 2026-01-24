# @claude-flow/plugin-financial-risk

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-financial-risk.svg)](https://www.npmjs.com/package/@claude-flow/plugin-financial-risk)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-financial-risk.svg)](https://www.npmjs.com/package/@claude-flow/plugin-financial-risk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance financial risk analysis plugin combining sparse inference for efficient market signal processing with graph neural networks for transaction network analysis. The plugin enables real-time anomaly detection, portfolio risk scoring, and automated compliance reporting while maintaining the explainability required by financial regulators (SEC, FINRA, Basel III).

## Features

- **Portfolio Risk Analysis**: Calculate VaR, CVaR, Sharpe ratio, Sortino ratio, and max drawdown
- **Anomaly Detection**: Detect fraud, AML violations, and market manipulation in transactions
- **Market Regime Classification**: Identify current market regime through historical pattern matching
- **Compliance Checking**: Automated verification against Basel III, MiFID II, Dodd-Frank, AML, and KYC
- **Stress Testing**: Run historical and hypothetical stress scenarios on portfolios

## Installation

### npm

```bash
npm install @claude-flow/plugin-financial-risk
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-financial-risk
```

## Quick Start

```typescript
import { FinancialRiskPlugin } from '@claude-flow/plugin-financial-risk';

// Initialize the plugin
const finance = new FinancialRiskPlugin({
  marketDataPath: './data/market',
  modelPath: './data/models',
  auditLogPath: './logs/audit'
});

// Analyze portfolio risk
const risk = await finance.portfolioRisk({
  holdings: [
    { symbol: 'AAPL', quantity: 100, assetClass: 'equity' },
    { symbol: 'GOOGL', quantity: 50, assetClass: 'equity' },
    { symbol: 'TLT', quantity: 200, assetClass: 'bond' }
  ],
  riskMetrics: ['var', 'cvar', 'sharpe'],
  confidenceLevel: 0.95,
  horizon: '1d'
});

// Detect anomalies in transactions
const anomalies = await finance.anomalyDetect({
  transactions: [
    { id: 'tx-001', amount: 50000, timestamp: '2024-01-15T10:30:00Z', parties: ['ACC-123', 'ACC-456'] },
    { id: 'tx-002', amount: 1000000, timestamp: '2024-01-15T10:31:00Z', parties: ['ACC-123', 'ACC-789'] }
  ],
  sensitivity: 0.8,
  context: 'fraud'
});

// Check regulatory compliance
const compliance = await finance.complianceCheck({
  entity: 'FUND-001',
  regulations: ['basel3', 'mifid2'],
  scope: 'capital',
  asOfDate: '2024-01-15'
});
```

## MCP Tools

### 1. `finance/portfolio-risk`

Calculate comprehensive portfolio risk metrics.

```typescript
const result = await mcp.invoke('finance/portfolio-risk', {
  holdings: [
    { symbol: 'SPY', quantity: 1000, assetClass: 'equity' },
    { symbol: 'BND', quantity: 500, assetClass: 'bond' },
    { symbol: 'GLD', quantity: 200, assetClass: 'commodity' }
  ],
  riskMetrics: ['var', 'cvar', 'sharpe', 'max_drawdown'],
  confidenceLevel: 0.99,
  horizon: '1w'
});

// Returns:
// {
//   var: { value: 0.023, confidenceLevel: 0.99 },
//   cvar: { value: 0.031 },
//   sharpe: { value: 1.45 },
//   maxDrawdown: { value: 0.082, period: '2023-10-01 to 2023-10-15' }
// }
```

### 2. `finance/anomaly-detect`

Detect anomalies in financial transactions and market data.

```typescript
const result = await mcp.invoke('finance/anomaly-detect', {
  transactions: [
    {
      id: 'tx-12345',
      amount: 250000,
      timestamp: '2024-01-15T14:30:00Z',
      parties: ['CORP-A', 'CORP-B'],
      metadata: { type: 'wire', currency: 'USD' }
    }
  ],
  sensitivity: 0.9,
  context: 'aml'
});

// Returns:
// {
//   anomalies: [{
//     transactionId: 'tx-12345',
//     score: 0.87,
//     reasons: ['unusual_amount', 'first_time_counterparty', 'velocity_spike'],
//     recommendation: 'review'
//   }]
// }
```

### 3. `finance/market-regime`

Identify current market regime through pattern matching.

```typescript
const result = await mcp.invoke('finance/market-regime', {
  marketData: {
    prices: [100, 102, 99, 101, 103, 105, 104],
    volumes: [1000000, 1200000, 900000, 1100000, 1300000, 1500000, 1400000],
    volatility: [0.15, 0.16, 0.18, 0.17, 0.14, 0.13, 0.14]
  },
  lookbackPeriod: 252,
  regimeTypes: ['bull', 'bear', 'high_vol', 'crisis']
});

// Returns:
// {
//   currentRegime: 'bull',
//   confidence: 0.82,
//   similarHistoricalPeriods: ['2017-Q3', '2019-Q4'],
//   transitionProbabilities: { bull: 0.75, bear: 0.15, high_vol: 0.10 }
// }
```

### 4. `finance/compliance-check`

Automated regulatory compliance verification.

```typescript
const result = await mcp.invoke('finance/compliance-check', {
  entity: 'BANK-001',
  regulations: ['basel3', 'dodd_frank'],
  scope: 'capital',
  asOfDate: '2024-01-15'
});

// Returns:
// {
//   compliant: true,
//   metrics: {
//     tier1Capital: { value: 0.125, requirement: 0.06, status: 'pass' },
//     leverageRatio: { value: 0.05, requirement: 0.03, status: 'pass' }
//   },
//   warnings: ['tier1 buffer approaching minimum']
// }
```

### 5. `finance/stress-test`

Run stress testing scenarios on portfolios.

```typescript
const result = await mcp.invoke('finance/stress-test', {
  portfolio: {
    holdings: [
      { symbol: 'SPY', quantity: 1000 },
      { symbol: 'QQQ', quantity: 500 }
    ]
  },
  scenarios: [
    { name: '2008 Financial Crisis', type: 'historical', shocks: {} },
    { name: 'Interest Rate +300bp', type: 'hypothetical', shocks: { rateShock: 0.03 } }
  ],
  metrics: ['pnl', 'var_change', 'margin_call_risk']
});
```

## Configuration Options

```typescript
interface FinancialRiskConfig {
  // Data paths
  marketDataPath: string;         // Path to market data cache
  modelPath: string;              // Path to trained models

  // Compliance
  auditLogPath: string;           // Path for SOX-compliant audit logs
  regulatoryReporting: boolean;   // Enable auto-generated reports

  // Performance
  maxMemoryMB: number;            // WASM memory limit (default: 1024)
  maxCpuTimeSeconds: number;      // Operation timeout (default: 60)

  // Security
  encryptionEnabled: boolean;     // AES-256 encryption (default: true)
  hsmKeyId?: string;              // HSM key identifier for production

  // Rate limiting
  rateLimits: {
    requestsPerMinute: number;
    maxConcurrent: number;
  };
}
```

## Security Considerations

### Regulatory Compliance

This plugin is designed for financial regulatory compliance:

| Requirement | Implementation |
|-------------|----------------|
| **PCI-DSS Compliance** | No storage of PAN/CVV in plugin memory |
| **SOX Compliance** | Immutable audit logs for all risk calculations |
| **Data Encryption** | AES-256 for data at rest, TLS 1.3 in transit |
| **Key Management** | HSM or secure enclave for cryptographic keys |
| **Segregation of Duties** | Separate roles for trading, risk, and compliance |

### Role-Based Access Control

```typescript
const roles = {
  TRADER: ['portfolio-risk', 'market-regime'],
  RISK_MANAGER: ['portfolio-risk', 'anomaly-detect', 'stress-test', 'market-regime'],
  COMPLIANCE_OFFICER: ['compliance-check', 'anomaly-detect'],
  AUDITOR: ['compliance-check'],  // Read-only with full audit access
  QUANT: ['portfolio-risk', 'market-regime', 'stress-test']
};
```

### Audit Logging (SOX/MiFID II)

All calculations are logged with:
- Timestamp with microsecond precision
- User ID and role
- Transaction IDs affected
- Portfolio state hash
- Model version used
- Input/output hashes for reproducibility

Logs are retained for 7 years per MiFID II requirements and available for regulatory inspection within 72 hours.

### WASM Security Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Memory Limit | 1GB max | Handle large transaction datasets |
| CPU Time Limit | 60 seconds | Allow complex risk calculations |
| No Network Access | Enforced | Prevent data exfiltration |
| No File System Write | Enforced | Analysis-only mode |
| Sandboxed Data Access | Enforced | No direct database queries |

### Input Validation

All inputs are validated using Zod schemas:
- Stock symbols: `/^[A-Z0-9.]{1,10}$/`
- Position quantities: between -1 billion and 1 billion
- Transaction amounts: between -1 trillion and 1 trillion
- Batch limits: maximum 100,000 transactions per request
- Timestamps: ISO 8601 format, within reasonable date range
- Entity identifiers: Alphanumeric with limited special characters

### Rate Limiting

```typescript
const rateLimits = {
  'portfolio-risk': { requestsPerMinute: 60, maxConcurrent: 5 },
  'anomaly-detect': { requestsPerMinute: 100, maxConcurrent: 10 },
  'stress-test': { requestsPerMinute: 10, maxConcurrent: 2 },
  'market-regime': { requestsPerMinute: 120, maxConcurrent: 10 },
  'compliance-check': { requestsPerMinute: 30, maxConcurrent: 3 }
};
```

## Performance

| Metric | Target |
|--------|--------|
| Portfolio VaR calculation | <100ms for 10K positions |
| Transaction anomaly scoring | <5ms per transaction |
| Market regime classification | <50ms for 1-year history |
| Compliance check | <1s for full entity scan |

## Dependencies

- `micro-hnsw-wasm`: Fast similarity search for historical pattern matching
- `ruvector-sparse-inference-wasm`: Efficient processing of sparse financial features
- `ruvector-gnn-wasm`: Transaction network analysis for fraud detection
- `ruvector-economy-wasm`: Token economics and market microstructure modeling
- `ruvector-learning-wasm`: Reinforcement learning for adaptive risk thresholds

## Related Plugins

| Plugin | Description | Use Case |
|--------|-------------|----------|
| [@claude-flow/plugin-legal-contracts](../legal-contracts) | Contract analysis | Financial agreements, derivatives documentation |
| [@claude-flow/plugin-healthcare-clinical](../healthcare-clinical) | Clinical decision support | Healthcare portfolio analysis |
| [@claude-flow/plugin-perf-optimizer](../perf-optimizer) | Performance optimization | High-frequency trading latency optimization |

## License

MIT License

Copyright (c) 2026 Claude Flow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
