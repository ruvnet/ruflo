/**
 * Event Intelligence Gateway: opt-in GitHub webhook intake for MissionService.
 *
 * An authenticated webhook is NOT authorization to execute work. All events
 * pass the local allowlist and are stored as receipts; new missions are drafts.
 * Existing task ownership stays with MissionService, not another scheduler.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireLock } from '../services/policy-runtime.js';
import { writeFileAtomic } from './store.js';
import { MissionService } from './service.js';

export type EventDisposition = 'ignored' | 'created' | 'attached';
export interface GitHubEnvelope {
  deliveryId: string;
  eventType: string;
  signature256: string;
  body: Buffer;
}
export interface EventPolicy {
  mode: 'observe' | 'enforce';
  repositories: string[];
  actors: string[];
  createDrafts: boolean;
}
export interface EventReceipt {
  version: 1;
  eventKey: string;
  source: 'github';
  threadKey: string;
  deliveryId: string;
  eventType: string;
  actor: string;
  repository: string;
  payloadDigest: string;
  missionId: string | null;
  disposition: EventDisposition;
  reason: string;
  acknowledged: boolean;
  receivedAt: string;
}
export interface IngestResult {
  receipt: EventReceipt;
  duplicate: boolean;
}

const MAX_BODY = 256 * 1024;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SECRET_MIN = 16;
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
function asObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}
function safePart(v: unknown): string {
  return typeof v === 'string' && ID_RE.test(v) ? v : '';
}
function normalizedPolicy(raw: EventPolicy): EventPolicy {
  if (!raw || !['observe', 'enforce'].includes(raw.mode) ||
      !Array.isArray(raw.repositories) || !Array.isArray(raw.actors) ||
      typeof raw.createDrafts !== 'boolean' ||
      raw.repositories.some(x => typeof x !== 'string' || !GITHUB_REPO.test(x)) ||
      raw.actors.some(x => typeof x !== 'string' || !ID_RE.test(x))) {
    throw new Error('invalid event policy');
  }
  return {
    mode: raw.mode,
    repositories: raw.repositories.map(s => s.toLowerCase()),
    actors: raw.actors.map(s => s.toLowerCase()),
    createDrafts: raw.createDrafts,
  };
}

/** Signature covers the exact raw bytes, not parsed or reserialized JSON. */
export function verifyGitHubSignature(envelope: GitHubEnvelope, secret: string): boolean {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < SECRET_MIN ||
      !ID_RE.test(envelope.deliveryId) || !ID_RE.test(envelope.eventType) ||
      !Buffer.isBuffer(envelope.body) || envelope.body.length > MAX_BODY ||
      !/^sha256=[a-f0-9]{64}$/.test(envelope.signature256)) return false;
  const mac = createHmac('sha256', secret).update(envelope.body).digest('hex');
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(envelope.signature256.slice(7), 'hex'));
}

interface ParsedEvent { repo: string; actor: string; threadKey: string; objective: string; interesting: boolean }
function parseGitHubEvent(eventType: string, body: Buffer): ParsedEvent {
  const root = asObject(JSON.parse(body.toString('utf8')));
  const repository = asObject(root.repository).full_name;
  if (typeof repository !== 'string' || !GITHUB_REPO.test(repository)) throw new Error('invalid repository');
  const actor = safePart(asObject(root.sender).login);
  if (!actor) throw new Error('invalid sender');
  const issue = asObject(root.issue);
  const pr = asObject(root.pull_request);
  const comment = asObject(root.comment);
  const check = asObject(root.check_run);
  const prs = Array.isArray(check.pull_requests) ? check.pull_requests : [];
  const prFromCheck = asObject(prs[0]);
  const number = eventType === 'issue_comment' ? issue.number
    : eventType === 'check_run' ? prFromCheck.number
    : pr.number ?? root.number;
  if (!Number.isSafeInteger(number) || (number as number) < 1) {
    throw new Error('event missing issue or pull request number');
  }
  const isPr = eventType !== 'issue_comment' || isObject(issue.pull_request);
  const kind = isPr ? 'pr' : 'issue';
  const threadKey = 'github:' + repository.toLowerCase() + ':' + kind + ':' + number;
  const action = safePart(root.action);
  const interesting = (
    (eventType === 'issue_comment' && action === 'created' && !!safePart(comment.id?.toString())) ||
    (eventType === 'pull_request_review_comment' && action === 'created') ||
    (eventType === 'pull_request' && ['opened', 'reopened', 'synchronize', 'review_requested'].includes(action)) ||
    (eventType === 'check_run' && action === 'completed')
  );
  if (!['issue_comment', 'pull_request_review_comment', 'pull_request', 'check_run'].includes(eventType)) {
    throw new Error('unsupported webhook event');
  }
  return { repo: repository.toLowerCase(), actor: actor.toLowerCase(), threadKey,
    objective: 'Review ' + kind.toUpperCase() + ' #' + number + ' in ' + repository, interesting };
}

/**
 * Files are an incoming-event inbox, not an alternate mission ledger.
 * One global gateway lock serializes thread ownership and dedup across processes.
 * MissionService.create uses deterministic request IDs to safely retry a crash.
 */
export class EventIntelligenceGateway {
  private readonly dir: string;
  private readonly policy: EventPolicy;
  private readonly mission: MissionService;

