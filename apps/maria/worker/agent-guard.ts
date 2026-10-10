// Hook PreToolUse des missions en chaîne : seuls les sous-agents mentionnés (« @agent ») peuvent être lancés,
// et uniquement en mode synchrone. Claude Code l'exécute avant chaque appel de l'outil Agent (ex-Task).
// Liste autorisée : variable d'environnement MARIA_CHAIN_AGENTS (noms séparés par des virgules).

export interface HookInput {
  tool_name?: string;
  tool_input?: { subagent_type?: unknown; run_in_background?: unknown };
}

/** Raison du refus, ou null si l'appel est autorisé. */
export function denyReason(input: HookInput, allowed: string[]): string | null {
  if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const type = typeof input.tool_input?.subagent_type === 'string' ? input.tool_input.subagent_type : 'general-purpose';
  const list = allowed.map((a) => `« ${a} »`).join(', ');
  if (!allowed.includes(type)) {
    return `L'agent « ${type} » n'est pas autorisé pour cette mission : l'utilisateur n'a demandé que ${list}. Utilise uniquement ces agents (subagent_type exact), sans en lancer d'autres.`;
  }
  if (input.tool_input?.run_in_background === true) {
    return `Lance « ${type} » en mode synchrone (sans run_in_background) : attends son résultat, puis transmets-le à l'étape suivante.`;
  }
  return null;
}

function main(): void {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => (raw += chunk));
  process.stdin.on('end', () => {
    const allowed = (process.env.MARIA_CHAIN_AGENTS ?? '').split(',').filter(Boolean);
    let reason: string | null;
    try {
      reason = denyReason(JSON.parse(raw) as HookInput, allowed);
    } catch {
      reason = 'Entrée du hook MarIA illisible : appel refusé.';
    }
    if (reason) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
      );
    }
  });
}

if (require.main === module) main();
