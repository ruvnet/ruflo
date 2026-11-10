# Plugin footprint (after), 2026-10-29

Measured by `node scripts/measure-plugin-footprint.mjs` (ADR-507 §2.1) at `921a9ca33`.

The listing is what Claude Code keeps in context on every turn: the name and description of each skill, command and agent the model can invoke. A skill or command with `disable-model-invocation: true` stays runnable as `/<name>` but leaves that listing, so it is not counted. Tokens are estimated as characters ÷ 4.

## Totals

| | Count |
|---|---:|
| Skills | 161 (27 user-invoked only) |
| Commands | 62 (0 user-invoked only) |
| Agents | 65 |
| Listing characters | 39,402 (skills 22,640, commands 5,872, agents 10,890) |
| Estimated tokens per turn | 9,851 |
| Skill/command descriptions over 300 characters | 0 |

These totals assume every ruflo plugin is enabled at once; a session pays only for the plugins it enables.

## Per plugin

| Plugin | Skills (user-invoked) | Commands (user-invoked) | Agents | Listing chars | Est. tokens |
|---|---:|---:|---:|---:|---:|
| ruflo-ai-team | 6 (0) | 6 (0) | 4 | 3,015 | 754 |
| ruflo-neural-trader | 9 (0) | 1 (0) | 4 | 2,760 | 690 |
| ruflo-agent | 5 (0) | 2 (0) | 9 | 2,581 | 645 |
| ruflo-metaharness | 13 (6) | 1 (0) | 1 | 2,180 | 545 |
| ruflo-cost-tracker | 24 (14) | 1 (0) | 1 | 2,168 | 542 |
| ruflo-browser | 10 (0) | 1 (0) | 1 | 1,957 | 489 |
| ruflo-workflows | 5 (2) | 8 (0) | 3 | 1,738 | 435 |
| ruflo-goals | 5 (0) | 1 (0) | 4 | 1,570 | 393 |
| ruflo-core | 5 (2) | 2 (0) | 4 | 1,189 | 297 |
| ruflo-music | 7 (0) | 1 (0) | 2 | 1,103 | 276 |
| ruflo-ddd | 3 (0) | 1 (0) | 1 | 1,046 | 262 |
| ruflo-deepseek-harness | 2 (0) | 1 (0) | 1 | 1,027 | 257 |
| ruflo-iot-cognitum | 5 (0) | 1 (0) | 4 | 990 | 248 |
| ruflo-intelligence | 3 (0) | 2 (0) | 1 | 952 | 238 |
| ruflo-ruvector | 4 (1) | 1 (0) | 1 | 932 | 233 |
| ruflo-adr | 5 (0) | 1 (0) | 1 | 874 | 219 |
| ruflo-ruos | 1 (0) | 4 (0) | 1 | 836 | 209 |
| ruflo-sparc | 3 (0) | 1 (0) | 1 | 816 | 204 |
| ruflo-rure | 1 (0) | 1 (0) | 1 | 772 | 193 |
| ruflo-testgen | 3 (0) | 1 (0) | 1 | 716 | 179 |
| ruflo-ruvllm | 2 (0) | 1 (0) | 1 | 682 | 171 |
| ruflo-aidefence | 2 (0) | 1 (0) | 1 | 677 | 169 |
| ruflo-swarm | 2 (0) | 2 (0) | 2 | 672 | 168 |
| ruflo-agentdb | 2 (0) | 2 (0) | 1 | 638 | 160 |
| ruflo-security-audit | 2 (0) | 1 (0) | 1 | 608 | 152 |
| ruflo-plugin-creator | 3 (0) | 1 (0) | 1 | 607 | 152 |
| ruflo-rag-memory | 2 (0) | 2 (0) | 1 | 565 | 141 |
| ruflo-market-data | 2 (0) | 1 (0) | 1 | 562 | 141 |
| ruflo-jujutsu | 2 (0) | 1 (0) | 1 | 475 | 119 |
| ruflo-federation | 3 (1) | 1 (0) | 1 | 452 | 113 |
| ruflo-docs | 2 (0) | 1 (0) | 1 | 447 | 112 |
| ruflo-observability | 2 (0) | 1 (0) | 1 | 447 | 112 |
| ruflo-loop-workers | 2 (0) | 2 (0) | 1 | 435 | 109 |
| ruflo-autopilot | 2 (0) | 2 (0) | 1 | 429 | 107 |
| ruflo-migrations | 2 (0) | 1 (0) | 1 | 426 | 107 |
| ruflo-knowledge-graph | 2 (0) | 1 (0) | 1 | 390 | 98 |
| ruflo-daa | 2 (0) | 1 (0) | 1 | 385 | 96 |
| ruflo-rvf | 2 (0) | 1 (0) | 1 | 383 | 96 |
| ruflo-bbs-federation | 1 (0) | 0 (0) | 0 | 268 | 67 |
| ruflo-business-pods | 1 (0) | 0 (0) | 0 | 255 | 64 |
| ruflo-console | 1 (0) | 0 (0) | 0 | 247 | 62 |
| ruflo-arena | 0 (0) | 1 (0) | 0 | 130 | 33 |
| ruflo-agntcy | 1 (1) | 0 (0) | 0 | 0 | 0 |

## Descriptions over 300 characters

None.

## User-invoked only (`disable-model-invocation: true`)

| Plugin | Kind | Name |
|---|---|---|
| ruflo-agntcy | skill | agntcy-status |
| ruflo-core | skill | init-project |
| ruflo-core | skill | ruflo-status |
| ruflo-cost-tracker | skill | cost-anomaly |
| ruflo-cost-tracker | skill | cost-benchmark |
| ruflo-cost-tracker | skill | cost-burn |
| ruflo-cost-tracker | skill | cost-conversation |
| ruflo-cost-tracker | skill | cost-counterfactual |
| ruflo-cost-tracker | skill | cost-diff |
| ruflo-cost-tracker | skill | cost-export |
| ruflo-cost-tracker | skill | cost-federation |
| ruflo-cost-tracker | skill | cost-health |
| ruflo-cost-tracker | skill | cost-projection |
| ruflo-cost-tracker | skill | cost-report |
| ruflo-cost-tracker | skill | cost-session |
| ruflo-cost-tracker | skill | cost-summary |
| ruflo-cost-tracker | skill | cost-trend |
| ruflo-federation | skill | federation-init |
| ruflo-metaharness | skill | harness-bench |
| ruflo-metaharness | skill | harness-evolve |
| ruflo-metaharness | skill | harness-learn |
| ruflo-metaharness | skill | harness-mint |
| ruflo-metaharness | skill | harness-oia-audit |
| ruflo-metaharness | skill | harness-security-bench |
| ruflo-ruvector | skill | vector-setup |
| ruflo-workflows | skill | gaia-architecture-comparison |
| ruflo-workflows | skill | gaia-submission |

