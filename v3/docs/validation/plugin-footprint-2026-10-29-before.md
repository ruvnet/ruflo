# Plugin footprint (before), 2026-10-29

Measured by `node scripts/measure-plugin-footprint.mjs` (ADR-507 §2.1) at `00c0f743f`.

The listing is what Claude Code keeps in context on every turn: the name and description of each skill, command and agent the model can invoke. A skill or command with `disable-model-invocation: true` stays runnable as `/<name>` but leaves that listing, so it is not counted. Tokens are estimated as characters ÷ 4.

## Totals

| | Count |
|---|---:|
| Skills | 161 (0 user-invoked only) |
| Commands | 62 (0 user-invoked only) |
| Agents | 65 |
| Listing characters | 47,743 (skills 30,981, commands 5,872, agents 10,890) |
| Estimated tokens per turn | 11,936 |
| Skill/command descriptions over 300 characters | 20 |

These totals assume every ruflo plugin is enabled at once; a session pays only for the plugins it enables.

## Per plugin

| Plugin | Skills (user-invoked) | Commands (user-invoked) | Agents | Listing chars | Est. tokens |
|---|---:|---:|---:|---:|---:|
| ruflo-cost-tracker | 24 (0) | 1 (0) | 1 | 5,084 | 1,271 |
| ruflo-metaharness | 13 (0) | 1 (0) | 1 | 5,021 | 1,255 |
| ruflo-ai-team | 6 (0) | 6 (0) | 4 | 3,015 | 754 |
| ruflo-neural-trader | 9 (0) | 1 (0) | 4 | 2,760 | 690 |
| ruflo-agent | 5 (0) | 2 (0) | 9 | 2,581 | 645 |
| ruflo-workflows | 5 (0) | 8 (0) | 3 | 2,019 | 505 |
| ruflo-browser | 10 (0) | 1 (0) | 1 | 1,957 | 489 |
| ruflo-core | 5 (0) | 2 (0) | 4 | 1,621 | 405 |
| ruflo-goals | 5 (0) | 1 (0) | 4 | 1,570 | 393 |
| ruflo-deepseek-harness | 2 (0) | 1 (0) | 1 | 1,385 | 346 |
| ruflo-music | 7 (0) | 1 (0) | 2 | 1,103 | 276 |
| ruflo-ruvector | 4 (0) | 1 (0) | 1 | 1,078 | 270 |
| ruflo-ddd | 3 (0) | 1 (0) | 1 | 1,046 | 262 |
| ruflo-iot-cognitum | 5 (0) | 1 (0) | 4 | 990 | 248 |
| ruflo-intelligence | 3 (0) | 2 (0) | 1 | 952 | 238 |
| ruflo-ruos | 1 (0) | 4 (0) | 1 | 906 | 227 |
| ruflo-rure | 1 (0) | 1 (0) | 1 | 903 | 226 |
| ruflo-adr | 5 (0) | 1 (0) | 1 | 874 | 219 |
| ruflo-testgen | 3 (0) | 1 (0) | 1 | 864 | 216 |
| ruflo-sparc | 3 (0) | 1 (0) | 1 | 816 | 204 |
| ruflo-plugin-creator | 3 (0) | 1 (0) | 1 | 742 | 186 |
| ruflo-ruvllm | 2 (0) | 1 (0) | 1 | 682 | 171 |
| ruflo-aidefence | 2 (0) | 1 (0) | 1 | 677 | 169 |
| ruflo-swarm | 2 (0) | 2 (0) | 2 | 672 | 168 |
| ruflo-agentdb | 2 (0) | 2 (0) | 1 | 638 | 160 |
| ruflo-security-audit | 2 (0) | 1 (0) | 1 | 608 | 152 |
| ruflo-business-pods | 1 (0) | 0 (0) | 0 | 581 | 145 |
| ruflo-rag-memory | 2 (0) | 2 (0) | 1 | 565 | 141 |
| ruflo-market-data | 2 (0) | 1 (0) | 1 | 562 | 141 |
| ruflo-federation | 3 (0) | 1 (0) | 1 | 540 | 135 |
| ruflo-jujutsu | 2 (0) | 1 (0) | 1 | 475 | 119 |
| ruflo-docs | 2 (0) | 1 (0) | 1 | 447 | 112 |
| ruflo-observability | 2 (0) | 1 (0) | 1 | 447 | 112 |
| ruflo-loop-workers | 2 (0) | 2 (0) | 1 | 435 | 109 |
| ruflo-autopilot | 2 (0) | 2 (0) | 1 | 429 | 107 |
| ruflo-migrations | 2 (0) | 1 (0) | 1 | 426 | 107 |
| ruflo-knowledge-graph | 2 (0) | 1 (0) | 1 | 390 | 98 |
| ruflo-daa | 2 (0) | 1 (0) | 1 | 385 | 96 |
| ruflo-rvf | 2 (0) | 1 (0) | 1 | 383 | 96 |
| ruflo-agntcy | 1 (0) | 0 (0) | 0 | 376 | 94 |
| ruflo-bbs-federation | 1 (0) | 0 (0) | 0 | 361 | 90 |
| ruflo-console | 1 (0) | 0 (0) | 0 | 247 | 62 |
| ruflo-arena | 0 (0) | 1 (0) | 0 | 130 | 33 |

## Descriptions over 300 characters

| Plugin | Kind | Name | Characters |
|---|---|---|---:|
| ruflo-business-pods | skill | pod-sales | 572 |
| ruflo-metaharness | skill | harness-gepa | 461 |
| ruflo-metaharness | skill | harness-security-bench | 460 |
| ruflo-deepseek-harness | skill | deepseek-reason | 457 |
| ruflo-metaharness | skill | harness-evolve | 441 |
| ruflo-rure | skill | analyze-app | 408 |
| ruflo-deepseek-harness | skill | deepseek-chat | 407 |
| ruflo-metaharness | skill | harness-learn | 406 |
| ruflo-metaharness | skill | harness-similarity | 400 |
| ruflo-metaharness | skill | harness-bench | 395 |
| ruflo-testgen | skill | tdd-repair | 389 |
| ruflo-agntcy | skill | agntcy-status | 363 |
| ruflo-plugin-creator | skill | create-mod | 350 |
| ruflo-metaharness | skill | harness-drift-from-history | 343 |
| ruflo-bbs-federation | skill | cross-host-federation | 340 |
| ruflo-cost-tracker | skill | cost-anomaly | 318 |
| ruflo-metaharness | skill | harness-score | 311 |
| ruflo-metaharness | skill | harness-mint | 310 |
| ruflo-core | skill | witness | 306 |
| ruflo-ruos | skill | ruos-host-run | 306 |

## User-invoked only (`disable-model-invocation: true`)

None.

