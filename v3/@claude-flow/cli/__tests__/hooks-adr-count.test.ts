/**
 * Regression tests for #1047: Statusline ADR count hardcoded to 0/0
 *
 * The statusline displayed `ADRs ●0/0` but the count was never computed.
 * Fix: scan well-known ADR directories and count ADR markdown files.
 *
 * Tests verify:
 * 1. ADR scanning counts files in expected directories
 * 2. Only files matching ADR naming conventions are counted
 * 3. Accepted/Implemented status detection works
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAdrStats } from "../src/commands/adr-stats.js";

describe("ADR count in hooks statusline (#1047)", () => {
  let tmpDir: string;

  it("returns 0/0 when no ADR directory exists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "adr-test-"));
    try {
      const result = getAdrStats(tmpDir);
      expect(result.count).toBe(0);
      expect(result.implemented).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("counts ADR files in docs/adrs directory", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "adr-test-"));
    const adrDir = join(tmpDir, "docs", "adrs");
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(
      join(adrDir, "ADR-001-use-typescript.md"),
      "# ADR-001\n\nStatus: Proposed\n\nBody here.",
    );
    writeFileSync(
      join(adrDir, "ADR-002-use-vitest.md"),
      "# ADR-002\n\nStatus: Accepted\n\nBody here.",
    );
    writeFileSync(
      join(adrDir, "ADR-003-memory-backend.md"),
      "# ADR-003\n\nStatus: Implemented\n\nBody here.",
    );
    writeFileSync(join(adrDir, "README.md"), "# ADR Index"); // should not count

    try {
      const result = getAdrStats(tmpDir);
      expect(result.count).toBe(3); // 3 ADR- files, not README
      expect(result.implemented).toBe(2); // ADR-002 (Accepted) + ADR-003 (Implemented)
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("counts ADRs with bold markdown Status: **Accepted**", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "adr-test-"));
    const adrDir = join(tmpDir, "docs", "adrs");
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(
      join(adrDir, "ADR-010-bold-status.md"),
      "# ADR-010\n\n**Status**: Accepted\n\nBody.",
    );

    try {
      const result = getAdrStats(tmpDir);
      expect(result.count).toBe(1);
      expect(result.implemented).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("counts numeric-prefixed ADR files (e.g. 0001-use-postgres.md)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "adr-test-"));
    const adrDir = join(tmpDir, "docs", "adrs");
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(
      join(adrDir, "0001-use-postgres.md"),
      "# ADR\n\nStatus: Accepted\n",
    );
    writeFileSync(
      join(adrDir, "0002-use-redis.md"),
      "# ADR\n\nStatus: Proposed\n",
    );

    try {
      const result = getAdrStats(tmpDir);
      expect(result.count).toBe(2);
      expect(result.implemented).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
