// Dream Cycle 2026-10-01 (security): the MCP HTTP transport's
// `startHttpServer()` called `createMCPServer()` without ever setting
// `requireToolAuthorization` or installing a `toolAuthorizer`. Since
// @claude-flow/mcp's tool-call authorization is fully opt-in
// (ToolRegistry.authorizer is only consulted `if (this.authorizer)`), every
// one of the CLI's 300+ registered MCP tools (memory_*, hooks_*, agentdb_*,
// hive-mind_*, ...) was callable with zero authorization check whenever the
// server was reachable — and `--host` is a live, user-facing flag that can
// bind it off loopback. This is the same shape as CVE-2026-81735 (CVSS
// 10/10, UI-TARS-desktop mcp-http-server): an optional auth hook the
// integrating CLI never wired, combined with a non-loopback-capable bind.
//
// Fix: `startHttpServer()` now refuses to start when the configured host is
// not loopback (localhost/127.0.0.1/::1) unless the operator explicitly sets
// RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1. Default/loopback behavior (the
// common case, exercised by mcp-http-foreground-2984 and
// mcp-http-protocol-tools-2990) is unchanged.
//
// These are pure, synchronous unit tests against the three exported
// functions that make up the gate's full decision contract. An earlier
// version of this file instead spawned the built CLI end-to-end
// (node bin/cli.js mcp start ...), matching the pattern
// mcp-http-foreground-2984.test.ts/mcp-http-protocol-tools-2990.test.ts use
// — but this repo's CI "Test Suite" job never builds @claude-flow/cli's own
// dist/ (only @claude-flow/security and @claude-flow/cli-core get a
// targeted build step there, per .github/workflows/ci.yml), which is why
// those two existing files are both already listed in
// scripts/ci-test-baseline.txt as known-failing in CI. Rather than add a
// third entry to that baseline (its own header: "Never add entries to make
// a regression green"), this file tests the real exported decision logic
// directly — no process spawn, no port bind, no build dependency — which
// fully pins down the behavior these manual end-to-end checks verified
// during development (see the PR/issue evidence: baseline-fails/
// candidate-passes via git-stash, a live spawned server demonstrably
// serving /health unauthenticated pre-fix and refusing to start post-fix).

import { describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  isUnauthenticatedHttpAllowed,
  shouldRefuseUnauthenticatedHttp,
} from '../src/mcp-server.js';

describe('isLoopbackHost', () => {
  it('is true for exactly the three recognized loopback spellings', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('is false (fails closed) for anything not spelled exactly one of those three', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
    // Case variants and bracketed forms are NOT normalized — conservative
    // (fail-closed) direction: an operator relying on one of these would
    // need the explicit opt-out, not a silent bypass of the gate.
    expect(isLoopbackHost('LOCALHOST')).toBe(false);
    expect(isLoopbackHost('[::1]')).toBe(false);
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(false);
  });
});

describe('isUnauthenticatedHttpAllowed', () => {
  it('is false when unset', () => {
    expect(isUnauthenticatedHttpAllowed({})).toBe(false);
  });

  it('is false for arbitrary truthy-looking strings', () => {
    expect(isUnauthenticatedHttpAllowed({ RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: 'yes' })).toBe(false);
    expect(isUnauthenticatedHttpAllowed({ RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: '0' })).toBe(false);
    expect(isUnauthenticatedHttpAllowed({ RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: 'false' })).toBe(false);
  });

  it('is true only for the documented opt-out values', () => {
    expect(isUnauthenticatedHttpAllowed({ RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: '1' })).toBe(true);
    expect(isUnauthenticatedHttpAllowed({ RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: 'true' })).toBe(true);
  });
});

describe('shouldRefuseUnauthenticatedHttp (the full startHttpServer gate)', () => {
  it('refuses a non-loopback host with no opt-out — the vulnerability this candidate closes', () => {
    expect(shouldRefuseUnauthenticatedHttp('0.0.0.0', {})).toBe(true);
  });

  it('allows a non-loopback host when the explicit opt-out is set', () => {
    expect(
      shouldRefuseUnauthenticatedHttp('0.0.0.0', { RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: '1' }),
    ).toBe(false);
  });

  it('allows every loopback host regardless of the opt-out — default behavior is unchanged', () => {
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      expect(shouldRefuseUnauthenticatedHttp(host, {})).toBe(false);
      expect(
        shouldRefuseUnauthenticatedHttp(host, { RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP: '1' }),
      ).toBe(false);
    }
  });
});
