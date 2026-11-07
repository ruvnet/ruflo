# Experimental agent summary control

This process-scoped launcher experiments with Claude Code's internal background agent progress summary timer. It is not an official Claude Code setting. It does not install or activate itself when the Ruflo mod loads. It needs the native Bun-compiled Claude Code binary; other installations may do nothing.

```
node plugins/ruflo-mods/agent-summary/run.cjs observe
node plugins/ruflo-mods/agent-summary/run.cjs suppress
```

Append Claude arguments after the mode. The launcher forwards existing `BUN_OPTIONS`, requires a preload path without spaces, and modifies only the child environment. Do not delete the preload while a running process still needs it. To roll back, start Claude normally. Existing daemons or prewarmed workers may retain their original environment; changing that requires a deliberate daemon restart, which can interrupt work. This launcher never stops the daemon.

Set `RUFLO_AGENT_SUMMARY_LOG` to a private local file to capture activation and matched timer events as JSON lines. Logs contain timestamps, mode and process IDs, not prompts. `preload_active` proves loading, not that suppression worked. Zero matches can mean the timer never ran, ran in a different process, or Claude changed. Compare identical background-agent workloads in observe and suppress modes and inspect per-request OpenTelemetry `query_source` and costs. A positive observe baseline and zero summary requests in suppress are required; check agent completion and any compaction behavior as well. Counts are not token or dollar savings. Logs are best effort and should not be treated as proof that every process was instrumented.

The wrapper matches internal callback source text, which can change without notice. Only the known global timer is intercepted; unrelated timers pass through. Progress labels may become stale, and summary text can potentially reappear in compaction, so verify task quality. Do not use this as a budget or security control. No blanket savings claim is made. Supported operating systems, versions and live savings must be verified separately. Attribution and original approach: [Flamerix AI](https://gist.github.com/flamerix-ai/c3905705cc4205e5de3011fa2e74efce), MIT license in LICENSE.flamerix.

Tests: `node --test plugins/ruflo-mods/agent-summary/preload.test.cjs`.
