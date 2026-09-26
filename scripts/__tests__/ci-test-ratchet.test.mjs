import { describe, expect, it } from 'vitest';
import { evaluateTestReport, formatUnexpectedFailures } from '../ci-test-ratchet.mjs';

const root = '/repo';

describe('CI test failure ratchet (#3030)', () => {
  it('permits only failures already named by the baseline', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [
        { name: '/repo/tests/known.test.ts', status: 'failed' },
        { name: '/repo/tests/green.test.ts', status: 'passed' },
      ],
    }, ['tests/known.test.ts'], root);

    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('fails when a new file starts failing even if the total count is unchanged', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [{ name: '/repo/tests/new-regression.test.ts', status: 'failed' }],
    }, ['tests/old-debt.test.ts'], root);

    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['tests/new-regression.test.ts']);
    expect(result.fixed).toEqual(['tests/old-debt.test.ts']);
  });

  it('fails closed when Vitest fails without a file-level result', () => {
    const result = evaluateTestReport({ success: false, testResults: [] }, [], root);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/without identifying/);
  });

  it('fails closed for an empty or malformed report', () => {
    expect(evaluateTestReport({ success: true, testResults: [] }, [], root).ok).toBe(false);
    expect(evaluateTestReport({}, [], root).ok).toBe(false);
  });
});

describe('unexpected-failure output (#3208)', () => {
  const report = {
    testResults: [
      {
        name: '/repo/pkg/__tests__/scores.test.ts',
        status: 'failed',
        assertionResults: [
          { status: 'passed', fullName: 'suite passes', failureMessages: [] },
          {
            status: 'failed',
            fullName: 'suite preserves standard fallback on import failure',
            failureMessages: ['AssertionError: expected [ …(5) ] to deeply equal [ …(4) ]\n    at scores.test.ts:117:28'],
          },
        ],
      },
      { name: '/repo/pkg/__tests__/aborted.test.ts', status: 'failed', message: 'No test suite found in file\nsecond line' },
    ],
  };

  it('names the failing assertion and its first message line, not just the file', () => {
    expect(formatUnexpectedFailures(report, ['pkg/__tests__/scores.test.ts'], root)).toEqual([
      '  + pkg/__tests__/scores.test.ts',
      '      ✗ suite preserves standard fallback on import failure',
      '        AssertionError: expected [ …(5) ] to deeply equal [ …(4) ]',
    ]);
  });

  it('reports a file-level abort, which has a message and no assertions', () => {
    expect(formatUnexpectedFailures(report, ['pkg/__tests__/aborted.test.ts'], root)).toEqual([
      '  + pkg/__tests__/aborted.test.ts',
      '      No test suite found in file',
    ]);
  });

  it('still prints the filename when the report carries no detail for it', () => {
    expect(formatUnexpectedFailures(report, ['pkg/__tests__/absent.test.ts'], root))
      .toEqual(['  + pkg/__tests__/absent.test.ts']);
    expect(formatUnexpectedFailures({}, ['a.test.ts'], root)).toEqual(['  + a.test.ts']);
  });

  it('falls back to title when the reporter omits fullName', () => {
    const titleOnly = {
      testResults: [{
        name: '/repo/a.test.ts',
        assertionResults: [{ status: 'failed', title: 'bare title', failureMessages: [] }],
      }],
    };
    expect(formatUnexpectedFailures(titleOnly, ['a.test.ts'], root))
      .toEqual(['  + a.test.ts', '      ✗ bare title']);
  });
});
