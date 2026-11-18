/**
 * Activation funnel (ruflo adoption plan; ADR-309 opt-in telemetry).
 *
 *   installed  -> init_completed -> first_agent_run -> session_active (7-day retention)
 *
 * Every event goes through recordFunnelEvent, which records nothing without
 * an explicit, current `telemetry` consent receipt. The once-ever and
 * once-per-day markers live in their own state file because a successful
 * flush removes sent events from the queue (lastRecordedEvent would forget).
 */

import { getConsent } from './consent.js';
import { recordFunnelEvent } from './events.js';
import { isCI, isInteractive } from './environment.js';
import { resolveFunnelEnabled } from './precedence.js';
import { readStateJson, writeStateJson } from './state.js';
import type { FunnelSurface } from './types.js';

const MARKERS_FILE = 'funnel-activation.json';

interface ActivationMarkers {
  firstAgentRunAt?: string;
  lastActiveDay?: string;
}

const day = (now: Date) => now.toISOString().slice(0, 10);

function markers(): ActivationMarkers {
  return readStateJson<ActivationMarkers>(MARKERS_FILE) ?? {};
}

/** `ruflo init` finished in a project. Recorded on every successful init. */
export function recordInitCompleted(release: string, now: Date = new Date()): boolean {
  return recordFunnelEvent('init_completed', 'init', release, now);
}

/** The first agent spawn or swarm init on this machine. Recorded once, ever. */
export function recordFirstAgentRun(release: string, surface: FunnelSurface = 'cli', now: Date = new Date()): boolean {
  const m = markers();
  if (m.firstAgentRunAt) return false;
  if (!recordFunnelEvent('first_agent_run', surface, release, now)) return false;
  writeStateJson(MARKERS_FILE, { ...m, firstAgentRunAt: now.toISOString() });
  return true;
}

/** At most one "active today" marker per calendar day (UTC). */
export function recordSessionActive(release: string, now: Date = new Date()): boolean {
  const m = markers();
  const today = day(now);
  if (m.lastActiveDay === today) return false;
  if (!recordFunnelEvent('session_active', 'cli', release, now)) return false;
  writeStateJson(MARKERS_FILE, { ...m, lastActiveDay: today });
  return true;
}

/**
 * Whether `ruflo init` should ask the one-time telemetry question: an
 * interactive terminal, not CI, funnel not disabled, no telemetry receipt
 * yet (asked once, whatever the answer), and not suppressed by flag.
 */
export function shouldOfferTelemetry(opts: { noTelemetryPrompt?: boolean; cwd?: string; env?: NodeJS.ProcessEnv } = {}): boolean {
  const env = opts.env ?? process.env;
  if (opts.noTelemetryPrompt) return false;
  if (isCI(env)) return false;
  if (!isInteractive()) return false;
  if (!resolveFunnelEnabled(opts.cwd ?? process.cwd(), env).enabled) return false;
  return getConsent('telemetry').at === null;
}

/** Fire-and-forget wrapper for command handlers: never throws, never blocks. */
export function noteFirstAgentRun(surface: FunnelSurface = 'cli'): void {
  void import('../mcp-protocol.js')
    .then(({ rufloPackageVersion }) => { recordFirstAgentRun(rufloPackageVersion(), surface); })
    .catch(() => undefined);
}
