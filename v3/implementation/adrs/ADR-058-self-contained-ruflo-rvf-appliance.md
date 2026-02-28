# ADR-058: Self-Contained Ruflo RVF Appliance — Linux Kernel + Claude Code + ruvLLM

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-02-28 |
| **Authors** | Claude Flow Team |
| **Supersedes** | — |
| **Related** | ADR-057 (RVF Native Storage), ADR-054 (RVF Plugin Marketplace), ADR-056 (agentic-flow v3 Integration), ADR-017 (RuVector Integration) |

---

## 1. Context

### The Problem

Ruflo v3.5 requires the user to have Node.js 20+, npm, Claude Code CLI, API keys, and a properly configured OS environment. This means:

- **10+ setup steps** before a user can run their first agent swarm
- **Network dependency** at runtime for API calls, npm installs, MCP server downloads
- **Environment drift** between dev, CI, staging, and production
- **No offline capability** — the system is unusable without internet
- **Reproducibility gaps** — "works on my machine" across OS, Node, and npm versions

### The Vision

A **single `ruflo.rvf` file** that contains everything needed to run the full Ruflo platform:

```
ruflo.rvf (self-contained appliance)
├── Linux microkernel (Alpine-based, ~5MB)
├── Node.js 22 runtime (~30MB stripped)
├── Claude Code CLI
├── Ruflo v3.5+ (all packages)
├── ruvLLM local inference OR API key vault
├── AgentDB with HNSW indexes
├── Pre-trained SONA patterns
├── 60+ agent definitions
├── MCP server (pre-configured)
└── Capability verification suite
```

One file. No install. No dependencies. Works offline with ruvLLM, or connects to cloud APIs.

### Why RVF as the Container Format

The RVF (RuVector Format) binary format from ADR-057 already provides:

| RVF Feature | Appliance Use |
|-------------|---------------|
| Magic bytes (`RVF\0`, `RVEC`, `RVFL`, `RVLS`) | Section identification within appliance |
| Header + payload binary layout | Metadata + compressed filesystem layers |
| Atomic write (tmp + rename) | Safe appliance updates |
| CRC32/SHA256 integrity | Appliance verification |
| Streaming reads | Boot without full decompression |

Extending RVF to `RVFA` (RuVector Format Appliance) creates a unified format that Ruflo already understands natively.

---

## 2. Decision

### 2.1 Appliance Format: `RVFA` (RuVector Format Appliance)

```
┌─────────────────────────────────────────────────┐
│ Magic: RVFA (4 bytes)                           │
│ Version: u32 (4 bytes)                          │
│ Header Length: u32 (4 bytes)                     │
├─────────────────────────────────────────────────┤
│ Header (JSON):                                  │
│   name, version, created, arch, platform        │
│   sections: [{ id, type, offset, size, sha256 }]│
│   boot: { entrypoint, args, env }               │
│   models: { provider, engine, config }          │
│   capabilities: [list of verified caps]         │
├─────────────────────────────────────────────────┤
│ Section 0: KERNEL (compressed rootfs)           │
│   Alpine Linux 3.23 minimal + busybox           │
│   /sbin/init → ruflo-init (PID 1)              │
├─────────────────────────────────────────────────┤
│ Section 1: RUNTIME (compressed)                 │
│   Node.js 22 (stripped, no npm)                 │
│   Claude Code CLI binary                        │
├─────────────────────────────────────────────────┤
│ Section 2: RUFLO (compressed)                   │
│   @claude-flow/cli + shared + guidance           │
│   All 26 commands, 140+ subcommands             │
│   60+ agent definitions                         │
│   17 hooks + 12 workers                         │
│   MCP server (pre-configured, stdio + SSE)      │
├─────────────────────────────────────────────────┤
│ Section 3: MODELS (compressed, optional)        │
│   ruvLLM engine (GGUF quantized models)          │
│   OR: encrypted API key vault (.env.enc)        │
│   OR: hybrid (local small + cloud large)        │
├─────────────────────────────────────────────────┤
│ Section 4: DATA (RVF native)                    │
│   AgentDB with pre-built HNSW indexes           │
│   Pre-trained SONA patterns                     │
│   Plugin registry snapshot                      │
│   Capability verification checksums             │
├─────────────────────────────────────────────────┤
│ Section 5: VERIFY (plaintext)                   │
│   Built-in capability test suite                │
│   Expected results manifest                     │
│   Self-test entrypoint                          │
├─────────────────────────────────────────────────┤
│ Footer: SHA256 of all sections (32 bytes)       │
└─────────────────────────────────────────────────┘
```

