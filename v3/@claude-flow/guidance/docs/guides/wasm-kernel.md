# WASM Kernel Guide

The WASM kernel offloads hot-path operations (hashing, secret scanning, destructive detection, shard scoring) from JavaScript to Rust compiled to WebAssembly. It loads automatically when available and falls back to JS transparently.

## Architecture

```mermaid
graph LR
    subgraph "Layer B — Node Host"
        H[wasm-kernel.ts]
        FB[JS Fallback]
    end

    subgraph "Layer A — Rust WASM"
        P[proof.rs: SHA-256, HMAC, chain verify]
        G[gates.rs: secrets, destructive]
        S[scoring.rs: shard relevance]
        L[lib.rs: batch_process dispatcher]
    end

    H -->|"Available?"| P
    H -->|"Available?"| G
    H -->|"Available?"| S
    H -.->|"Fallback"| FB
```

**Layer A** (Rust WASM) contains only pure functions — no filesystem, no network, no Node APIs. **Layer B** (Node host) handles loading, error recovery, and fallback.

## Usage

```ts
import { getKernel, isWasmAvailable } from '@claude-flow/guidance/wasm-kernel';

const k = getKernel();
console.log(k.available); // true = WASM, false = JS fallback
console.log(k.version);   // 'guidance-kernel-0.1.0' or 'js-fallback'
```

The `getKernel()` call is idempotent — it loads WASM once, caches the result, and returns the same instance on every subsequent call.

## API

### Proof / Hashing

```ts
// SHA-256 hash
const hash = k.sha256('hello world');
// 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'

// HMAC-SHA256
const mac = k.hmacSha256('secret-key', 'message body');

// Deterministic content hash (sorts JSON keys, then SHA-256)
const contentHash = k.contentHash('{"b":2,"a":1}');
// Same result as k.contentHash('{"a":1,"b":2}')

// Sign a proof envelope
const signature = k.signEnvelope('hmac-key', envelopeJsonString);

// Verify a proof chain
const valid = k.verifyChain(chainJsonString, 'hmac-key');
```

### Gates

```ts
// Scan for secrets — returns array of matched strings
const secrets = k.scanSecrets('export const key = "sk-ant-abc123xyz"');
// ['sk-ant-abc123xyz']

const clean = k.scanSecrets('const x = 42');
// []

// Detect destructive commands — returns matched pattern or null
const destructive = k.detectDestructive('rm -rf /tmp');
// 'rm -rf'

const safe = k.detectDestructive('ls -la');
// null
```

### Secret Patterns (8 built-in)

| Pattern | Example |
|---------|---------|
| API keys | `api_key="abc123"` |
| Passwords | `password: "hunter2"` |
| Tokens | `token="eyJhbG..."` |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----` |
| Anthropic keys | `sk-ant-...` |
| GitHub tokens | `ghp_...` |
| npm tokens | `npm_...` |
| AWS access keys | `AKIA...` |

### Destructive Patterns (12 built-in)

| Pattern | Examples |
|---------|----------|
| File deletion | `rm -rf`, `rm -r` |
| Database drops | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` |
| Git force ops | `git push --force`, `git reset --hard`, `git clean -f` |
| Kubernetes | `kubectl delete --all` |
| Unqualified deletes | `DELETE FROM table` |
| Schema drops | `ALTER TABLE ... DROP` |
| Windows deletion | `del /s`, `format c:` |

### Batch API

For bulk operations, use the batch API to minimize WASM boundary crossings. One WASM call handles many operations:

```ts
const results = k.batchProcess([
  { op: 'sha256', payload: 'data1' },
  { op: 'sha256', payload: 'data2' },
  { op: 'hmac_sha256', payload: 'message', key: 'secret' },
  { op: 'scan_secrets', payload: 'api_key="test"' },
  { op: 'detect_destructive', payload: 'ls -la' },
  { op: 'content_hash', payload: '{"b":2,"a":1}' },
]);

// results[0] = { hash: '...' }
// results[1] = { hash: '...' }
// results[2] = { mac: '...' }
// results[3] = { matches: ['test'] }
// results[4] = { match: null }
// results[5] = { hash: '...' }
```

