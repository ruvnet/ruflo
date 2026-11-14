/**
 * ruflo events github|inbox|ack
 * The signed webhook is an untrusted trigger, never authorization to run code.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { EventIntelligenceGateway, type EventPolicy } from '../missions/event-gateway.js';

const MAX_FILE = 256 * 1024;
function readRegular(path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE)
    throw new Error('input must be a regular file of at most 256 KiB');
  return readFileSync(path);
}
function loadPolicy(path: unknown, cwd: string): EventPolicy {
  if (!path) return { mode: 'observe', repositories: [], actors: [], createDrafts: false };
  if (typeof path !== 'string') throw new Error('invalid policy-file');
  return JSON.parse(readRegular(resolve(cwd, path)).toString('utf8')) as EventPolicy;
}
export const eventsCommand: Command = {
  name: 'events',
  description: 'Opt-in signed GitHub events, durable mission ownership and worker inbox',
  options: [
    { name: 'payload-file', type: 'string', description: 'github: raw webhook JSON bytes' },
    { name: 'signature', type: 'string', description: 'github: X-Hub-Signature-256' },
    { name: 'delivery-id', type: 'string', description: 'github: X-GitHub-Delivery' },
    { name: 'event-type', type: 'string', description: 'github: X-GitHub-Event' },
    { name: 'policy-file', type: 'string', description: 'Policy JSON; absent means observe only' },
    { name: 'mission', type: 'string', description: 'inbox/ack: mission ID' },
    { name: 'event-key', type: 'string', description: 'ack: event receipt key' },
    { name: 'project-root', type: 'string', description: 'Project root (default: cwd)' },
  ],
  examples: [
    { command: 'ruflo events github --payload-file delivery.json --signature sha256=... --delivery-id 123 --event-type issue_comment --policy-file event-policy.json', description: 'Verify and journal a GitHub delivery' },
    { command: 'ruflo events inbox --mission msn_...', description: 'List pending mission events' },
    { command: 'ruflo events ack --mission msn_... --event-key <sha256>', description: 'Acknowledge a delivered event' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const flags = ctx.flags as Record<string, unknown>;
    const operation = ctx.args[0] ?? '';
    const root = resolve(String(flags.projectRoot ?? ctx.cwd ?? process.cwd()));
    try {
      const policy = loadPolicy(flags.policyFile, root);
      const gateway = new EventIntelligenceGateway(root, policy, process.env.RUFLO_GITHUB_WEBHOOK_SECRET ?? '');
      let result: unknown;
      if (operation === 'github') {
        if (typeof flags.payloadFile !== 'string') throw new Error('--payload-file required');
        result = await gateway.ingest({
          body: readRegular(resolve(root, flags.payloadFile)),
          signature256: String(flags.signature ?? ''),
          deliveryId: String(flags.deliveryId ?? ''),
          eventType: String(flags.eventType ?? ''),
        });
      } else if (operation === 'inbox') {
        result = await gateway.inbox(String(flags.mission ?? ''));
      } else if (operation === 'ack') {
        result = { acknowledged: await gateway.acknowledge(String(flags.mission ?? ''), String(flags.eventKey ?? '')) };
      } else {
        throw new Error('expected github, inbox, or ack');
      }
      output.writeln(JSON.stringify({ ok: true, data: result }, null, 2));
      return { success: true, exitCode: 0, data: result };
    } catch (error) {
      const result = { ok: false, code: 'events-failed', message: error instanceof Error ? error.message : String(error) };
      output.writeln(JSON.stringify(result));
      return { success: false, exitCode: 1, data: result };
    }
  },
};
export default eventsCommand;
