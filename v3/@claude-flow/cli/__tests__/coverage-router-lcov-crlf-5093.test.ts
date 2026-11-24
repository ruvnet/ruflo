import { describe, expect, it } from 'vitest';
import { CoverageRouter } from '../src/ruvector/coverage-router';

describe('CoverageRouter LCOV line endings', () => {
  it.each([
    {
      name: 'keeps both CRLF records and computes weighted coverage',
      lcov: ['SF:a.ts', 'LF:10', 'LH:5', 'end_of_record', 'SF:b.ts', 'LF:20', 'LH:15', 'end_of_record'].join('\r\n'),
      files: [{ path: 'a.ts', lineCoverage: 50 }, { path: 'b.ts', lineCoverage: 75 }],
      overall: 200 / 3,
    },
    {
      name: 'routes a single CRLF critical file instead of skipping it',
      lcov: ['SF:src/auth/login.ts', 'LF:10', 'LH:1', 'end_of_record'].join('\r\n'),
      files: [{ path: 'src/auth/login.ts', lineCoverage: 10 }],
      overall: 10,
      uncoveredCritical: ['src/auth/login.ts'],
      route: true,
    },
    {
      name: 'flushes an LF record without end_of_record',
      lcov: ['SF:src/truncated.ts', 'LF:8', 'LH:4'].join('\n'),
      files: [{ path: 'src/truncated.ts', lineCoverage: 50 }],
      overall: 50,
    },
  ])('$name', ({ lcov, files, overall, uncoveredCritical, route }) => {
    const router = new CoverageRouter();
    const report = router.parseCoverage(lcov, 'lcov');

    expect(report.byFile).toHaveLength(files.length);
    files.forEach((file, index) => expect(report.byFile[index]).toMatchObject(file));
    expect(report.overall).toBeCloseTo(overall);
    if (uncoveredCritical) expect(report.uncoveredCritical).toEqual(uncoveredCritical);
    if (route) expect(router.route(report).action).not.toBe('skip');
  });
});
