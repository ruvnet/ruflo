/** Local approval for write+ commands. Default: interactive y/N on a TTY; with no TTY the answer is always "deny". */
import { createInterface } from 'node:readline';
import { sanitize } from './protocol/index.js';

export interface ApprovalRequest { cid: string; cmd: string; summary: string; level: string; args: Record<string, unknown>; by: string }
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

/** Printable ASCII/Unicode only: strips ESC and other control characters so a hostile arg cannot rewrite the prompt. */
export const printable = (s: string, n = 300): string => s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').slice(0, n);

export const denyAll: Approver = async () => false;

export function ttyApprover(input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin, output: NodeJS.WritableStream = process.stderr, timeoutMs = 60_000): Approver {
  return async req => {
    if (!input.isTTY) return false;
    const args = printable(JSON.stringify(sanitize(req.args)), 500);
    output.write(`\n[ruflo dashboard] Remote command requires approval\n  command : ${printable(req.cmd, 40)} (${printable(req.summary, 120)})\n  level   : ${printable(req.level, 12)}\n  args    : ${args}\n  from    : ${printable(req.by, 80)}\n`);
    const rl = createInterface({ input, output });
    try {
      return await new Promise<boolean>(resolve => {
        const t = setTimeout(() => resolve(false), timeoutMs);
        rl.question('Run it? [y/N] ', a => { clearTimeout(t); resolve(/^y(es)?$/i.test(a.trim())); });
      });
    } finally { rl.close(); }
  };
}
