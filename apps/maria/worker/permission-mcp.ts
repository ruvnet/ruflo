// Serveur MCP (stdio) lancé par Claude Code via --permission-prompt-tool.
// Chaque demande d'autorisation devient une ligne maria.permission_requests ; on attend que
// l'utilisateur clique « Autoriser » ou « Refuser » dans MarIA, puis on répond à Claude Code.
import { appendFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

export const SERVER_NAME = 'maria';
export const TOOL_NAME = 'approve';
/** Nom complet à passer à --permission-prompt-tool. */
export const PERMISSION_TOOL = `mcp__${SERVER_NAME}__${TOOL_NAME}`;

const POLL_MS = 1000;
/** Claude Code masque la sortie d'erreur des serveurs MCP : on journalise aussi dans un fichier. */
export const LOG_FILE = path.join(os.tmpdir(), 'maria-permissions.log');

function logError(message: string): void {
  console.error(`[maria-permissions] ${message}`);
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* journalisation au mieux */
  }
}

export type Decision = 'allowed' | 'denied' | 'expired';

export interface PermissionAnswer {
  decision: Decision;
  /** Réponses aux questions d'AskUserQuestion : { "<question>": "<réponse>" }. */
  response?: Record<string, string> | null;
}

export interface PermissionBackend {
  /** Crée la demande et renvoie la décision de l'utilisateur (ou 'expired' après le délai). */
  ask(toolName: string, input: Record<string, unknown>): Promise<PermissionAnswer>;
}

const QUESTION_TOOL = 'AskUserQuestion';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description: 'Outil interne de MarIA : soumet une demande de permission à l’utilisateur. Ne pas appeler directement.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

/** Traite un message JSON-RPC ; renvoie la réponse, ou null pour une notification. */
export function createHandler(backend: PermissionBackend) {
  return async (msg: JsonRpcRequest): Promise<object | null> => {
    if (msg.id === undefined) return null; // notifications (ex. notifications/initialized)
    const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });

    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: '0.1.0' },
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: [TOOL_DEFINITION] });
      case 'tools/call': {
        const args = (msg.params?.arguments ?? {}) as { tool_name?: string; input?: Record<string, unknown> };
        const input = args.input ?? {};
        const toolName = args.tool_name ?? 'inconnu';
        let decision: Decision | 'error';
        let response: Record<string, string> | null = null;
        try {
          ({ decision, response = null } = await backend.ask(toolName, input));
        } catch (err) {
          // En cas de panne on refuse : jamais d'autorisation sans décision explicite.
          decision = 'error';
          logError((err as Error).message);
        }
        const isQuestion = toolName === QUESTION_TOOL;
        const denyMessages = {
          denied: isQuestion ? 'L’utilisateur a préféré ne pas répondre à ces questions : continue avec des choix raisonnables, et signale-les.' : 'Action refusée par l’utilisateur dans MarIA.',
          expired: isQuestion ? 'Pas de réponse de l’utilisateur dans le délai imparti : continue avec des choix raisonnables, et signale-les.' : 'Pas de réponse de l’utilisateur dans le délai imparti : action refusée.',
          error: 'Impossible de soumettre la demande à MarIA (erreur technique) : action refusée.',
        };
        const answer =
          decision === 'allowed'
            ? { behavior: 'allow', updatedInput: isQuestion ? { ...input, answers: response ?? {} } : input }
            : { behavior: 'deny', message: denyMessages[decision] };
        return reply({ content: [{ type: 'text', text: JSON.stringify(answer) }] });
      }
      default:
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Méthode inconnue : ${msg.method}` } };
    }
  };
}

function supabaseBackend(): PermissionBackend {
  // Claude Code ne transmet pas forcément l'environnement du worker : on relit sa config.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(__dirname, '..', file);
      if (existsSync(p)) process.loadEnvFile(p);
    }
  }
  const missionId = process.env.MARIA_MISSION_ID;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const timeoutMs = Number(process.env.MARIA_PERMISSION_TIMEOUT_MS ?? 600_000);
  if (!missionId || !url || !key) throw new Error('MARIA_MISSION_ID, SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis');
  const db = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'maria' } });

  return {
    async ask(toolName, input) {
      const { data, error } = await db
        .from('permission_requests')
        .insert({ mission_id: missionId, tool_name: toolName, input })
        .select('id')
        .single();
      if (error) throw new Error(`insert: ${error.message}`);

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const { data: row, error: err } = await db.from('permission_requests').select('status, response').eq('id', data.id).single();
        if (err) continue; // erreur réseau passagère : on réessaie
        if (row.status !== 'pending') return { decision: row.status as Decision, response: row.response as Record<string, string> | null };
      }
      await db.from('permission_requests').update({ status: 'expired' }).eq('id', data.id).eq('status', 'pending');
      return { decision: 'expired' };
    },
  };
}

function main(): void {
  let backend: PermissionBackend;
  try {
    backend = supabaseBackend();
  } catch (err) {
    logError(`démarrage impossible : ${(err as Error).message}`);
    process.exit(1);
  }
  const handle = createHandler(backend);
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return;
    }
    // Pas d'await : plusieurs demandes peuvent être en attente en parallèle.
    void handle(msg).then((res) => {
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    });
  });
  lines.on('close', () => process.exit(0));
}

if (require.main === module) main();