Supported batch operations: `sha256`, `hmac_sha256`, `content_hash`, `sign_envelope`, `verify_chain`, `scan_secrets`, `detect_destructive`, `score_shards`.

## Performance

Measured on 10,000 iterations with SIMD128 enabled:

| Operation | WASM | JS | Speedup |
|-----------|------|----|---------|
| SHA-256 throughput | 910k/s | 505k/s | **1.80x** |
| Secret scan (dirty input) | 362k/s | 185k/s | **1.96x** |
| Secret scan (clean input) | 676k/s | 402k/s | **1.68x** |
| Proof chain (10k events) | 61ms | 76ms | **1.25x** |

The biggest wins come from regex-heavy operations (secret scanning, destructive detection) where Rust's Aho-Corasick and memchr with SIMD outperform JS's regex engine.

## SIMD128

The kernel is compiled with WebAssembly SIMD128 enabled:

```toml
# wasm-kernel/.cargo/config.toml
[target.wasm32-unknown-unknown]
rustflags = ["-C", "target-feature=+simd128"]
```

SIMD accelerates:
- **SHA-256** — Compression rounds use SIMD instructions
- **Regex** — Aho-Corasick automaton uses SIMD for multi-pattern matching
- **memchr** — Byte scanning uses SIMD for vectorized search

SIMD is supported in all modern runtimes: Node.js 16+, Chrome 91+, Firefox 89+, Safari 16.4+.

## Building from Source

Prerequisites: Rust 1.70+, wasm-pack.

```bash
# Install prerequisites
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Build
cd wasm-kernel
wasm-pack build --target nodejs --out-dir ../wasm-pkg --release

# Run Rust unit tests
cargo test
```

The build produces:
- `wasm-pkg/guidance_kernel_bg.wasm` — The WASM binary (~1.1MB with SIMD+O2)
- `wasm-pkg/guidance_kernel.js` — Node.js glue code
- `wasm-pkg/guidance_kernel.d.ts` — TypeScript declarations

### Build Options

```toml
# Cargo.toml [profile.release]
opt-level = 2        # O2 for speed (not "z" for size)
lto = true           # Link-time optimization
codegen-units = 1    # Better optimization, slower compile
```

To disable wasm-opt (if binaryen download fails):
```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false
```

## Fallback Behavior

If the WASM binary fails to load (missing file, incompatible runtime, etc.), the host bridge transparently falls back to JavaScript implementations:

```ts
const k = getKernel();
// k.available === false — using JS fallback
// All methods still work, just slower:
k.sha256('hello');        // Uses node:crypto createHash
k.scanSecrets(content);   // Uses JS regex
k.detectDestructive(cmd); // Uses JS regex
```

The fallback is functionally identical. The acceptance tests verify output parity between WASM and JS for all operations.

## Testing

```bash
# Run all guidance tests (includes WASM acceptance tests)
cd v3/@claude-flow/guidance
npx vitest run

# Run only WASM tests
npx vitest run tests/wasm-kernel.test.ts
```

The WASM test suite includes:
- Output parity tests (WASM === JS for all operations)
- 10,000-event proof chain (verifies identical root hash)
- Throughput benchmarks (SHA-256, secret scanning)
- Batch API tests
- Fallback behavior tests

## Rust Source Structure

```
wasm-kernel/
  Cargo.toml              # Crate config
  .cargo/config.toml      # SIMD flags
  src/
    lib.rs                # Entry point, batch_process dispatcher
    proof.rs              # SHA-256, HMAC, content hash, chain verify
    gates.rs              # Secret scanning (8 patterns), destructive (12 patterns)
    scoring.rs            # Shard relevance scoring
```

Each Rust module has unit tests (`cargo test` runs 15 tests).
