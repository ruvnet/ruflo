# ADR-032: RVF Private Network MCP Tunnel

## Status
Implemented, then the build-time patch was removed (2026-11-10). The `sed` patterns no longer match the upstream image, so the script had become a silent no-op, and where it did match it relaxed the check for every URL, not only operator-configured ones. The ruvocal fork implements the same allowance in source (`isAllowedMcpUrl`, `allowPrivate` for `MCP_SERVERS` entries only).

## Context
HuggingFace Chat UI enforces HTTPS-only for MCP server URLs as SSRF protection (`urlSafety.isValidUrl()`). In containerized deployments (Docker Compose), the MCP bridge runs on a private Docker network (`http://mcp-bridge:3001/mcp`) — not exposed to the internet.

This creates a conflict: the security control blocks legitimate internal service communication.

## Decision
Use an **RVF-inspired private tunnel pattern** — patch the URL safety validation at build time to allow HTTP for admin-configured MCP_SERVERS on the private container network.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Private Docker Network                      │
│                                                                │
│  ┌──────────────┐   HTTP (private)   ┌──────────────────────┐ │
│  │  Chat UI     │──────────────────►│  MCP Bridge           │ │
│  │  :3000       │   MCP JSON-RPC    │  :3001                │ │
│  │              │                   │                       │ │
│  │  RVF Patch:  │   /chat/completions│  ├─ /mcp (tools)     │ │
│  │  Allow HTTP  │──────────────────►│  ├─ /models           │ │
│  │  for private │                   │  ├─ /chat/completions │ │
│  │  network     │                   │  └─ /health           │ │
│  └──────────────┘                   └──────────────────────┘ │
│         │                                     │               │
│         └──── Not exposed to internet ────────┘               │
└──────────────────────────────────────────────────────────────┘
         │
    Port 3000 (only this is exposed to host)
```

### RVF Segment Mapping

| RVF Segment | Application |
|-------------|-------------|
| **WASM_SEG (0x10)** | Lightweight query microkernel — MCP bridge acts as the runtime |
| **CRYPTO_SEG (0x0C)** | Request signing between kernel and bridge (optional) |
| **META_IDX_SEG (0x0D)** | Tool registry cache in bridge `/models` endpoint |
| **KERNEL_SEG (0x0E)** | Docker container as execution boundary |

### Security Model

1. **Private network only** — MCP bridge (`mcp-bridge:3001`) is only reachable within the Docker network, not from the internet
2. **Admin-configured** — `MCP_SERVERS` is set by the deployment operator in `docker-compose.yml`, not by end users
3. **IP safety preserved** — The patch relaxes protocol check (HTTP allowed) but retains all IP safety checks (no internal IP/loopback bypass for user URLs)
4. **Build-time patch** — Applied during Docker image build, not at runtime. Auditable in Dockerfile
5. **Cloud Run unaffected** — Cloud Run deployments use HTTPS URLs and don't need the patch

### Implementation

**`chat-ui/patch-mcp-url-safety.sh`**:
```sh
# Allow http: protocol for private network MCP
sed -i 's/url.protocol !== "https:"/url.protocol !== "https:" \&\& url.protocol !== "http:"/' "$URLSAFETY_FILE"

# Allow localhost for container-internal servers
sed -i 's/hostname === "localhost"/false \&\& hostname === "localhost"/' "$URLSAFETY_FILE"
```

**`chat-ui/Dockerfile`**:
```dockerfile
USER root
COPY patch-mcp-url-safety.sh /tmp/patch-mcp-url-safety.sh
RUN sh /tmp/patch-mcp-url-safety.sh && rm /tmp/patch-mcp-url-safety.sh
USER 1000
```

**`docker-compose.yml`**:
```yaml
chat-ui:
  environment:
    MCP_SERVERS: '[{"name":"Tools","url":"http://mcp-bridge:3001/mcp"}]'
```

## Alternatives Considered

1. **Caddy HTTPS sidecar** — Adds complexity (TLS certs, extra container). Rejected as over-engineered for internal comms.
2. **stdio MCP transport** — HF Chat UI doesn't support command-based MCP (only URL). Not feasible.
3. **Skip MCP, use tool-calling only** — Would lose MCP tool discovery and the tools sidebar in the UI.
4. **Fork HF Chat UI** — Maintenance burden. Build-time sed patch is simpler.

## Consequences

- MCP tools work in Docker Compose without HTTPS infrastructure
- Build-time patch must be updated if HF Chat UI changes `urlSafety` file naming
- Cloud Run deployments are unaffected (use real HTTPS URLs)
- Security posture: HTTP only allowed on private Docker network, not on public internet

## Verification

```
[MCP] Loaded 1 server(s): AI Assistant Tools
Listening on http://0.0.0.0:3000

Models: gemini-2.5-pro, gemini-2.5-flash, gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini, o3-mini, o1-mini
Bridge health: ok (3 tools: search, web_research, system_guide)
Chat completions: working via Gemini proxy
```
