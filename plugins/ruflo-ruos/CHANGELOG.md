# Changelog: ruflo-ruos

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.1.2 — 2026-10-29
- chore: operational skills are user-invoked only (`disable-model-invocation: true`) and long skill/command descriptions are cut to one sentence, so they cost less prompt on every turn (ADR-507, #4588). Every skill is still available as `/<skill>`.

## 0.1.1 — 2026-10-05
- feat: mod part — ruos status segment via $.ruflo.segment
- feat: JobTransport (exec-poll + ruOS jobs API), live-run fixes, ruOS design rules
- feat: README, local overhead benchmark, typecheck in smoke
- fix: jobs API 400 is non-retryable; cancelled (exit 143) is a stop
- fix: align JobsApiTransport with the live ADR-105 jobs API
- fix: echo-proof nonce markers, CI ratchet entries, ISO heartbeat
- fix: merge hosts.json, detect a killed runner, never skip bytes on a truncated poll
- chore: drop provably unused hasSecret/tidy, swarm PLUGIN_NAME, ruos parseProbe; fix guidance screen header

## 0.1.0 — 2026-10-01
- feat: commands, skill, agent, smoke contract, deploy-info, ADR-405
- feat: host adapter, audited command builder, fleet MCP + SSH transports
