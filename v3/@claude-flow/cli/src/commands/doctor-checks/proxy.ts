/**
 * Doctor checks for the funnel, Meta LLM Proxy and Cognitum identity.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { HealthCheck } from './shared.js';

/**
 * ADR-305 — funnel state audit. Reports the effective enabled/disabled
 * state and, critically for enterprise audit verification, WHICH
 * precedence source decided it (env > enterprise > user > default).
 * Informational: both states are `pass`; only a resolver failure warns.
 */
export async function checkFunnel(): Promise<HealthCheck> {
  try {
    const { resolveFunnelEnabled, getDisclosure } = await import('../../funnel/index.js');
    const decision = resolveFunnelEnabled();
    const disclosure = getDisclosure();
    return {
      name: 'Funnel (ADR-305)',
      status: 'pass',
      message: `${decision.enabled ? 'enabled' : 'disabled'} (decided by: ${decision.decidedBy}; disclosure: ${disclosure.state})`,
    };
  } catch (err) {
    return {
      name: 'Funnel (ADR-305)',
      status: 'warn',
      message: `state unreadable: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'ruflo funnel status',
    };
  }
}

/** Meta LLM Proxy — sponsored-downtime health (ADR-313). */
export async function checkProxySponsoredConsent(): Promise<HealthCheck> {
  try {
    const { funnelStateDir, hasConsent, readRateLimitStatus, lastRecordedEvent } = await import('../../funnel/index.js');
    const dir = funnelStateDir();
    const installed = existsSync(join(dir, 'proxy-token'));
    const consented = hasConsent('sponsored-downtime');
    const rateLimited = readRateLimitStatus();
    const lastExhausted = lastRecordedEvent('sponsor_capacity_exhausted');

    if (!installed) {
      return {
        name: 'Meta LLM Proxy (ADR-313)',
        status: 'warn',
        message: 'not installed — no proxy-token found; sponsored-downtime capacity is unavailable',
        fix: 'See cognitum-one/meta-proxy (private) for install instructions',
      };
    }

    const parts = [
      `sponsored consent: ${consented ? 'granted' : 'not granted'}`,
      `rate-limit flag: ${rateLimited.limited ? `set (since ${rateLimited.since})` : 'not set'}`,
    ];
    if (lastExhausted) parts.push(`last capacity-exhausted: ${lastExhausted}`);

    if (rateLimited.limited && !consented) {
      return {
        name: 'Meta LLM Proxy (ADR-313)',
        status: 'warn',
        message: `${parts.join('; ')} — flagged rate-limited but sponsored capacity isn't enabled`,
        fix: 'ruflo proxy sponsor-enable --yes',
      };
    }

    return { name: 'Meta LLM Proxy (ADR-313)', status: 'pass', message: parts.join('; ') };
  } catch (err) {
    return {
      name: 'Meta LLM Proxy (ADR-313)',
      status: 'warn',
      message: `state unreadable: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'ruflo proxy sponsor-status',
    };
  }
}

/**
 * Binary presence + tamper check (ADR-307). Deliberately NEVER spawns the
 * binary to probe a version — confirmed empirically (2026-07-16) that
 * `meta-proxy` has no `--version`/`--help` flag and starts the live server
 * as a side effect of ANY invocation, which a doctor health check must never
 * do. Version info instead comes from install-manifest.json (written at
 * install time) and, once running, the proxy's own `/status` endpoint via
 * checkProxyProcess below.
 */
export async function checkProxyBinary(): Promise<HealthCheck> {
  const NAME = 'Meta LLM Proxy binary (ADR-307)';
  try {
    const { proxyBinaryPath, proxyInstallManifestPath } = await import('../../proxy/paths.js');
    const binPath = proxyBinaryPath();
    if (!existsSync(binPath)) {
      return { name: NAME, status: 'warn', message: 'not installed', fix: 'ruflo proxy install' };
    }

    const manifestPath = proxyInstallManifestPath();
    if (!existsSync(manifestPath)) {
      return {
        name: NAME,
        status: 'warn',
        message: 'binary present but no install-manifest.json — provenance unknown (installed outside `ruflo proxy install`?)',
        fix: 'ruflo proxy update --release <x.y.z>',
      };
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version: string;
      sha256: string;
      verifiedAt: string;
    };
    const liveSha = createHash('sha256').update(readFileSync(binPath)).digest('hex');
    if (liveSha !== manifest.sha256) {
      return {
        name: NAME,
        status: 'fail',
        message: `binary sha256 does not match the recorded install manifest — possible tampering or a manual overwrite (expected ${manifest.sha256.slice(0, 12)}…, got ${liveSha.slice(0, 12)}…)`,
        fix: 'ruflo proxy update --release <x.y.z>',
      };
    }

    return { name: NAME, status: 'pass', message: `v${manifest.version}, signature-verified at install (${manifest.verifiedAt})` };
  } catch (err) {
    return { name: NAME, status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** PID-file liveness (ADR-307) — mirrors daemon.ts's signal-0 probe pattern. */
export async function checkProxyProcess(): Promise<HealthCheck> {
  const NAME = 'Meta LLM Proxy process (ADR-307)';
  try {
    const { proxyPidFilePath } = await import('../../proxy/paths.js');
    const pidPath = proxyPidFilePath();
    if (!existsSync(pidPath)) {
      return { name: NAME, status: 'warn', message: 'not running (no PID file)', fix: 'ruflo proxy start' };
    }

    const pidRaw = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidRaw, 10);
    if (!Number.isFinite(pid)) {
      return { name: NAME, status: 'warn', message: `PID file is malformed: ${JSON.stringify(pidRaw)}`, fix: 'ruflo proxy stop && ruflo proxy start' };
    }

    try {
      process.kill(pid, 0); // signal-0 liveness probe — throws if the process is dead
    } catch {
      return { name: NAME, status: 'warn', message: `PID file points at ${pid}, which is not running — stale PID file`, fix: 'ruflo proxy start' };
    }

    // Live version-compat + data-plane info, ONLY once PID liveness already
    // confirmed a process is running (never spawns anything — see
    // checkProxyBinary's comment on why probing via process launch is unsafe).
    // GET /status shape confirmed against the real v0.1.0 binary:
    // {"version","data_plane","bind","sponsored_available","proxy_token_valid"}.
    const { proxyConfigPath, proxyTokenPath, proxyInstallManifestPath } = await import('../../proxy/paths.js');
    const bindMatch = existsSync(proxyConfigPath())
      ? readFileSync(proxyConfigPath(), 'utf-8').match(/^bind\s*=\s*"([^"]*)"/m)
      : null;
    const bind = bindMatch ? bindMatch[1] : '127.0.0.1:11435';

    let token: string;
    try {
      token = readFileSync(proxyTokenPath(), 'utf-8').trim();
    } catch {
      return { name: NAME, status: 'pass', message: `running (pid ${pid}); no proxy-token to query /status` };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://${bind}/status`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return { name: NAME, status: 'warn', message: `running (pid ${pid}); /status returned HTTP ${resp.status}` };
      }
      const body = (await resp.json()) as { version?: string; data_plane?: string };

      let versionNote = '';
      if (existsSync(proxyInstallManifestPath())) {
        const manifest = JSON.parse(readFileSync(proxyInstallManifestPath(), 'utf-8')) as { version?: string };
        if (manifest.version && body.version && manifest.version !== body.version) {
          return {
            name: NAME,
            status: 'warn',
            message: `running (pid ${pid}) reports v${body.version}, but the installed binary is v${manifest.version} — a stale process from a previous version?`,
            fix: 'ruflo proxy stop && ruflo proxy start',
          };
        }
        versionNote = body.version ? ` v${body.version}` : '';
      }

      return {
        name: NAME,
        status: 'pass',
        message: `running (pid ${pid})${versionNote}; data plane: ${body.data_plane ?? 'unknown'}`,
      };
    } catch (err) {
      // Live process but /status unreachable (still starting up, or a
      // network hiccup) — not a failure, PID liveness already passed.
      return {
        name: NAME,
        status: 'pass',
        message: `running (pid ${pid}); /status unreachable (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  } catch (err) {
    return { name: NAME, status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Non-loopback bind exposure warning (ADR-307's mandated startup warning, surfaced in doctor too). */
export async function checkProxyBindAddress(): Promise<HealthCheck> {
  const NAME = 'Meta LLM Proxy bind address (ADR-307)';
  try {
    const { proxyConfigPath, isLoopbackBind } = await import('../../proxy/paths.js');
    const cfgPath = proxyConfigPath();
    if (!existsSync(cfgPath)) {
      return { name: NAME, status: 'pass', message: 'no config file yet — defaults to loopback-only (127.0.0.1:11435)' };
    }

    const raw = readFileSync(cfgPath, 'utf-8');
    const match = raw.match(/^bind\s*=\s*"([^"]*)"/m);
    const bind = match ? match[1] : '127.0.0.1:11435';

    if (!isLoopbackBind(bind)) {
      return {
        name: NAME,
        status: 'warn',
        message: `bound to non-loopback address ${bind} — this exposes the proxy to your network`,
        fix: 'Set bind back to 127.0.0.1:<port> in proxy-config.toml unless external exposure is intended',
      };
    }

    return { name: NAME, status: 'pass', message: `loopback-only (${bind})` };
  } catch (err) {
    return { name: NAME, status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** `ruflo auth` health (ADR-306). Warn (never fail) on absence — auth is never required for core functionality. */
export async function checkAuth(): Promise<HealthCheck> {
  const NAME = 'Cognitum identity (ADR-306)';
  try {
    const { listProfiles } = await import('../../auth/state.js');
    const { domainForScope } = await import('../../auth/scopes.js');
    const { hasConsent } = await import('../../funnel/index.js');
    const { profiles } = listProfiles();

    if (profiles.length === 0) {
      return { name: NAME, status: 'warn', message: 'not logged in', fix: 'ruflo auth login' };
    }

    let keychainAvailable: boolean | 'unknown' = 'unknown';
    try {
      const sec = await import('@claude-flow/security');
      keychainAvailable = await (await sec.createKeychainAdapter()).isAvailable();
    } catch {
      keychainAvailable = 'unknown'; // security package unavailable — surfaced by checkProxyBinary's sibling concerns, not duplicated here
    }

    // Scope-vs-receipt consistency check (ADR-306: "fail-closed... reports").
    // Unlike every other check in this file, a violation here is a FAIL, not
    // a warn — a scope present without a matching consent receipt is exactly
    // the condition ADR-306 says must never silently pass.
    const violations: string[] = [];
    for (const p of profiles) {
      for (const scope of p.scopes) {
        const domain = domainForScope(scope);
        if (domain && !hasConsent(domain)) violations.push(`${p.profile}: ${scope}`);
      }
    }
    if (violations.length > 0) {
      return {
        name: NAME,
        status: 'fail',
        message: `scope granted without a matching consent receipt: ${violations.join(', ')}`,
        fix: 'ruflo auth logout && ruflo auth login',
      };
    }

    const names = profiles.map((p) => p.profile).join(', ');
    const sessionOnly = profiles.filter((p) => !p.keychainRef).map((p) => p.profile);
    const parts = [`profiles: ${names}`];
    if (keychainAvailable === false) parts.push('keychain backend unreachable — falling back to session-only tokens');
    if (sessionOnly.length > 0) parts.push(`session-only (no persisted refresh token): ${sessionOnly.join(', ')}`);

    return { name: NAME, status: 'pass', message: parts.join('; ') };
  } catch (err) {
    return { name: NAME, status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
