import { z } from 'zod';
import { SECTION_NAMES } from './sections.js';

/** Control levels mirror the ruflo console: off < read < write < manage < full. */
export const LEVELS = ['off', 'read', 'write', 'manage', 'full'] as const;
export type Level = (typeof LEVELS)[number];
export const levelRank = (l: Level): number => LEVELS.indexOf(l);

const missionId = z.string().regex(/^msn_[a-f0-9]{24}$/);
const requestId = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const MAX_SWARM_AGENTS = 6;
export const AGENT_TYPES = ['coder', 'reviewer', 'tester', 'planner', 'researcher', 'security-auditor', 'performance-engineer'] as const;

export interface CommandSpec { level: Level; summary: string; args: z.ZodType<Record<string, unknown>>; }
const empty = z.object({}).strict();

/** The ONLY commands the hosted dashboard may ask a local ruflo to run. Anything else is refused on both ends. */
export const COMMANDS = {
  'section.refresh': { level: 'read', summary: 'Re-collect and publish one section now', args: z.object({ section: z.enum(SECTION_NAMES) }).strict() },
  'memory.list': { level: 'read', summary: 'List memory keys in a namespace (keys only, no values)', args: z.object({ namespace: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/), limit: z.number().int().min(1).max(100).default(20) }).strict() },
  'swarm.stop': { level: 'manage', summary: 'Shut down the running swarm', args: empty },
  'state.refresh': { level: 'read', summary: 'Publish a fresh state digest', args: empty },
  'memory.search': { level: 'read', summary: 'Semantic memory search (read-only)', args: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(5) }).strict() },
  'mission.create': { level: 'write', summary: 'Create a DRAFT mission (executes nothing)', args: z.object({ requestId, objective: z.string().min(3).max(2000) }).strict() },
  'mission.pause': { level: 'write', summary: 'Pause a mission', args: z.object({ missionId }).strict() },
  'mission.resume': { level: 'write', summary: 'Resume a paused mission', args: z.object({ missionId }).strict() },
  'mission.stop': { level: 'manage', summary: 'Stop a mission', args: z.object({ missionId }).strict() },
  'swarm.init': { level: 'manage', summary: 'Initialise a hierarchical swarm (max 6 agents)', args: z.object({ topology: z.enum(['hierarchical', 'mesh']).default('hierarchical'), maxAgents: z.number().int().min(1).max(MAX_SWARM_AGENTS).default(6) }).strict() },
  'agent.spawn': { level: 'manage', summary: 'Spawn one agent within the swarm cap', args: z.object({ type: z.enum(AGENT_TYPES), name: z.string().regex(/^[A-Za-z0-9._-]{1,48}$/).optional() }).strict() },
} as const satisfies Record<string, CommandSpec>;
export type CommandName = keyof typeof COMMANDS;
export const isCommandName = (n: unknown): n is CommandName => typeof n === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, n);

export const CommandBodySchema = z.object({
  cid: z.string().regex(/^cmd_[A-Za-z0-9_-]{16,64}$/),
  cmd: z.string().max(40),
  args: z.record(z.unknown()),
  /** Cognitum subject hash of the human who issued it, for the local audit log. */
  by: z.string().max(80),
  expiresAt: z.number().int().positive(),
}).strict();
export type CommandBody = z.infer<typeof CommandBodySchema>;

export type ParsedCommand = { ok: true; cmd: CommandName; args: Record<string, unknown>; level: Level } | { ok: false; reason: string };
export function parseCommand(name: unknown, args: unknown): ParsedCommand {
  if (!isCommandName(name)) return { ok: false, reason: 'command_not_allowlisted' };
  const spec = COMMANDS[name] as CommandSpec;
  const r = spec.args.safeParse(args ?? {});
  if (!r.success) return { ok: false, reason: 'invalid_arguments' };
  return { ok: true, cmd: name, args: r.data, level: spec.level };
}

/** Whether a command may run given the device's local control level; write+ also needs a local approval unless auto. */
export function authorize(cmd: CommandName, deviceLevel: Level, autoApprove: boolean): { allowed: boolean; needsApproval: boolean; reason?: string } {
  const need = (COMMANDS[cmd] as CommandSpec).level;
  if (levelRank(deviceLevel) < levelRank(need)) return { allowed: false, needsApproval: false, reason: `level_${deviceLevel}_below_${need}` };
  const needsApproval = need !== 'read' && !(autoApprove && levelRank(need) <= levelRank('write'));
  return { allowed: true, needsApproval };
}
