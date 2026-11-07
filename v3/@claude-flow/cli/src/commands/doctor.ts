/**
 * V3 CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { checkNativeAddonHeaders } from './doctor-native-addon.js';
import { checkProjectAutoApproveSettings } from './doctor-auto-approve.js';
import { recordMemoryPackagePath } from '../init/memory-package-resolver.js';
import {
  checkConfigFile,
  checkStaleSettingsNpx,
  checkHelperIntegrity,
  checkDaemonStatus,
} from './doctor-checks/config.js';
import {
  checkNodeVersion,
  checkNpmVersion,
  checkAgentBrowserVersion,
  checkApiKeys,
  checkGit,
  checkGitRepo,
  checkDiskSpace,
  checkBuildTools,
  checkVersionFreshness,
  checkClaudeCode,
  installClaudeCode,
} from './doctor-checks/environment.js';
import {
  checkAIDefence,
  checkFederationBreaker,
  checkMods,
  checkHeadlessPlugins,
  checkLearningLoop,
  checkCompactSnapshots,
  checkTypesafeRouter,
  checkAgenticFlow,
  checkEncryptionAtRest,
} from './doctor-checks/integrations.js';
import { checkMcpServers, checkMcpSchemaOverhead } from './doctor-checks/mcp.js';
import {
  checkMemoryIntegrity,
  checkMemoryContent,
  checkMemoryEmbeddingCoverage,
  checkMemoryReflexionCoverage,
  checkMemoryCritiqueCoverage,
} from './doctor-checks/memory-content.js';
import {
  checkMemoryPersistenceDriver,
  checkLearningBridge,
  checkMemoryPackageVersion,
} from './doctor-checks/memory-runtime.js';
import {
  checkMemoryDatabase,
  existingNativeAgentDbPaths,
  checkMemoryStructuralIntegrity,
  checkNativeAgentDbStructuralIntegrity,
} from './doctor-checks/memory-store.js';
import {
  checkMetaharnessIntegration,
  checkMetaharnessDeclaredPackages,
  checkMetaharness,
} from './doctor-checks/metaharness.js';
import {
  checkFunnel,
  checkProxySponsoredConsent,
  checkProxyBinary,
  checkProxyProcess,
  checkProxyBindAddress,
  checkAuth,
} from './doctor-checks/proxy.js';
import type { HealthCheck } from './doctor-checks/shared.js';

// The checks live in ./doctor-checks/ (#4773); these re-exports keep this
// module's public exports as they were.
export {
  evaluateAgentBrowserVersion,
  checkAgentBrowserVersion,
} from './doctor-checks/environment.js';
export { checkHelperIntegrity } from './doctor-checks/config.js';
export {
  checkMemoryPersistenceDriver,
  evaluateMemoryPackageVersion,
  checkMemoryPackageVersion,
} from './doctor-checks/memory-runtime.js';
export type { MemoryPersistenceDriverDeps } from './doctor-checks/memory-runtime.js';

// Format health check result
function formatCheck(check: HealthCheck): string {
  const icon = check.status === 'pass' ? output.success('✓') :
               check.status === 'warn' ? output.warning('⚠') :
               output.error('✗');
  return `${icon} ${check.name}: ${check.message}`;
}

// Main doctor command
export const doctorCommand: Command = {
  name: 'doctor',
  description: 'System diagnostics and health checks',
  options: [
    {
      name: 'json',
      description: 'Emit versioned JSON health checks (cannot be combined with repair flags)',
      type: 'boolean',
      default: false
    },
    {
      name: 'fix',
      short: 'f',
      // #1791.5 — flag name was misleading: it does NOT auto-apply fixes,
      // it only prints the suggested commands so the user can run them
      // themselves. Make that explicit in the help output.
      description: 'Print suggested fix commands (does not auto-apply — copy/paste them yourself)',
      type: 'boolean',
      default: false
    },
    {
      name: 'install',
      short: 'i',
      description: 'Auto-install missing dependencies (Claude Code CLI)',
      type: 'boolean',
      default: false
    },
    {
      name: 'component',
      short: 'c',
      description: 'Check specific component (version, node, npm, config, daemon, memory, api, git, mcp, mcp-overhead, claude, browser, disk, typescript, agentic-flow, encryption, federation, funnel, proxy, auth, typesafe, mods, headless-plugins, metaharness)',
      type: 'string'
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Verbose output',
      type: 'boolean',
      default: false
    },
    {
      name: 'fix-handles',
      // Windows-only mitigation for anthropics/claude-code#67888 — Claude Code's
      // Bash tool spawns cmd.exe/bash.exe without cleaning up child conhost.exe
      // handles, so a long session accumulates dozens (observed live: 26+
      // orphaned conhost.exe after a ~4h session). Each holds a kernel object
      // + ~1MB, and combined with memory pressure this measurably slows the
      // machine. This flag kills orphan conhost.exe (safe — Windows respawns
      // on demand). Deliberately does NOT touch cmd.exe/bash.exe — those can
      // be the invoking shell, and killing them 255's the caller.
      description: 'Windows only: kill orphaned conhost.exe processes leaked by Claude Code (mitigation for anthropics/claude-code#67888)',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow doctor --json -c node', description: 'Emit machine-readable health checks' },
    { command: 'claude-flow doctor', description: 'Run full health check' },
    { command: 'claude-flow doctor --fix', description: 'Print suggested fix commands (does not auto-apply)' },
    { command: 'claude-flow doctor --install', description: 'Auto-install missing dependencies' },
    { command: 'claude-flow doctor -c version', description: 'Check for stale npx cache' },
    { command: 'claude-flow doctor -c claude', description: 'Check Claude Code CLI only' },
    { command: 'claude-flow doctor --fix-handles', description: 'Windows: kill leaked conhost.exe from Claude Code sessions' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showFix = ctx.flags.fix as boolean;
    const autoInstall = ctx.flags.install as boolean;
    const component = ctx.flags.component as string;
    const verbose = ctx.flags.verbose as boolean;
    // Parser camelCases kebab-case flag names — read via `fixHandles`, not `['fix-handles']`.
    const fixHandles = ctx.flags.fixHandles as boolean;
    const json = ctx.flags.json as boolean;
    const reportError = (message: string): CommandResult => {
      if (json) output.writeln(JSON.stringify({ schemaVersion: 1, checks: [], error: message }));
      else output.printError(message);
      return { success: false, exitCode: 1, message };
    };
    if (json && (showFix || autoInstall || fixHandles)) {
      return reportError('--json cannot be combined with --fix, --install, or --fix-handles');
    }

    // Reuse the same callable for anonymous checks so their IDs do not depend
    // on display names or on whether the full or component suite was selected.
    const helperCheck = () => checkHelperIntegrity();
    const nativeAddonCheck = () => checkNativeAddonHeaders();

    // #2677: `--component memory` now runs the whole memory-health suite,
    // not just the existence check. Values can be a single check or an
    // array — expanded at execution time. Stuinfla's report showed the
    // existence-only check reporting PASS on a 99.97%-empty and even a
    // SQLite-malformed DB; the array here layers integrity → content →
    // embedding coverage over the existing existence probe; check 6 then
    // verifies that distilled episodes are actually Reflexion-retrievable and
    // execution feedback carries a lesson.
    const componentMap: Record<string, (() => Promise<HealthCheck>) | Array<() => Promise<HealthCheck>>> = {
      'version': checkVersionFreshness,
      'freshness': checkVersionFreshness,
      'node': checkNodeVersion,
      'npm': checkNpmVersion,
      'claude': checkClaudeCode,
      'browser': checkAgentBrowserVersion,
      'config': checkConfigFile,
      'stale-settings': checkStaleSettingsNpx, // #2448
      'auto-approve': () => checkProjectAutoApproveSettings(), // ADR-509
      'helpers': helperCheck, // #3565
      'daemon': checkDaemonStatus,
      get memory() { return [
        checkMemoryDatabase,         // existing: exists + statable (unchanged)
        checkMemoryIntegrity,        // #2677 check 1: sql.js open + PRAGMA integrity_check
        ...nativeAgentDbChecks,       // #3195: present AgentDB authority, checked independently
        checkMemoryPersistenceDriver, // #2968/#3321: read-only native capability probe
        checkMemoryPackageVersion,   // #3392: loaded memory package satisfies the declared range
        checkMemoryContent,          // #2677 check 2: memory_entries content coverage
        checkMemoryEmbeddingCoverage, // #2677 check 3: vector coverage on populated rows
        checkMemoryReflexionCoverage, // #2677 check 6: episodes are retrievable
        checkMemoryCritiqueCoverage,  // #2677 check 6: feedback carries lessons
      ]; },
      'memory-package': checkMemoryPackageVersion, // #3392
      'native-addon': nativeAddonCheck, // #4055
      'learning': checkLearningBridge, // #2545
      'learning-bridge': checkLearningBridge, // #2545
      'api': checkApiKeys,
      'git': checkGit,
      'mcp': checkMcpServers,
      'mcp-overhead': checkMcpSchemaOverhead,
      'aidefence': checkAIDefence, // #1807
      'disk': checkDiskSpace,
      'typescript': checkBuildTools,
      'agentic-flow': checkAgenticFlow,
      'encryption': checkEncryptionAtRest, // ADR-096 Phase 5
      'federation': checkFederationBreaker, // ADR-097 Phase 4
      'metaharness': [checkMetaharness, checkMetaharnessDeclaredPackages, checkMetaharnessIntegration], // ADR-150 — upstream + declared deps + ruflo-side
      'metaharness-integration': checkMetaharnessIntegration, // iter 45 — ruflo-side
      'funnel': checkFunnel, // ADR-305
      // ADR-307 — deep-dive array, same pattern as 'memory' above: the cheap
      // sponsored-consent check first, then binary/process/bind in the order
      // a user would actually debug them (is it installed? running? exposed?).
      'proxy': [checkProxySponsoredConsent, checkProxyBinary, checkProxyProcess, checkProxyBindAddress],
      'auth': checkAuth, // ADR-306
      'typesafe': checkTypesafeRouter, // opt-in @ruvector/typesafe task router
      'mods': checkMods, // ADR-404 — ruflo as a Claude Code mod
      'learning-loop': checkLearningLoop, // #4581 — verified-outcome learning loop
      'compact-snapshots': checkCompactSnapshots, // ADR-505 — snapshots must be gitignored
      'headless-plugins': checkHeadlessPlugins, // ADR-510 — mods under claude -p (spawns claude; not in bare doctor)
    };

    if (component !== undefined && !Object.hasOwn(componentMap, component)) {
      const message = `Unknown doctor component: ${JSON.stringify(component)}. Valid components: ${Object.keys(componentMap).join(', ')}`;
      return reportError(message);
    }

    // Early-return short-circuit: `--fix-handles` is a targeted mitigation, not
    // part of the health-check flow. Runs, reports, exits.
    if (fixHandles) {
      output.writeln();
      output.writeln(output.bold('RuFlo Doctor — fix-handles'));
      output.writeln(output.dim('─'.repeat(50)));
      output.writeln();

      if (process.platform !== 'win32') {
        output.printInfo('--fix-handles is a Windows-only mitigation. On this platform (' + process.platform + '), no action taken.');
        return { success: true };
      }

      const { spawnSync } = await import('child_process');
      // PowerShell one-liner: read before-count, kill conhost, read after-count, report delta.
      const psScript = [
        "$before = (Get-Process conhost -EA SilentlyContinue).Count",
        "$mem_before = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)",
        "$killed = 0",
        "Get-Process conhost -EA SilentlyContinue | ForEach-Object {",
        "  try { Stop-Process -Id $_.Id -Force -EA Stop; $killed++ } catch {}",
        "}",
        "Start-Sleep -Seconds 1",
        "$after = (Get-Process conhost -EA SilentlyContinue).Count",
        "$mem_after = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)",
        "Write-Output ('BEFORE_COUNT=' + $before)",
        "Write-Output ('KILLED=' + $killed)",
        "Write-Output ('AFTER_COUNT=' + $after)",
        "Write-Output ('MEM_BEFORE_GB=' + $mem_before)",
        "Write-Output ('MEM_AFTER_GB=' + $mem_after)",
      ].join('; ');

      const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
        encoding: 'utf-8', timeout: 30000, windowsHide: true,
      });

      if (res.status !== 0) {
        output.printError('PowerShell exited with code ' + res.status);
        if (res.stderr) output.writeln(output.dim(res.stderr));
        return { success: false, exitCode: 1 };
      }

      const parse = (key: string): string => {
        const line = (res.stdout || '').split('\n').find((l) => l.startsWith(key + '='));
        return line ? line.slice(key.length + 1).trim() : '?';
      };
      const before = parse('BEFORE_COUNT');
      const killed = parse('KILLED');
      const after = parse('AFTER_COUNT');
      const memBefore = parse('MEM_BEFORE_GB');
      const memAfter = parse('MEM_AFTER_GB');

      output.writeln('conhost.exe processes:');
      output.writeln('  before:  ' + before);
      output.writeln('  killed:  ' + output.success(killed));
      output.writeln('  after:   ' + after);
      output.writeln('');
      output.writeln('Free RAM:');
      output.writeln('  before:  ' + memBefore + ' GB');
      output.writeln('  after:   ' + memAfter + ' GB');
      output.writeln('');
      output.writeln(output.dim('Note: does NOT touch cmd.exe/bash.exe/node.exe — those may be the invoking shell'));
      output.writeln(output.dim('      or an active MCP server. Kill them manually if you need to.'));
      output.writeln('');
      output.writeln(output.dim('Upstream tracking: https://github.com/anthropics/claude-code/issues/67888'));
      return { success: true };
    }

    if (!json) {
      output.writeln();
      output.writeln(output.bold('RuFlo Doctor'));
      output.writeln(output.dim('System diagnostics and health check'));
      output.writeln(output.dim('─'.repeat(50)));
      output.writeln();
    }

    const nativeAgentDbPaths = await existingNativeAgentDbPaths();
    const nativeAgentDbChecks = nativeAgentDbPaths
      .map((dbPath) => () => checkNativeAgentDbStructuralIntegrity(dbPath));

    const allChecks: (() => Promise<HealthCheck>)[] = [
      checkVersionFreshness,
      checkNodeVersion,
      checkNpmVersion,
      checkClaudeCode,
      checkAgentBrowserVersion, // ADR-122 Phase 0 — browser runtime compatibility
      checkGit,
      checkGitRepo,
      checkConfigFile,
      checkStaleSettingsNpx, // #2448/#2677 — runaway `npx @latest` in settings
      () => checkProjectAutoApproveSettings(), // ADR-509 — project auto-approve keys
      helperCheck, // #3565 — installed signed helpers vs manifest
      checkDaemonStatus,
      checkMemoryDatabase,
      checkMemoryStructuralIntegrity, // #2737 — bounded, native quick_check on every default run
      ...nativeAgentDbChecks, // #3195 — verify each present native authority file
      checkMemoryPersistenceDriver, // #2968/#3321 — read-only native capability probe
      checkLearningBridge, // #2545 — can the auto-memory hook actually load @claude-flow/memory?
      checkMemoryPackageVersion, // #3392 — loaded @claude-flow/memory must satisfy the CLI's declared range
      nativeAddonCheck, // #4055 — better-sqlite3 built against Node 24.19+ headers on 24.19-24.21
      checkApiKeys,
      checkMcpServers,
      checkMcpSchemaOverhead, // #2726 — fixed tools/list prompt cost
      checkAIDefence, // #1807
      checkDiskSpace,
      checkBuildTools,
      checkAgenticFlow,
      checkEncryptionAtRest, // ADR-096 Phase 5
      checkFederationBreaker, // ADR-097 Phase 4
      checkMetaharness, // ADR-150 — MetaHarness upstream package
      checkMetaharnessDeclaredPackages, // dependency contract — declared optional deps must resolve
      checkMetaharnessIntegration, // iter 45 — ruflo-side integration layer
      checkFunnel, // ADR-305 — effective funnel state + deciding precedence source
      checkProxySponsoredConsent, // ADR-313 — Meta LLM Proxy sponsored-downtime health
      checkAuth, // ADR-306 — Cognitum identity (warn-only; never fails bare `ruflo doctor`)
      checkMods, // ADR-404 — Claude Code mod path (warn-only)
      checkLearningLoop, // #4581 — verified outcomes reach SONA (warn-only)
      checkCompactSnapshots, // ADR-505 — compaction snapshots gitignored (warn-only)
    ];

    let checksToRun = allChecks;
    if (component !== undefined) {
      const entry = componentMap[component];
      checksToRun = Array.isArray(entry) ? entry : [entry];
    }

    // These are API identifiers: keep them stable even when user-facing names
    // change. Grouped components have a distinct ID for each individual check.
    const checkIds = new Map<() => Promise<HealthCheck>, string>([
      [checkVersionFreshness, 'version'], [checkNodeVersion, 'node'],
      [checkNpmVersion, 'npm'], [checkClaudeCode, 'claude'],
      [checkAgentBrowserVersion, 'browser'], [checkGit, 'git'],
      [checkGitRepo, 'git-repo'], [checkConfigFile, 'config'],
      [checkStaleSettingsNpx, 'stale-settings'], [() => checkProjectAutoApproveSettings(), 'auto-approve'], [helperCheck, 'helpers'],
      [checkDaemonStatus, 'daemon'], [checkMemoryDatabase, 'memory-presence'],
      [checkMemoryStructuralIntegrity, 'memory-structural'],
      [checkMemoryIntegrity, 'memory-integrity'],
      [checkMemoryPersistenceDriver, 'memory-driver'],
      [checkMemoryPackageVersion, 'memory-package'],
      [checkMemoryContent, 'memory-content'],
      [checkMemoryEmbeddingCoverage, 'memory-embeddings'],
      [checkMemoryReflexionCoverage, 'memory-reflexion'],
      [checkMemoryCritiqueCoverage, 'memory-critique'],
      [checkLearningBridge, 'learning'], [nativeAddonCheck, 'native-addon'],
      [checkApiKeys, 'api'], [checkMcpServers, 'mcp'],
      [checkMcpSchemaOverhead, 'mcp-overhead'], [checkAIDefence, 'aidefence'],
      [checkDiskSpace, 'disk'], [checkBuildTools, 'typescript'],
      [checkAgenticFlow, 'agentic-flow'], [checkEncryptionAtRest, 'encryption'],
      [checkFederationBreaker, 'federation'], [checkMetaharness, 'metaharness'],
      [checkMetaharnessDeclaredPackages, 'metaharness-packages'],
      [checkMetaharnessIntegration, 'metaharness-integration'],
      [checkFunnel, 'funnel'], [checkProxySponsoredConsent, 'proxy-consent'],
      [checkProxyBinary, 'proxy-binary'], [checkProxyProcess, 'proxy-process'],
      [checkProxyBindAddress, 'proxy-bind'], [checkAuth, 'auth'],
      [checkTypesafeRouter, 'typesafe'], [checkMods, 'mods'],
      [checkLearningLoop, 'learning-loop'], [checkHeadlessPlugins, 'headless-plugins'],
      [checkCompactSnapshots, 'compact-snapshots'],
    ]);
    nativeAgentDbChecks.forEach((check, index) => {
      // The path distinguishes simultaneous authority files; normalize separators.
      checkIds.set(check, `memory-native:${nativeAgentDbPaths[index].replace(/\\/g, '/')}`);
    });
    if (json && checksToRun.some(check => !checkIds.has(check))) {
      return reportError('Doctor check is missing a stable JSON ID');
    }

    const results: HealthCheck[] = [];
    const fixes: string[] = [];

    // OPTIMIZATION: Run all checks in parallel for 3-5x faster execution
    const spinner = json ? undefined : output.createSpinner({ text: 'Running health checks in parallel...', spinner: 'dots' });
    spinner?.start();

    try {
      // Execute all checks concurrently
      const checkResults = await Promise.allSettled(checksToRun.map(check => check()));
      spinner?.stop();

      // Process results in order
      for (const settledResult of checkResults) {
        if (settledResult.status === 'fulfilled') {
          const result = settledResult.value;
          results.push(result);
          if (!json) output.writeln(formatCheck(result));

          if (result.fix && (result.status === 'fail' || result.status === 'warn')) {
            fixes.push(`${result.name}: ${result.fix}`);
          }
        } else {
          const errorResult: HealthCheck = {
            name: 'Check',
            status: 'fail',
            message: settledResult.reason?.message || 'Unknown error'
          };
          results.push(errorResult);
          if (!json) output.writeln(formatCheck(errorResult));
        }
      }
    } catch (error) {
      spinner?.stop();
      if (json) return reportError(`Failed to run health checks: ${error instanceof Error ? error.message : String(error)}`);
      output.writeln(output.error('Failed to run health checks'));
    }

    // #2545: --fix / --install can actually repair the Learning Bridge by
    // recording the resolver sidecar. When doctor runs via `npx ruflo`, the CLI
    // CAN resolve its optional @claude-flow/memory dep (it is in the same npx
    // cache), so writing the sidecar makes the SessionStart hook find it.
    if ((showFix || autoInstall)) {
      const lbResult = results.find(r => r.name === 'Learning Bridge');
      if (lbResult && lbResult.status === 'fail') {
        const record = recordMemoryPackagePath(process.cwd(), 'doctor');
        if (record) {
          const newCheck = await checkLearningBridge();
          const idx = results.findIndex(r => r.name === 'Learning Bridge');
          if (idx !== -1) results[idx] = newCheck;
          const fixIdx = fixes.findIndex(f => f.startsWith('Learning Bridge:'));
          if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          output.writeln(output.success(`Repaired Learning Bridge — wrote .claude-flow/memory-package.json → ${record.distPath}`));
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    // Auto-install missing dependencies if requested
    if (autoInstall) {
      const claudeCodeResult = results.find(r => r.name === 'Claude Code CLI');
      if (claudeCodeResult && claudeCodeResult.status !== 'pass') {
        const installed = await installClaudeCode();
        if (installed) {
          // Re-check Claude Code after installation
          const newCheck = await checkClaudeCode();
          const idx = results.findIndex(r => r.name === 'Claude Code CLI');
          if (idx !== -1) {
            results[idx] = newCheck;
            // Update fixes list
            const fixIdx = fixes.findIndex(f => f.startsWith('Claude Code CLI:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') {
              fixes.splice(fixIdx, 1);
            }
          }
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    // Summary
    const passed = results.filter(r => r.status === 'pass').length;
    const warnings = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    if (json) {
      const checks = results.map((result, index) => ({
        id: checkIds.get(checksToRun[index])!,
        status: result.status,
        name: result.name,
        detail: result.message,
        ...(result.fix ? { fix: result.fix } : {}),
      }));
      const data = { schemaVersion: 1, checks };
      output.writeln(JSON.stringify(data));
      return { success: failed === 0, exitCode: failed > 0 ? 1 : 0, data };
    }

    output.writeln();
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const summaryParts = [
      output.success(`${passed} passed`),
      warnings > 0 ? output.warning(`${warnings} warnings`) : null,
      failed > 0 ? output.error(`${failed} failed`) : null
    ].filter(Boolean);

    output.writeln(`Summary: ${summaryParts.join(', ')}`);

    // Show fixes — #1791.5: header makes it explicit these are commands you
    // run yourself, not actions doctor took.
    if (showFix && fixes.length > 0) {
      output.writeln();
      output.writeln(output.bold('Suggested commands (run them yourself):'));
      output.writeln();
      for (const fix of fixes) {
        output.writeln(output.dim(`  ${fix}`));
      }
    } else if (fixes.length > 0 && !showFix) {
      output.writeln();
      output.writeln(output.dim(`Run with --fix to see ${fixes.length} suggested command${fixes.length > 1 ? 's' : ''} (does not auto-apply)`));
    }

    // Overall result
    if (failed > 0) {
      output.writeln();
      output.writeln(output.error('Some checks failed. Please address the issues above.'));
      return { success: false, exitCode: 1, data: { passed, warnings, failed, results } };
    } else if (warnings > 0) {
      output.writeln();
      output.writeln(output.warning('All checks passed with some warnings.'));
      return { success: true, data: { passed, warnings, failed, results } };
    } else {
      output.writeln();
      output.writeln(output.success('All checks passed! System is healthy.'));
      return { success: true, data: { passed, warnings, failed, results } };
    }
  }
};

export default doctorCommand;
