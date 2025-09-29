// NOTE: Adjust import path for MCPClientManager to match actual source location.
// Test framework detected: unknown. This test uses standard describe/it/expect style and vi/jest fns for mocks.
/*
  Suite: MCPClientManager
  Focus: Unit tests for connect, disconnect, listTools, executeTool, and error paths.
  Notes:
  - Uses a lightweight mock for ILogger with .info as a spy-capable function (vi.fn/jest.fn fallback).
  - If using Vitest: import { describe, it, expect, vi } from '@jest/globals'
  - If using Jest: the global jest.fn is used; adjust imports if required by your setup.
*/

import { EventEmitter } from 'events';

// Try both import styles; adjust as needed based on actual source file location.
// Replace the path below to the actual source file if different.
import { MCPClientManager } from '../../src/mcp/MCPClientManager';
type ILogger = { info: (...args: any[]) => void };

const isFn = (f: any) => typeof f === 'function';
const makeSpy = () => {
  // vitest's vi.fn or jest.fn or a simple manual spy fallback
  const g: any = (globalThis as any);
  if (g.vi && isFn(g.vi.fn)) return g.jest.fn();
  if (g.jest && isFn(g.jest.fn)) return g.jest.fn();
  // minimal manual spy
  const calls: any[] = [];
  const spy = (...args: any[]) => { calls.push(args); };
  (spy as any).mock = { calls };
  return spy as any;
};

describe('MCPClientManager', () => {
  const makeLogger = (): ILogger => ({ info: makeSpy() });

  it('should be an EventEmitter instance', () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);
    expect(mgr).toBeInstanceOf(EventEmitter);
  });

  it('connect: stores client, returns it, and logs', async () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);

    const name = 'serverA';
    const command = '/bin/run';
    const args = ['--flag', 'value'];
    const env = { FOO: 'bar' };

    const client = await mgr.connect(name, command, args, env);
    expect(client).toEqual({ name, command, args, env });

    // Validate we can execute a tool after connect (indirectly proves client stored)
    const res = await mgr.executeTool(name, 'noop', {});
    expect(res).toEqual({ result: {} });

    // Logger info called with Connecting to <name>
    const info = (logger.info as any);
    if (info.mock?.calls) {
      const concatenated = info.mock.calls.map((c: any[]) => c.join(' ')).join(' | ');
      expect(concatenated).toMatch(`Connecting to ${name}`);
    }
  });

  it('disconnect: removes client and logs; safe to call on unknown server', async () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);

    const name = 'serverB';
    await mgr.connect(name, 'cmd', [], {});

    await mgr.disconnect(name);
    // Now executeTool should throw since client was removed
    await expect(mgr.executeTool(name, 'x', {} as any)).rejects.toThrowError(`No connection to server: ${name}`);

    // Calling disconnect on unknown server should not throw
    await expect(mgr.disconnect('missing')).resolves.toBeUndefined();

    const info = (logger.info as any);
    if (info.mock?.calls) {
      const concatenated = info.mock.calls.map((c: any[]) => c.join(' ')).join(' | ');
      expect(concatenated).toMatch(`Disconnecting from ${name}`);
      expect(concatenated).toMatch('Disconnecting from missing');
    }
  });

  it('listTools: returns empty array and logs, regardless of connection state', async () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);

    const before = await mgr.listTools('no-connection');
    expect(Array.isArray(before)).toBe(true);
    expect(before).toHaveLength(0);

    await mgr.connect('serverC', 'cmd', [], {});
    const after = await mgr.listTools('serverC');
    expect(Array.isArray(after)).toBe(true);
    expect(after).toHaveLength(0);

    const info = (logger.info as any);
    if (info.mock?.calls) {
      const concatenated = info.mock.calls.map((c: any[]) => c.join(' ')).join(' | ');
      expect(concatenated).toMatch('Listing tools from no-connection');
      expect(concatenated).toMatch('Listing tools from serverC');
    }
  });

  it('executeTool: throws when no client connection exists', async () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);
    await expect(mgr.executeTool('unknown', 'do', {})).rejects.toThrowError('No connection to server: unknown');
  });

  it('connect: tolerates empty strings and unusual env; still usable by executeTool', async () => {
    const logger = makeLogger();
    const mgr = new MCPClientManager(logger as any);

    const client = await mgr.connect('', '', [], {} as any);
    expect(client).toEqual({ name: '', command: '', args: [], env: {} });

    const res = await mgr.executeTool('', 'noop', { any: 'payload' });
    expect(res).toEqual({ result: {} });
  });
});