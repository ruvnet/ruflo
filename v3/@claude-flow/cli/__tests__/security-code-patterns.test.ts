import { describe, expect, it } from 'vitest';
import { CODE_PATTERNS, codeLinesOf, isGeneratedReportAsset, withoutPlaceholders } from '../src/commands/security-code-patterns.js';

describe('withoutPlaceholders', () => {
  it('removes a numbered PostgreSQL placeholder in a value position', () => {
    expect(withoutPlaceholders('WHERE id = $${paramCount + 1} AND active')).toBe(
      'WHERE id =  AND active',
    );
  });

  it.each([
    "WHERE id = '$${n}'",
    'WHERE id = "$${n}"',
    'WHERE id = $${userInput}',
    'SELECT item$${n}',
  ])('preserves an interpolation that is not a value placeholder: %s', (line) => {
    expect(withoutPlaceholders(line)).toBe(line);
  });
});

describe('codeLinesOf', () => {
  it('removes comment text while retaining source line numbers and quoted URLs', () => {
    const content = [
      '// eval(example)',
      'const url = "https://example.org/path"; // element.innerHTML = value',
      '/* comment',
      ' * child_process.exec(example)',
      ' */ const result = eval(example);',
      'const total = /* note */ 2;',
    ].join('\n');

    expect(codeLinesOf(content).map((line) => line.trim().replace(/ +/g, ' '))).toEqual([
      '',
      'const url = "https://example.org/path";',
      '',
      '',
      'const result = eval(example);',
      'const total = 2;',
    ]);
  });
});

describe('isGeneratedReportAsset', () => {
  it.each([
    ['coverage', 'prettify.js', 'coverage-final.json'],
    ['coverage', 'lcov-report', 'lcov.info'],
    ['playwright-report', 'trace', 'index.html'],
    ['playwright-report', 'data', 'index.html'],
  ])('recognizes %s/%s only with the report marker', (parent, entry, marker) => {
    expect(isGeneratedReportAsset(parent, entry, (name) => name === marker)).toBe(true);
    expect(isGeneratedReportAsset(parent, entry, () => false)).toBe(false);
  });

  it('keeps unrelated files and unknown parent folders in the scan', () => {
    expect(isGeneratedReportAsset('coverage', 'application.js', () => true)).toBe(false);
    expect(isGeneratedReportAsset('src', 'prettify.js', () => true)).toBe(false);
    expect(isGeneratedReportAsset('constructor', 'trace', () => true)).toBe(false);
  });
});

describe('CODE_PATTERNS', () => {
  const examples = {
    'Eval Usage': 'window.eval(example)',
    innerHTML: 'element.innerHTML = example',
    'React XSS': 'const props = { dangerouslySetInnerHTML: example }',
    'Command Injection': "exec('echo ' + example)",
    'SQL Injection': 'const sql = `SELECT * FROM records WHERE id = ${example}`',
  };

  it('has a fixture for every registered pattern', () => {
    expect(CODE_PATTERNS.map(({ type }) => type).sort()).toEqual(Object.keys(examples).sort());
  });

  it.each(CODE_PATTERNS)('matches a representative $type line', ({ match, type }) => {
    const example = examples[type as keyof typeof examples];
    expect(example).toBeDefined();
    expect(match(example)).toBe(true);
  });

  it.each([
    '// eval(example)',
    'const record = retrieval (example)',
    'const sql = `SELECT * FROM records WHERE id = $${paramCount + 1}`',
  ])('does not report a finding for %s', (line) => {
    expect(CODE_PATTERNS.filter(({ match }) => match(codeLinesOf(line)[0]))).toEqual([]);
  });
});
