/**
 * `ruflo metaharness sim-ingest <op>` — CLI surface for the opt-in SIM
 * handoff ingestion adapter (sim-ingest.ts, metaharness issue #524).
 *
 *   status                                 enabled?, trusted keys, paths
 *   ingest       --file <envelope.json>    verify + store one signed handoff
 *   query        --tenant <owner/repo>     one tenant's evidence with provenance
 *   revoke-event --tenant <t> --event-id <id>
 *   revoke-key   --key-id <ed25519:...>    mark revoked + delete its events
 *   audit        [--limit N]               tail of the decision log
 *
 * Config: <project>/.claude-flow/sim/trusted-keys.json
 *   { "enabled": true, "keys": [{ "keyId", "publicKey" (SPKI PEM), "tenants": ["owner/repo"] }] }
 * Without that file, or with enabled !== true, every op reports `disabled`.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommandResult } from '../types.js';
import { output } from '../output.js';
import { openSimIngestor, saveSimIngestConfig, type SimEvidenceStore } from './sim-ingest.js';

const MAX_FILE_BYTES = 1024 * 1024;

function flag(flags: Record<string, unknown>, name: string): string | undefined {
  const v = flags[name];
  return v === undefined || v === null || v === true ? undefined : String(v);
}

function done(data: unknown, success = true): CommandResult {
  output.writeln(JSON.stringify(data, null, 2));
  return { success, exitCode: success ? 0 : 1, data };
}

export async function runSimIngestCommand(
  operation: string | undefined,
  flags: Record<string, unknown>,
  deps: { store?: SimEvidenceStore; now?: () => Date } = {},
): Promise<CommandResult> {
  const projectRoot = resolve(flag(flags, 'projectRoot') ?? process.cwd());
  const { ingestor, configPath, auditPath, dbPath } = openSimIngestor(projectRoot, deps);
  switch (operation ?? 'status') {
    case 'status':
      return done({ enabled: ingestor.enabled, configPath, auditPath, dbPath });
    case 'ingest': {
      const file = flag(flags, 'file');
      if (!file) return done({ success: false, reason: '--file <envelope.json> is required' }, false);
      const path = resolve(file);
      if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) {
        return done({ success: false, reason: 'envelope file missing or larger than 1 MiB' }, false);
      }
      let envelope: unknown;
      try { envelope = JSON.parse(readFileSync(path, 'utf8')); } catch {
        return done({ status: 'rejected', reason: 'malformed' }, false);
      }
      const result = await ingestor.ingest(envelope);
      return done(result, result.status !== 'rejected');
    }
    case 'query': {
      const tenant = flag(flags, 'tenant');
      if (!tenant) return done({ success: false, reason: '--tenant <owner/repo> is required' }, false);
      return done(await ingestor.query(tenant));
    }
    case 'revoke-event': {
      const tenant = flag(flags, 'tenant');
      const eventId = flag(flags, 'eventId');
      if (!tenant || !eventId) return done({ success: false, reason: '--tenant and --event-id are required' }, false);
      return done(await ingestor.revokeEvent(tenant, eventId));
    }
    case 'revoke-key': {
      const keyId = flag(flags, 'keyId');
      if (!keyId) return done({ success: false, reason: '--key-id is required' }, false);
      const result = await ingestor.revokeKey(keyId);
      if (result.status === 'revoked') {
        saveSimIngestConfig(configPath, result.config);
        return done({ status: 'revoked', keyId, deleted: result.deleted });
      }
      return done(result);
    }
    case 'audit': {
      const limit = Math.max(1, Math.min(1000, Number(flag(flags, 'limit') ?? 50) || 50));
      const lines = existsSync(auditPath) ? readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean) : [];
      return done(lines.slice(-limit).map((l) => JSON.parse(l)));
    }
    default:
      return done({ success: false, reason: 'unknown sim-ingest op; use status|ingest|query|revoke-event|revoke-key|audit' }, false);
  }
}
