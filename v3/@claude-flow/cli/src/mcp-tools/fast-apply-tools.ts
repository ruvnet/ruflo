/**
 * hooks_fast-apply — merge a code snippet into a file or string with
 * agent-booster (~ms, no LLM). The caller supplies the target code; for
 * deterministic intents with no snippet use hooks_codemod instead.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, sep } from 'path';
import { type MCPTool, getProjectCwd } from './types.js';
import { validatePath } from './validate-input.js';
import { realpathNearest, isInsideRealRoot } from './realpath-containment.js';

const MAX_INPUT_BYTES = 1_000_000;

function langForPath(p: string): string | undefined {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
  };
  return map[ext];
}

export const hooksFastApply: MCPTool = {
  name: 'hooks_fast-apply',
  description: 'Merge an edit SNIPPET (the rewritten code, e.g. a whole new version of one function) into a file or raw code using agent-booster — a local fast-apply engine (~1-10 ms, no LLM, $0). `edit` must be code, not an instruction: "make add typed" fails, "function add(a: number, b: number): number { return a + b; }" works. Use when you already have the replacement code and the surrounding file is large, instead of re-sending the whole file. Deterministic intents (var-to-const, remove-console, add-logging) belong to hooks_codemod. Returns confidence + strategy; below minConfidence nothing is written.',
  inputSchema: {
    type: 'object',
    properties: {
      edit: { type: 'string', description: 'Target code snippet to merge (code, not an instruction)' },
      file: { type: 'string', description: 'Existing file inside the project to patch in place' },
      code: { type: 'string', description: 'Raw source to patch instead of a file (returns output, writes nothing)' },
      language: { type: 'string', description: 'Language hint (inferred from the file extension when omitted)' },
      minConfidence: { type: 'number', description: 'Minimum merge confidence 0-1 required to apply (default 0.5)' },
      dryRun: { type: 'boolean', description: 'Report the merge result without writing the file' },
    },
    required: ['edit'],
  },
  handler: async (params: Record<string, unknown>) => {
    const edit = params.edit;
    if (typeof edit !== 'string' || edit.trim() === '') return { success: false, error: 'edit (non-empty code snippet) is required' };
    if (edit.length > MAX_INPUT_BYTES) return { success: false, error: 'edit too large' };
    const minConfidence = typeof params.minConfidence === 'number'
      ? Math.min(Math.max(params.minConfidence, 0), 1) : 0.5;
    const dryRun = params.dryRun === true;
    const { fastApply } = await import('../ruvector/fast-apply.js');

    if (typeof params.code === 'string') {
      if (params.code.length > MAX_INPUT_BYTES) return { success: false, error: 'code too large' };
      const r = await fastApply({ code: params.code, edit, language: params.language as string | undefined, minConfidence });
      return { ...r, mode: 'code', cost: 0 };
    }

    if (typeof params.file !== 'string') return { success: false, error: 'Provide `file` or `code`.' };
    const v = validatePath(params.file, 'file');
    if (!v.valid) return { success: false, error: v.error };
    const cwd = getProjectCwd();
    const abs = resolve(cwd, v.sanitized);
    if (abs !== cwd && !abs.startsWith(cwd + sep)) return { success: false, error: `path escapes project root: ${params.file}` };
    let realRoot: string;
    try { realRoot = realpathNearest(cwd); } catch (err) { return { success: false, error: `cannot resolve project root: ${(err as Error).message}` }; }
    if (!isInsideRealRoot(realRoot, abs)) return { success: false, error: `path escapes project root via symlink: ${params.file}` };
    if (!existsSync(abs)) return { success: false, error: `file not found: ${params.file}` };

    const before = readFileSync(abs, 'utf-8');
    if (before.length > MAX_INPUT_BYTES) return { success: false, error: 'file too large' };
    const language = (params.language as string | undefined) ?? langForPath(abs);
    const r = await fastApply({ code: before, edit, language, minConfidence });
    const written = r.success && !dryRun;
    if (written) writeFileSync(abs, r.output, 'utf-8');
    const { output, ...meta } = r;
    return { ...meta, mode: dryRun ? 'dry-run' : 'file', file: params.file, written, ...(dryRun && { output }), cost: 0 };
  },
};

export const fastApplyTools: MCPTool[] = [hooksFastApply];