### 2.2 Model Strategy: ruvLLM + API Key Vault

Three model configurations, selected at build time:

| Profile | Models Included | Size | Offline | Use Case |
|---------|----------------|------|---------|----------|
| `offline` | ruvLLM + Qwen2.5-Coder-3B-Q4 + Phi-3-mini-Q4 | ~4GB | Full | Air-gapped, edge, demos |
| `hybrid` | ruvLLM + Phi-3-mini-Q4 + API vault | ~2GB | Partial | Local routing + cloud for complex tasks |
| `cloud` | API key vault only (no local models) | ~80MB | No | Minimal size, full cloud |

**ruvLLM** is the local language model inference engine from the [RuVector](https://www.npmjs.com/package/@ruvector/core) ecosystem. It extends the existing @ruvector packages (core, router, sona, attention) with on-device LLM inference:

```
ruvLLM Architecture (extends @ruvector):
├── @ruvector/core — vector database, Q-learning router, AST analysis
├── @ruvector/router — ML-based intelligent task routing (~80% accuracy)
├── @ruvector/sona — Self-Optimizing Neural Architecture (<0.05ms)
├── @ruvector/attention — Flash Attention (2.49x-7.47x speedup)
├── @ruvector/micro-hnsw-wasm — HNSW vector search (WASM)
└── ruvLLM (new):
    ├── GGUF model loader (llama.cpp compatible)
    ├── KV-cache with RVF persistence
    ├── Token streaming over stdio/SSE
    ├── Automatic model selection by task complexity
    │   ├── Tier 1: Agent Booster (WASM, <1ms) — simple transforms
    │   ├── Tier 2: Phi-3-mini-Q4 (local, ~200ms) — routing, classification
    │   └── Tier 3: Qwen2.5-Coder-3B-Q4 (local, ~2s) — code generation
    └── Fallback to cloud API if local confidence < threshold
```

ruvLLM bridges the gap between RuVector's vector intelligence (search, routing, learning) and full language model inference, keeping everything in the same ecosystem.

**API Key Vault** (for cloud profiles):

```
.env.enc (AES-256-GCM encrypted)
├── ANTHROPIC_API_KEY → Claude Sonnet/Opus
├── OPENAI_API_KEY → GPT-4/Codex (dual-mode)
├── GOOGLE_API_KEY → Gemini (fallback)
└── Decryption: passphrase at boot OR hardware key
```

### 2.3 Boot Sequence

```
1. ruflo-appliance load ruflo.rvf
2. Verify RVFA magic bytes + footer SHA256
3. Extract KERNEL section → mount as rootfs
4. Extract RUNTIME section → /usr/local/bin/
5. Extract RUFLO section → /opt/ruflo/
6. Mount DATA section (read-write overlay)
7. Load MODELS section:
   - If ruvLLM: start inference server on unix socket
   - If API vault: decrypt keys, set env vars
   - If hybrid: start local + configure cloud fallback
8. Run VERIFY section → self-test all capabilities
9. Start MCP server (stdio or SSE based on config)
10. Ready for agent orchestration
```

### 2.4 Execution Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Run** | `ruflo-appliance run ruflo.rvf` | Boot and enter interactive CLI |
| **MCP** | `ruflo-appliance mcp ruflo.rvf` | Boot as MCP server (stdio) |
| **Verify** | `ruflo-appliance verify ruflo.rvf` | Run full capability test suite |
| **Extract** | `ruflo-appliance extract ruflo.rvf ./out/` | Unpack all sections |
| **Build** | `ruflo-appliance build --profile offline` | Create new appliance |
| **Update** | `ruflo-appliance update ruflo.rvf --section RUFLO` | Hot-patch one section |
| **Inspect** | `ruflo-appliance inspect ruflo.rvf` | Show header + section manifest |

### 2.5 Runtime Isolation

The appliance runs in one of three isolation levels:

| Level | Technology | Overhead | Security |
|-------|------------|----------|----------|
| **Container** | OCI/Docker (default) | ~50MB RAM | Namespace + cgroup isolation |
| **MicroVM** | Firecracker/Cloud Hypervisor | ~128MB RAM | Full VM isolation |
| **Native** | Direct execution (dev only) | ~30MB RAM | Process-level only |

Container mode (default):
```bash
# The .rvf file IS the container image
ruflo-appliance run ruflo.rvf
# Equivalent to:
# docker run --rm -it ruflo:self-contained
```

---

## 3. Capability Verification Suite

The appliance includes a built-in verification suite that tests **every capability** of Ruflo + Claude Flow. This runs automatically at boot (`Section 5: VERIFY`) and can be triggered manually.

### 3.1 Test Categories (25 Categories, 80+ Checks)

| # | Category | Critical Checks | What It Proves |
|---|----------|----------------|----------------|
| 1 | CLI Core | `--version`, `--help`, version match | Binary integrity |
| 2 | Doctor | 14 health checks, `--fix` | System diagnostics |
| 3 | Init System | settings.json, helpers, agent teams config | Project scaffolding |
| 4 | Memory Operations | store, list, search, retrieve, delete, TTL | AgentDB + RVF backend |
| 5 | Config Management | show, get, set, list | Configuration system |
| 6 | Session Management | start, status, end, list | Session persistence |
| 7 | Agent System | list, spawn, status, pool | Agent lifecycle |
| 8 | Swarm Coordination | init, status, topologies | Multi-agent orchestration |
| 9 | Task System | create, list, assign | Task management |
| 10 | Hooks System | list, route, pre-task, workers, statusline | Self-learning pipeline |
| 11 | Security | scan, audit, validate | Input validation, CVE checks |
| 12 | Performance | metrics, benchmark | Profiling |
| 13 | Neural/Intelligence | status, patterns | SONA + MoE |
| 14 | Embeddings | embed, search | Vector generation |
| 15 | Workflow System | list, templates | Workflow engine |
| 16 | Daemon | status, start | Background workers |
| 17 | Claims Authorization | list, check | RBAC |
| 18 | Migration | status | V2→V3 migration |
| 19 | Plugins | list | Plugin registry |
| 20 | MCP Server | help, list, stdio transport | MCP protocol |
| 21 | Completions | bash, zsh | Shell integration |
| 22 | Status | system status | Health monitoring |
| 23 | Hive-Mind | status | Byzantine consensus |
| 24 | Process Management | list | Background processes |
| 25 | Cross-Feature Integration | store→search→retrieve→delete cycle | End-to-end data flow |

### 3.2 Appliance-Specific Tests (Additional)

| # | Category | Checks | What It Proves |
|---|----------|--------|----------------|
| 26 | RVF Format | magic bytes, header parse, section integrity | Binary format correctness |
| 27 | ruvLLM Inference | model load, tokenize, generate, stream | Local LLM works offline |
| 28 | API Vault | decrypt, key validation, provider connectivity | Cloud API access |
| 29 | Boot Integrity | SHA256 verification, section checksums | Tamper detection |
| 30 | Isolation | namespace check, cgroup limits, filesystem | Security boundaries |
| 31 | Agent Swarm E2E | spawn 4 agents → coordinate → produce output | Full orchestration |
| 32 | MCP E2E | JSON-RPC init → tool call → response | Protocol compliance |
| 33 | Persistence | write data → reboot → verify data survives | RVF durability |
| 34 | Offline Mode | disconnect network → run full workflow | Air-gap capability |
| 35 | Hot Update | patch RUFLO section → verify new version | Live update |

### 3.3 Test Output Format

```
╔══════════════════════════════════════════════════════════╗
║  Ruflo Appliance v3.5.2 — Full Capability Verification  ║
║  Format: RVFA v1 | Profile: offline | Arch: x86_64      ║
║  Kernel: Alpine 3.23 | Node: 22.22.0 | ruvLLM: 0.1.0    ║
╚══════════════════════════════════════════════════════════╝

═══ 1. CLI Core ═══
  ✓ ruflo --version
  ✓ ruflo --help
  ✓ version is 3.5.2

═══ 2. Doctor ═══
  ✓ doctor runs (14/14 checks)
  ...

═══ 26. RVF Format ═══
  ✓ RVFA magic bytes valid
  ✓ header JSON parses correctly
  ✓ all 6 sections present
  ✓ section SHA256 checksums match
  ✓ footer hash matches computed hash

═══ 27. ruvLLM Inference ═══
  ✓ model loaded (Phi-3-mini-Q4, 2.3GB)
  ✓ tokenizer functional (32000 vocab)
  ✓ generation produces valid output
  ✓ streaming tokens arrive in <100ms
  ✓ KV-cache persists across calls

══════════════════════════════════════════════════
  RESULTS: 95/95 passed, 0 failed, 3 warnings
  ★ APPLIANCE FULLY VERIFIED
══════════════════════════════════════════════════
```

---

## 4. Build Pipeline

### 4.1 Build Command

```bash
# Build offline appliance (includes local models)
ruflo-appliance build \
  --profile offline \
  --arch x86_64 \
  --models "phi-3-mini-q4,qwen2.5-coder-3b-q4" \
  --output ruflo-offline.rvf

# Build cloud appliance (API keys only)
ruflo-appliance build \
  --profile cloud \
  --api-keys .env \
  --output ruflo-cloud.rvf

# Build hybrid appliance
ruflo-appliance build \
  --profile hybrid \
  --models "phi-3-mini-q4" \
  --api-keys .env \
  --output ruflo-hybrid.rvf
```

### 4.2 Build Stages

```
Stage 1: KERNEL
  ├── Pull alpine:3.23 rootfs
  ├── Install busybox, dumb-init
  ├── Strip to <5MB
  └── Compress with zstd -19

Stage 2: RUNTIME
  ├── Download Node.js 22 (linux-x64-musl)
  ├── Strip debug symbols, remove npm/corepack
  ├── Include Claude Code CLI binary
  └── Compress (~30MB → ~12MB)

Stage 3: RUFLO
  ├── npm pack ruflo@latest --omit=optional
  ├── Include all CLI commands + agent defs
  ├── Pre-configure MCP server
  └── Compress (~9MB → ~3MB)

Stage 4: MODELS (profile-dependent)
  ├── offline: Download GGUF models, build ruvLLM
  ├── hybrid: Download small model + encrypt keys
  └── cloud: Encrypt API keys only

Stage 5: DATA
  ├── Initialize AgentDB with RVF backend
  ├── Build HNSW indexes for default patterns
  ├── Snapshot pre-trained SONA weights
  └── Cache plugin registry

Stage 6: VERIFY
  ├── Bundle test script (sh, no dependencies)
  ├── Generate expected-results manifest
  └── Include checksum of all sections

Final: Assemble RVFA
  ├── Write magic + version + header
  ├── Append all sections with offsets
  ├── Compute and append footer SHA256
  └── Output: ruflo.rvf
```

### 4.3 Size Targets

| Profile | Sections | Compressed Size |
|---------|----------|-----------------|
| `cloud` | Kernel + Runtime + Ruflo + Data + Verify | ~60MB |
| `hybrid` | All + Phi-3-mini-Q4 | ~2GB |
| `offline` | All + Phi-3 + Qwen2.5-Coder-3B | ~4GB |

---

## 5. Architecture

### 5.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    ruflo.rvf (RVFA)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  KERNEL: Alpine Linux 3.23 (~5MB)                      │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  RUNTIME: Node.js 22 + Claude Code CLI           │  │  │
│  │  │  ┌──────────────────────────────────────────────┐│  │  │
│  │  │  │  RUFLO v3.5+                                 ││  │  │
│  │  │  │  ├── 26 CLI commands (140+ subcommands)      ││  │  │
│  │  │  │  ├── 60+ agent definitions                   ││  │  │
│  │  │  │  ├── 17 hooks + 12 workers                   ││  │  │
│  │  │  │  ├── MCP server (215 tools)                  ││  │  │
│  │  │  │  ├── AgentDB + HNSW (RVF backend)            ││  │  │
│  │  │  │  └── Security + Claims + Plugins             ││  │  │
│  │  │  └──────────────────────────────────────────────┘│  │  │
│  │  │  ┌──────────────────────────────────────────────┐│  │  │
│  │  │  │  MODELS                                      ││  │  │
│  │  │  │  ├── ruvLLM inference engine                  ││  │  │
│  │  │  │  ├── Local: Phi-3 / Qwen2.5-Coder (GGUF)    ││  │  │
│  │  │  │  └── Cloud: encrypted API key vault          ││  │  │
│  │  │  └──────────────────────────────────────────────┘│  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  DATA: AgentDB + SONA patterns + Plugin registry       │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  VERIFY: 95-check capability suite + checksums         │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
    │Container│         │MicroVM  │         │ Native  │
    │ (OCI)   │         │(Firecrk)│         │ (dev)   │
    └─────────┘         └─────────┘         └─────────┘
```

### 5.2 Model Routing Flow

```
User Task
    │
    ▼
┌─────────────────┐
│ Complexity Check │
│ (hooks route)   │
└────────┬────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
 Simple (<30%)              Complex (>30%)
    │                             │
    ▼                             ▼
┌──────────┐              ┌─────────────┐
│ Tier 1:  │              │ ruvLLM local?│
│ Agent    │              └──────┬──────┘
│ Booster  │                Yes  │  No
│ (WASM)   │                ┌────┴────┐
│ <1ms, $0 │                │         │
└──────────┘                ▼         ▼
                     ┌──────────┐ ┌──────────┐
                     │ Tier 2:  │ │ Tier 3:  │
                     │ Phi-3    │ │ Cloud API│
                     │ (local)  │ │ (Sonnet/ │
                     │ ~200ms   │ │  Opus)   │
                     │ $0       │ │ 2-5s     │
                     └──────────┘ └──────────┘
```

---

## 6. Security

### 6.1 Appliance Integrity

| Mechanism | Purpose |
|-----------|---------|
| RVFA footer SHA256 | Tamper detection for entire appliance |
| Per-section SHA256 | Integrity of individual sections |
| Code signing (Ed25519) | Verify publisher identity |
| API key vault (AES-256-GCM) | Protect cloud credentials |
| Read-only rootfs | Prevent runtime modification of system files |
| Namespace isolation | Container/VM boundary enforcement |
| Seccomp profile | Restrict syscalls to minimum required |

### 6.2 Key Management

```
Boot:
  1. User provides passphrase OR hardware key
  2. Derive AES key via Argon2id (memory-hard)
  3. Decrypt .env.enc → load API keys into memory
  4. Keys exist only in process memory (never on disk)
  5. On shutdown: zero memory, drop keys
```

### 6.3 Update Security

```
Hot Update Flow:
  1. Download signed patch (.rvfp)
  2. Verify Ed25519 signature against pinned public key
  3. Verify patch targets correct appliance version
  4. Apply patch to target section
  5. Recompute section SHA256 + footer hash
  6. Run VERIFY suite to confirm no regression
  7. Atomic swap (old → .bak, new → active)
```

---

## 7. Implementation Plan

### Phase 1: RVFA Format + Builder (Week 1-2)

| Task | Description |
|------|-------------|
| Define RVFA binary spec | Magic bytes, header schema, section table |
| `ruflo-appliance build` | Multi-stage builder with profile selection |
| `ruflo-appliance inspect` | Header + section manifest viewer |
| `ruflo-appliance extract` | Unpack all sections to directory |
| Cloud profile | Kernel + Runtime + Ruflo + encrypted keys |

### Phase 2: Runtime + Verification (Week 3-4)

| Task | Description |
|------|-------------|
| `ruflo-appliance run` | Boot sequence with container isolation |
| `ruflo-appliance verify` | 95-check capability suite |
| `ruflo-appliance mcp` | MCP server mode (stdio + SSE) |
| DATA section | Pre-built AgentDB + HNSW + SONA |
| CI integration | Build appliance on every release |

### Phase 3: ruvLLM Integration (Week 5-8)

| Task | Description |
|------|-------------|
| ruvLLM engine | GGUF model loader + KV-cache + streaming |
| Model routing | 3-tier routing (Booster → local → cloud) |
| Hybrid profile | Small local model + cloud fallback |
| Offline profile | Full local inference, no network |
| Offline verification | All 95 checks pass without network |

### Phase 4: Distribution + Updates (Week 9-10)

| Task | Description |
|------|-------------|
| `ruflo-appliance update` | Hot-patch individual sections |
| Ed25519 signing | Code signing for appliance + patches |
| IPFS distribution | Publish appliances to decentralized storage |
| MicroVM support | Firecracker/Cloud Hypervisor isolation |
| Documentation | User guide, API reference, examples |

---

## 8. Consequences

### Positive

- **Zero-install deployment**: One file, no Node.js/npm/Claude Code prerequisites
- **Offline-capable**: Full agent orchestration without internet (offline profile)
- **Reproducible**: Same binary = same behavior everywhere
- **Secure**: Encrypted keys, signed updates, container isolation
- **Fast boot**: <5s from cold start (vs 35s for `npx ruflo@latest`)
- **Verifiable**: Built-in 95-check suite proves every capability works
- **Updatable**: Hot-patch sections without rebuilding entire appliance

### Negative

- **Larger artifact**: 60MB-4GB depending on profile (vs ~9MB npm package)
- **Build complexity**: Multi-stage builder with cross-compilation
- **Model storage**: Local models consume significant disk (2-4GB per model)
- **Update latency**: Section-level patches still require verification pass

### Mitigations

- Cloud profile keeps size at ~60MB (comparable to a Docker image)
- Builder is automated and reproducible via CI
- Model quantization (Q4_K_M) reduces size while maintaining quality
- Verification suite runs in parallel (~10s for full 95-check pass)

---

## 9. Alternatives Considered

| Alternative | Reason Rejected |
|-------------|----------------|
| Docker image only | Requires Docker installed; no offline model support; not a single file |
| Flatpak/Snap | Linux-only packaging; no custom binary format; no model bundling |
| AppImage | Linux-only; no Windows/macOS; limited isolation |
| WebAssembly bundle | No filesystem access; can't run Claude Code CLI; no local models |
| Nix derivation | Requires Nix; steep learning curve; no model bundling |
| VM image (qcow2) | Too large; requires hypervisor; not portable |

RVFA provides the best balance of portability, size, isolation, and integration with the existing RVF ecosystem.

---

## 10. References

- ADR-057: RVF Native Storage Backend
- ADR-054: RVF-Powered Plugin Marketplace
- ADR-056: agentic-flow v3 Integration
- [llama.cpp GGUF format](https://github.com/ggerganov/llama.cpp)
- [Firecracker MicroVM](https://firecracker-microvm.github.io/)
- [OCI Image Spec](https://github.com/opencontainers/image-spec)