  constructor(projectRoot: string, policy: EventPolicy, private readonly secret: string) {
    this.dir = join(resolve(projectRoot), '.claude-flow', 'event-gateway');
    this.policy = normalizedPolicy(policy);
    this.mission = new MissionService({ projectRoot, channel: 'cli' });
  }
  private eventPath(key: string): string { return join(this.dir, 'events', key + '.json'); }
  private ownerPath(threadKey: string): string { return join(this.dir, 'owners', hash(threadKey) + '.json'); }
  private readReceipt(key: string): EventReceipt | null {
    const p = this.eventPath(key);
    if (!existsSync(p)) return null;
    const stat = lstatSync(p);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe event receipt');
    const receipt = JSON.parse(readFileSync(p, 'utf8')) as EventReceipt;
    if (receipt.eventKey !== key || receipt.version !== 1) throw new Error('corrupt event receipt');
    return receipt;
  }
  private readOwner(threadKey: string): string | null {
    const p = this.ownerPath(threadKey);
    if (!existsSync(p)) return null;
    const stat = lstatSync(p);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe thread owner');
    const record = JSON.parse(readFileSync(p, 'utf8')) as { threadKey: string; missionId: string };
    if (record.threadKey !== threadKey || !/^msn_[a-f0-9]{24}$/.test(record.missionId)) throw new Error('corrupt thread owner');
    return record.missionId;
  }
  private async locked<T>(fn: () => Promise<T> | T): Promise<T> {
    mkdirSync(join(this.dir, 'events'), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.dir, 'owners'), { recursive: true, mode: 0o700 });
    const release = await acquireLock(join(this.dir, 'gateway.lock'));
    try { return await fn(); } finally { release(); }
  }

  /** One signed GitHub webhook; no tools or workers run from this method. */
  async ingest(envelope: GitHubEnvelope): Promise<IngestResult> {
    if (!verifyGitHubSignature(envelope, this.secret)) throw new Error('unauthenticated GitHub delivery');
    const parsed = parseGitHubEvent(envelope.eventType, envelope.body);
    const eventKey = hash('github\0' + envelope.deliveryId);
    const digest = 'sha256:' + hash(envelope.body);
    return this.locked(async () => {
      const old = this.readReceipt(eventKey);
      if (old) {
        if (old.payloadDigest !== digest || old.threadKey !== parsed.threadKey || old.eventType !== envelope.eventType) {
          throw new Error('delivery ID collision with different payload');
        }
        return { receipt: old, duplicate: true };
      }
      let missionId: string | null = null;
      let disposition: EventDisposition = 'ignored';
      let reason = 'not admitted';
      const allowed = this.policy.mode === 'enforce' && parsed.interesting &&
        this.policy.repositories.includes(parsed.repo) && this.policy.actors.includes(parsed.actor);
      if (allowed) {
        missionId = this.readOwner(parsed.threadKey);
        if (missionId) {
          const exists = await this.mission.get({ missionId });
          if (!exists.ok) throw new Error('thread refers to missing mission; manual repair required');
          disposition = 'attached';
          reason = 'existing task owner';
        } else if (this.policy.createDrafts) {
          // Deterministic idempotency survives a crash after mission creation.
          const created = await this.mission.create({
            requestId: 'event-' + eventKey.slice(0, 48),
            objective: parsed.objective,
          });
          if (!created.ok) throw new Error('mission creation failed: ' + created.code);
          missionId = created.data.missionId;
          writeFileAtomic(this.ownerPath(parsed.threadKey),
            JSON.stringify({ threadKey: parsed.threadKey, missionId }));
          disposition = 'created';
          reason = 'authorized draft created; execution not admitted';
        } else {
          reason = 'draft creation disabled';
        }
      } else if (this.policy.mode === 'observe') {
        reason = 'observe mode; no mission created';
      } else if (!parsed.interesting) {
        reason = 'non-actionable event';
      } else {
        reason = 'repository or actor not allowed';
      }
      const receipt: EventReceipt = {
        version: 1, eventKey, source: 'github', threadKey: parsed.threadKey,
        deliveryId: envelope.deliveryId, eventType: envelope.eventType, actor: parsed.actor, repository: parsed.repo,
        payloadDigest: digest, missionId, disposition, reason,
        acknowledged: false, receivedAt: new Date().toISOString(),
      };
      writeFileAtomic(this.eventPath(eventKey), JSON.stringify(receipt));
      return { receipt, duplicate: false };
    });
  }

  /** A worker can poll durable context receipts for its mission, then acknowledge. */
  async inbox(missionId: string): Promise<EventReceipt[]> {
    if (!/^msn_[a-f0-9]{24}$/.test(missionId)) throw new Error('invalid mission ID');
    return this.locked(() => readdirSync(join(this.dir, 'events'))
      .filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => this.readReceipt(name.slice(0, -5))!)
      .filter(r => r.missionId === missionId && !r.acknowledged)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.eventKey.localeCompare(b.eventKey)));
  }

  async acknowledge(missionId: string, eventKey: string): Promise<boolean> {
    if (!/^msn_[a-f0-9]{24}$/.test(missionId) || !/^[a-f0-9]{64}$/.test(eventKey))
      throw new Error('invalid mission or event key');
    return this.locked(() => {
      const receipt = this.readReceipt(eventKey);
      if (!receipt || receipt.missionId !== missionId) return false;
      if (!receipt.acknowledged) {
        writeFileAtomic(this.eventPath(eventKey), JSON.stringify({ ...receipt, acknowledged: true }));
      }
      return true;
    });
  }
}
