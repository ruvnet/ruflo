import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function getAdrStats(cwd: string): {
  count: number;
  implemented: number;
} {
  const adrPaths = [
    join(cwd, "v3", "implementation", "adrs"),
    join(cwd, "docs", "adrs"),
    join(cwd, "docs", "adr"),
    join(cwd, ".claude-flow", "adrs"),
  ];

  for (const adrPath of adrPaths) {
    try {
      if (!existsSync(adrPath)) continue;
      const files = readdirSync(adrPath).filter(
        (file) =>
          file.endsWith(".md") &&
          (file.startsWith("ADR-") ||
            file.startsWith("adr-") ||
            /^\d{4}-/.test(file)),
      );
      if (files.length === 0) continue;

      let implemented = 0;
      for (const file of files) {
        try {
          const content = readFileSync(join(adrPath, file), "utf-8");
          if (/Status\s*[:\*]*\s*(Accepted|Implemented)/i.test(content))
            implemented++;
        } catch {
          /* unreadable ADR does not count as implemented */
        }
      }
      return { count: files.length, implemented };
    } catch {
      /* inaccessible directory; try the next one */
    }
  }
  return { count: 0, implemented: 0 };
}
