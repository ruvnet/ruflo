import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';
import { systemTools } from '../src/mcp-tools/system-tools.js';

type AnyTool = { name: string; handler: (input: any) => Promise<any> };

function tool(tools: AnyTool[], name: string): AnyTool {
  const found = tools.find(candidate => candidate.name === name);
  if (!found) throw new Error(`tool not registered: ${name}`);
  return found;
}

let projectDir: string;
let previousCwd: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ruflo-2967-'));
  previousCwd = process.env.CLAUDE_FLOW_CWD;
  process.env.CLAUDE_FLOW_CWD = projectDir;
});

afterEach(() => {
  if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = previousCwd;
  rmSync(projectDir, { recursive: true, force: true });
});

describe('system_health swarm state (#2967)', () => {
  it('reports a persisted running swarm as healthy', async () => {
    const initialized = await tool(swarmTools, 'swarm_init').handler({});
    const result = await tool(systemTools, 'system_health').handler({});
    const swarmCheck = result.checks.find((check: { name: string }) => check.name === 'swarm');

    expect(initialized.success).toBe(true);
    expect(swarmCheck).toMatchObject({
      status: 'healthy',
      latency: expect.any(Number),
      message: `1 running swarm (${initialized.swarmId})`,
    });
  });

  it('reports no active swarm as advisory', async () => {
    const result = await tool(systemTools, 'system_health').handler({});
    const swarmCheck = result.checks.find((check: { name: string }) => check.name === 'swarm');

    expect(swarmCheck).toMatchObject({
      status: 'unknown',
      latency: expect.any(Number),
      message: 'No active swarm — run swarm_init',
    });
  });
});
