/**
 * Tests for WASM Agent MCP Tools
 *
 * ADR-129: Validates all MCP tool handlers (10 original + 17 new P2/P3/P4).
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock the agent-wasm module ───────────────────────────────

const mockAgentInfo = {
  id: 'wasm-agent-1-test',
  state: 'idle' as const,
  config: {},
  model: 'test-model',
  turnCount: 0,
  fileCount: 0,
  isStopped: false,
  createdAt: '2026-03-17T00:00:00.000Z',
};

vi.mock('../src/ruvector/agent-wasm.js', () => ({
  isAgentWasmAvailable: vi.fn().mockResolvedValue(true),
  initAgentWasm: vi.fn().mockResolvedValue(undefined),
  createWasmAgent: vi.fn().mockResolvedValue({ ...mockAgentInfo }),
  promptWasmAgent: vi.fn().mockResolvedValue('Agent response'),
  executeWasmTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
  getWasmAgent: vi.fn().mockReturnValue({ ...mockAgentInfo }),
  listWasmAgents: vi.fn().mockReturnValue([{ ...mockAgentInfo }]),
  terminateWasmAgent: vi.fn().mockReturnValue(true),
  resetWasmAgent: vi.fn().mockReturnValue(true),
  getWasmAgentState: vi.fn().mockReturnValue({ messages: [], turn_count: 0 }),
  getWasmAgentTools: vi.fn().mockReturnValue(['read_file', 'write_file']),
  getWasmAgentTodos: vi.fn().mockReturnValue([]),
  exportWasmState: vi.fn().mockReturnValue('{"state":"exported"}'),
  createWasmMcpServer: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue('{}')),
  listGalleryTemplates: vi.fn().mockResolvedValue([{ id: 'coder', name: 'Coder Agent' }]),
  getGalleryCount: vi.fn().mockResolvedValue(6),
  getGalleryCategories: vi.fn().mockResolvedValue({ development: 2 }),
  searchGalleryTemplates: vi.fn().mockResolvedValue([{ id: 'coder', name: 'Coder Agent', relevance: 0.7 }]),
  getGalleryTemplate: vi.fn().mockResolvedValue({ id: 'coder', prompts: [], tools: [], skills: [] }),
  createAgentFromTemplate: vi.fn().mockResolvedValue({ ...mockAgentInfo, id: 'wasm-agent-2-tpl' }),
  buildRvfContainer: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  buildRvfFromTemplate: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  // ADR-129 P3 gallery CRUD
  galleryLoadRvf: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  galleryConfigure: vi.fn().mockResolvedValue(undefined),
  galleryListByCategory: vi.fn().mockResolvedValue([{ id: 'coder', name: 'Coder Agent' }]),
  galleryAddCustom: vi.fn().mockResolvedValue(undefined),
  galleryRemoveCustom: vi.fn().mockResolvedValue(undefined),
  galleryImportCustom: vi.fn().mockResolvedValue(1),
  galleryExportCustom: vi.fn().mockResolvedValue([{ id: 'custom-1' }]),
  galleryGetActive: vi.fn().mockResolvedValue('coder'),
  galleryGetConfig: vi.fn().mockResolvedValue({ maxTurns: 50 }),
}));

// AIDefence gate for wasm_gallery_import — controllable per-test
const mockAIDefenceScan = vi.fn().mockResolvedValue({ isThreat: false });
vi.mock('@claude-flow/aidefence', () => ({
  createAIDefence: vi.fn().mockReturnValue({ scan: mockAIDefenceScan }),
}));

import { wasmAgentTools } from '../src/mcp-tools/wasm-agent-tools.js';

// ── Helper ───────────────────────────────────────────────────

function findTool(name: string) {
  const tool = wasmAgentTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return findTool(name).handler(args);
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ── Tests ────────────────────────────────────────────────────

// Same WASM-init issue as agent-wasm.test.ts — mocks intercept the
// agent-wasm module but the real @ruvector/rvagent-wasm package still
// loads transitively and crashes in CI without prebuilds.
const __SKIP_WASM_TESTS = process.env.CI === 'true';

describe.skipIf(__SKIP_WASM_TESTS)('wasm-agent-tools MCP', () => {
  it('exports 27 tools (10 original + 17 new ADR-129 P2/P3/P4)', () => {
    expect(wasmAgentTools).toHaveLength(27);
  });

  it('all tools have required fields', () => {
    for (const tool of wasmAgentTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  describe('wasm_agent_create', () => {
    it('creates with config', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { instructions: 'Test' }));
      expect(data.success).toBe(true);
      expect(data.agent.id).toBe('wasm-agent-1-test');
    });

    it('creates from template', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { template: 'coder' }));
      expect(data.success).toBe(true);
      expect(data.source).toBe('gallery');
    });
  });

  it('wasm_agent_prompt returns response', async () => {
    const result = await callTool('wasm_agent_prompt', { agentId: 'test', input: 'Hello' });
    expect(result.content[0].text).toBe('Agent response');
  });

  it('wasm_agent_tool executes tool', async () => {
    const result = await callTool('wasm_agent_tool', { agentId: 'test', toolName: 'read_file', toolInput: { path: 'x' } });
    const text = result.content[0].text;
    expect(text).toContain('success');
  });

  it('wasm_agent_list lists agents', async () => {
    const data = parseResult(await callTool('wasm_agent_list'));
    expect(data.count).toBe(1);
  });

  it('wasm_agent_terminate terminates', async () => {
    const data = parseResult(await callTool('wasm_agent_terminate', { agentId: 'test' }));
    expect(data.success).toBe(true);
  });

  it('wasm_agent_files lists files', async () => {
    const result = await callTool('wasm_agent_files', { agentId: 'test' });
    expect(result.content[0].text).toContain('read_file');
  });

  it('wasm_agent_export exports state', async () => {
    const result = await callTool('wasm_agent_export', { agentId: 'test' });
    expect(result.content[0].text).toBe('{"state":"exported"}');
  });

  it('wasm_gallery_list lists templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_list'));
    expect(data.count).toBe(1);
    expect(data.templates[0].id).toBe('coder');
  });

  it('wasm_gallery_search finds templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_search', { query: 'code' }));
    expect(data.count).toBe(1);
  });

  it('wasm_gallery_create creates from template', async () => {
    const data = parseResult(await callTool('wasm_gallery_create', { template: 'coder' }));
    expect(data.success).toBe(true);
    expect(data.template).toBe('coder');
  });

  // ── ADR-129 P3 — Agent introspection tools (#4765) ────────────────────────

  describe('wasm_agent introspection', () => {
    it('wasm_agent_state returns the internal state', async () => {
      const data = parseResult(await callTool('wasm_agent_state', { agentId: 'wasm-agent-1-test' }));
      expect(data.agentId).toBe('wasm-agent-1-test');
      expect(data.state).toEqual({ messages: [], turn_count: 0 });
    });

    it('wasm_agent_todos returns the todo list', async () => {
      const data = parseResult(await callTool('wasm_agent_todos', { agentId: 'wasm-agent-1-test' }));
      expect(data.agentId).toBe('wasm-agent-1-test');
      expect(data.todos).toEqual([]);
    });

    it('wasm_agent_tools lists registered tools', async () => {
      const data = parseResult(await callTool('wasm_agent_tools', { agentId: 'wasm-agent-1-test' }));
      expect(data.agentId).toBe('wasm-agent-1-test');
      expect(data.tools).toEqual(['read_file', 'write_file']);
    });

    it('wasm_agent_turn_count returns the turn count', async () => {
      const data = parseResult(await callTool('wasm_agent_turn_count', { agentId: 'wasm-agent-1-test' }));
      expect(data.agentId).toBe('wasm-agent-1-test');
      expect(data.turnCount).toBe(0);
    });

    it('wasm_agent_turn_count errors for a missing agent', async () => {
      const { getWasmAgent } = await import('../src/ruvector/agent-wasm.js');
      vi.mocked(getWasmAgent).mockReturnValueOnce(null as never);
      const result = await callTool('wasm_agent_turn_count', { agentId: 'gone' });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain('Agent not found: gone');
    });

    it('wasm_agent_is_stopped reports the stop flag', async () => {
      const data = parseResult(await callTool('wasm_agent_is_stopped', { agentId: 'wasm-agent-1-test' }));
      expect(data.agentId).toBe('wasm-agent-1-test');
      expect(data.isStopped).toBe(false);
    });

    it('wasm_agent_is_stopped errors for a missing agent', async () => {
      const { getWasmAgent } = await import('../src/ruvector/agent-wasm.js');
      vi.mocked(getWasmAgent).mockReturnValueOnce(null as never);
      const result = await callTool('wasm_agent_is_stopped', { agentId: 'gone' });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toContain('Agent not found: gone');
    });

    it('wasm_agent_reset clears the agent', async () => {
      const data = parseResult(await callTool('wasm_agent_reset', { agentId: 'wasm-agent-1-test' }));
      expect(data.success).toBe(true);
      expect(data.agentId).toBe('wasm-agent-1-test');
    });

    it('rejects an invalid agentId with an error envelope', async () => {
      const result = await callTool('wasm_agent_state', { agentId: '../escape attempt' });
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toBeTruthy();
    });
  });

  // ── ADR-129 P3 — Gallery CRUD, listing and config (#4765) ─────────────────

  describe('wasm_gallery listing and config', () => {
    it('wasm_gallery_categories lists categories with counts', async () => {
      const data = parseResult(await callTool('wasm_gallery_categories'));
      expect(data.categories).toEqual({ development: 2 });
    });

    it('wasm_gallery_list_by_category filters templates', async () => {
      const data = parseResult(await callTool('wasm_gallery_list_by_category', { category: 'development' }));
      expect(data.category).toBe('development');
      expect(data.templates).toEqual([{ id: 'coder', name: 'Coder Agent' }]);
    });

    it('wasm_gallery_configure applies overrides', async () => {
      const data = parseResult(await callTool('wasm_gallery_configure', { config: { maxTurns: 100 } }));
      expect(data.success).toBe(true);
    });

    it('wasm_gallery_config returns the active overrides', async () => {
      const data = parseResult(await callTool('wasm_gallery_config'));
      expect(data.config).toEqual({ maxTurns: 50 });
    });

    it('wasm_gallery_active returns the active template id', async () => {
      const data = parseResult(await callTool('wasm_gallery_active'));
      expect(data.activeId).toBe('coder');
    });

    it('wasm_gallery_load_rvf returns a base64 container', async () => {
      const data = parseResult(await callTool('wasm_gallery_load_rvf', { id: 'coder' }));
      expect(data.id).toBe('coder');
      expect(data.sizeBytes).toBe(4);
      expect(data.rvfBase64).toBe('UlZGAQ==');
    });
  });

  describe('wasm_gallery custom templates', () => {
    it('wasm_gallery_add_custom registers a template', async () => {
      const data = parseResult(await callTool('wasm_gallery_add_custom', { template: { id: 'mine', name: 'Mine' } }));
      expect(data.success).toBe(true);
    });

    it('wasm_gallery_remove_custom removes by id', async () => {
      const data = parseResult(await callTool('wasm_gallery_remove_custom', { id: 'mine' }));
      expect(data.success).toBe(true);
      expect(data.id).toBe('mine');
    });
  });

  // ── Import/export round-trips (#4765) ──────────────────────────────────────

  describe('wasm_gallery import/export', () => {
    it('wasm_gallery_export returns the custom templates', async () => {
      const data = parseResult(await callTool('wasm_gallery_export'));
      expect(data.exported).toEqual([{ id: 'custom-1' }]);
    });

    it('wasm_gallery_import imports a JSON payload with a count', async () => {
      const data = parseResult(
        await callTool('wasm_gallery_import', { templatesJson: '[{"id":"custom-1"}]' }),
      );
      expect(data.success).toBe(true);
      expect(data.importedCount).toBe(1);
    });

    it('round-trips export output back into import', async () => {
      const exported = parseResult(await callTool('wasm_gallery_export'));
      const roundTripped = parseResult(
        await callTool('wasm_gallery_import', { templatesJson: JSON.stringify(exported.exported) }),
      );
      expect(roundTripped.success).toBe(true);
      expect(roundTripped.importedCount).toBe(1);
    });

    it('wasm_gallery_import blocks payloads flagged by AIDefence', async () => {
      mockAIDefenceScan.mockResolvedValueOnce({ isThreat: true });
      const result = await callTool('wasm_gallery_import', { templatesJson: '[{"id":"evil"}]' });
      expect(result.isError).toBe(true);
      expect(parseResult(result).HIGH_RISK).toBe(true);
    });
  });

  // ── ADR-129 P2/P4 — wasm_agent_compose (#4765) ─────────────────────────────

  describe('wasm_agent_compose', () => {
    it('composes an RVF container and reports the manifest', async () => {
      const data = parseResult(
        await callTool('wasm_agent_compose', { skills: ['review'], mcpTools: ['memory_search'] }),
      );
      expect(data.success).toBe(true);
      expect(data.rvfBase64).toBe('UlZGAQ==');
      expect(data.manifest.skills).toEqual(['review']);
      expect(data.manifest.mcpTools).toEqual(['memory_search']);
      expect(data.manifest.rvfSizeBytes).toBe(4);
    });

    it('blocks destructive tools without an explicit opt-in', async () => {
      const result = await callTool('wasm_agent_compose', { mcpTools: ['memory_delete'] });
      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.blockedTools).toEqual(['memory_delete']);
      expect(data.error).toContain('mcpToolsAllowDestructive');
    });

    it('allows destructive tools with mcpToolsAllowDestructive', async () => {
      const data = parseResult(
        await callTool('wasm_agent_compose', {
          mcpTools: ['memory_delete'],
          mcpToolsAllowDestructive: true,
        }),
      );
      expect(data.success).toBe(true);
      expect(data.manifest.mcpTools).toEqual(['memory_delete']);
    });

    it('warns about missing plugins instead of failing', async () => {
      const data = parseResult(
        await callTool('wasm_agent_compose', { includePlugins: ['no-such-plugin'] }),
      );
      expect(data.success).toBe(true);
      expect(data.manifest.pluginWarnings).toEqual(['Plugin not found: no-such-plugin (skipped)']);
    });
  });
});
