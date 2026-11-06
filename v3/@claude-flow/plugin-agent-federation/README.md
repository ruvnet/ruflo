# @claude-flow/plugin-agent-federation

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-agent-federation.svg)](https://www.npmjs.com/package/@claude-flow/plugin-agent-federation)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-agent-federation.svg)](https://www.npmjs.com/package/@claude-flow/plugin-agent-federation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Cross-installation agent federation with zero-trust security, PII-gated data flow, and compliance-grade audit trails.

## Install + run

```bash
npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation --help
```

## Subcommands

| Command | Description |
|---|---|
| `ruflo-federation init` | Initialize federation on this node (generates keypair) |
| `ruflo-federation join <peer-url>` | Join a federation by connecting to a peer |
| `ruflo-federation leave` | Leave the current federation |
| `ruflo-federation peers` | List known peers and their trust levels |
| `ruflo-federation peers add <node-id>` | Add a peer to the federation |
| `ruflo-federation peers remove <node-id>` | Remove a peer |
| `ruflo-federation status` | Show federation health, sessions, trust levels |
| `ruflo-federation audit` | Query compliance-grade audit logs |
| `ruflo-federation trust` | Manage trust scores and tiers |
| `ruflo-federation config` | Show/update federation config |

## Configuration via `.env`

```bash
FEDERATION_NODE_NAME=my-node           # default: hostname
FEDERATION_BIND_HOST=127.0.0.1         # default: 127.0.0.1 (0.0.0.0 accepts other hosts)
FEDERATION_BIND_PORT=8443              # default: 8443
FEDERATION_TRUST_LEVEL=untrusted       # default: untrusted
```

## Tests

JCS-signed inbound envelopes must target this node, agree with their signed
ID/type/source/session metadata, and be no older than five minutes or more than
30 seconds in the future. A replay guard is shared by the plugin's inbound
callbacks. It retains IDs until the signed timestamp expires, with limits of
1,024 IDs per peer, 256 peers, 8,192 IDs total and 256 characters per ID.
Capacity exhaustion rejects new messages instead of evicting live replay history.

Replay history is in memory for one plugin lifecycle; restarting the plugin
clears it. This is not durable or cross-replica deduplication. The existing
legacy-v1 heartbeat/status compatibility path cannot authenticate nested envelope
fields and does not acquire JCS replay guarantees. Signature and policy checks
still run before a JCS message can reserve an ID or reach the event bus.

325 unit tests covering audit, routing, discovery, plugin lifecycle.

```bash
npm test
```

## License

MIT — Claude Flow Team.
