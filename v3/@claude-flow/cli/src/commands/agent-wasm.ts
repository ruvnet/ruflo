/**
 * WASM Agent CLI Subcommands
 *
 * Exposes @ruvector/rvagent-wasm operations via the `agent` CLI command.
 * Wraps functions from ruvector/agent-wasm.ts for CLI usage.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const WASM_NOT_AVAILABLE_MSG =
  '@ruvector/rvagent-wasm is not installed.\n' +
  'Install it with: npm install @ruvector/rvagent-wasm';

async function loadWasm() {
  const mod = await import('../ruvector/agent-wasm.js');
  return mod;
}

// agent wasm-status
export const wasmStatusCommand: Command = {
  name: 'wasm-status',
  description: 'Check rvagent-wasm availability, version, and capabilities',
  options: [],
  examples: [
    { command: 'claude-flow agent wasm-status', description: 'Check WASM agent runtime status' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const wasm = await loadWasm();
      const available = await wasm.isAgentWasmAvailable();

      if (!available) {
        output.writeln();
        output.printWarning(WASM_NOT_AVAILABLE_MSG);
        if (ctx.flags.format === 'json') {
          output.printJson({ available: false });
        }
        return { success: true, data: { available: false } };
      }

      // Init to get full status
      await wasm.initAgentWasm();

      const agents = wasm.listWasmAgents();
      let galleryCount = 0;
      let categories: Record<string, number> = {};
      try {
        galleryCount = await wasm.getGalleryCount();
        categories = await wasm.getGalleryCategories();
      } catch {
        // Gallery may not be available in all builds
      }

      const statusData = {
        available: true,
        activeAgents: agents.length,
        gallery: {
          templates: galleryCount,
          categories,
        },
        tools: ['read_file', 'write_file', 'edit_file', 'write_todos', 'list_files'],
        features: ['sandboxed-execution', 'virtual-filesystem', 'gallery-templates', 'rvf-containers', 'mcp-bridge'],
      };

      if (ctx.flags.format === 'json') {
        output.printJson(statusData);
        return { success: true, data: statusData };
      }

      output.writeln();
      output.writeln(output.bold('WASM Agent Runtime'));
      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 20 },
          { key: 'value', header: 'Value', width: 40 },
        ],
        data: [
          { property: 'Available', value: output.success('yes') },
          { property: 'Active Agents', value: String(agents.length) },
          { property: 'Gallery Templates', value: String(galleryCount) },
          { property: 'Sandbox Tools', value: statusData.tools.join(', ') },
          { property: 'Features', value: statusData.features.join(', ') },
        ],
      });

      if (Object.keys(categories).length > 0) {
        output.writeln();
        output.writeln(output.bold('Gallery Categories'));
        output.printTable({
          columns: [
            { key: 'category', header: 'Category', width: 20 },
            { key: 'count', header: 'Templates', width: 10, align: 'right' },
          ],
          data: Object.entries(categories).map(([category, count]) => ({ category, count })),
        });
      }

      return { success: true, data: statusData };
    } catch (error) {
      output.printError(`WASM status check failed: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// agent wasm-create
export const wasmCreateCommand: Command = {
  name: 'wasm-create',
  description: 'Create a WASM-sandboxed agent',
  options: [
    {
      name: 'template',
      short: 't',
      description: 'Gallery template (coder, researcher, tester, reviewer, security, swarm)',
      type: 'string',
    },
    {
      name: 'model',
      short: 'm',
      description: 'Model identifier (default: anthropic:claude-sonnet-4-6)',
      type: 'string',
    },
    {
      name: 'instructions',
      short: 'i',
      description: 'System instructions for the agent',
      type: 'string',
    },
    {
      name: 'max-turns',
      description: 'Maximum conversation turns (default: 50)',
      type: 'number',
      default: 50,
    },
  ],
  examples: [
    { command: 'claude-flow agent wasm-create', description: 'Create a default WASM agent' },
    { command: 'claude-flow agent wasm-create -t coder', description: 'Create from gallery template' },
    { command: 'claude-flow agent wasm-create -m "anthropic:claude-sonnet-4-6" -i "You are a security auditor"', description: 'Create with custom config' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const wasm = await loadWasm();
      const available = await wasm.isAgentWasmAvailable();
      if (!available) {
        output.printError(WASM_NOT_AVAILABLE_MSG);
        return { success: false, exitCode: 1 };
      }

      const template = ctx.flags.template as string | undefined;
      let info;

      if (template) {
        output.printInfo(`Creating WASM agent from template: ${output.highlight(template)}`);
        info = await wasm.createAgentFromTemplate(template);
      } else {
        output.printInfo('Creating WASM agent...');
        info = await wasm.createWasmAgent({
          model: ctx.flags.model as string | undefined,
          instructions: ctx.flags.instructions as string | undefined,
          maxTurns: ctx.flags.maxTurns as number | undefined,
        });
      }

      if (ctx.flags.format === 'json') {
        output.printJson({ success: true, agent: info, source: template ? 'gallery' : 'custom' });
        return { success: true, data: info };
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 45 },
        ],
        data: [
          { property: 'ID', value: info.id },
          { property: 'State', value: info.state },
          { property: 'Model', value: info.model },
          { property: 'Turn Count', value: String(info.turnCount) },
          { property: 'File Count', value: String(info.fileCount) },
          { property: 'Created', value: info.createdAt },
          ...(template ? [{ property: 'Template', value: template }] : []),
        ],
      });

      output.writeln();
      output.printSuccess(`WASM agent created: ${info.id}`);

      return { success: true, data: info };
    } catch (error) {
      output.printError(`Failed to create WASM agent: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// agent wasm-prompt
export const wasmPromptCommand: Command = {
  name: 'wasm-prompt',
  description: 'Send a prompt to a WASM agent',
  options: [
    {
      name: 'agent-id',
      short: 'a',
      description: 'WASM agent ID (required)',
      type: 'string',
    },
    {
      name: 'input',
      short: 'i',
      description: 'Prompt text to send',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow agent wasm-prompt -a wasm-agent-1-abc -i "Write a hello world"', description: 'Send prompt to WASM agent' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.flags.agentId as string || ctx.args[0];
    const promptInput = ctx.flags.input as string || ctx.args[1];

    if (!agentId) {
      output.printError('Agent ID is required. Use --agent-id or -a');
      return { success: false, exitCode: 1 };
    }
    if (!promptInput) {
      output.printError('Prompt input is required. Use --input or -i');
      return { success: false, exitCode: 1 };
    }

    try {
      const wasm = await loadWasm();
      const available = await wasm.isAgentWasmAvailable();
      if (!available) {
        output.printError(WASM_NOT_AVAILABLE_MSG);
        return { success: false, exitCode: 1 };
      }

      output.printInfo(`Sending prompt to ${output.highlight(agentId)}...`);
      const result = await wasm.promptWasmAgent(agentId, promptInput);

      if (ctx.flags.format === 'json') {
        output.printJson({ agentId, response: result });
        return { success: true, data: { agentId, response: result } };
      }

      output.writeln();
      output.writeln(output.bold('Response'));
      output.writeln();
      output.writeln(result);

      // Show updated agent info
      const info = wasm.getWasmAgent(agentId);
      if (info) {
        output.writeln();
        output.writeln(output.dim(`[turns: ${info.turnCount}, files: ${info.fileCount}, state: ${info.state}]`));
      }

      return { success: true, data: { agentId, response: result } };
    } catch (error) {
      output.printError(`Prompt failed: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// agent wasm-gallery
export const wasmGalleryCommand: Command = {
  name: 'wasm-gallery',
  description: 'List available WASM agent gallery templates',
  options: [
    {
      name: 'search',
      short: 's',
      description: 'Search templates by query',
      type: 'string',
    },
    {
      name: 'category',
      short: 'c',
      description: 'Filter by category',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow agent wasm-gallery', description: 'List all gallery templates' },
    { command: 'claude-flow agent wasm-gallery -s coder', description: 'Search gallery templates' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const wasm = await loadWasm();
      const available = await wasm.isAgentWasmAvailable();
      if (!available) {
        output.printError(WASM_NOT_AVAILABLE_MSG);
        return { success: false, exitCode: 1 };
      }

      const searchQuery = ctx.flags.search as string | undefined;
      const category = ctx.flags.category as string | undefined;

      let templates;
      if (searchQuery) {
        output.printInfo(`Searching gallery for: ${output.highlight(searchQuery)}`);
        templates = await wasm.searchGalleryTemplates(searchQuery);
      } else {
        templates = await wasm.listGalleryTemplates();
      }

      // Filter by category if specified
      if (category) {
        templates = templates.filter((t: { category: string }) =>
          t.category.toLowerCase() === category.toLowerCase()
        );
      }

      if (ctx.flags.format === 'json') {
        output.printJson({ templates, count: templates.length });
        return { success: true, data: { templates, count: templates.length } };
      }

      output.writeln();
      output.writeln(output.bold('WASM Agent Gallery'));
      output.writeln();

      if (templates.length === 0) {
        output.printInfo('No templates found matching criteria');
        return { success: true, data: { templates: [], count: 0 } };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'name', header: 'Name', width: 18 },
          { key: 'category', header: 'Category', width: 12 },
          { key: 'description', header: 'Description', width: 35 },
          { key: 'version', header: 'Version', width: 10 },
        ],
        data: templates.map((t: { id: string; name: string; category: string; description: string; version: string }) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description.length > 35 ? t.description.slice(0, 32) + '...' : t.description,
          version: t.version,
        })),
      });

      output.writeln();
      output.printInfo(`${templates.length} template(s) found. Create with: agent wasm-create -t <id>`);

      return { success: true, data: { templates, count: templates.length } };
    } catch (error) {
      output.printError(`Gallery listing failed: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/** All WASM subcommands for the agent command */
export const wasmSubcommands: Command[] = [
  wasmStatusCommand,
  wasmCreateCommand,
  wasmPromptCommand,
  wasmGalleryCommand,
];
