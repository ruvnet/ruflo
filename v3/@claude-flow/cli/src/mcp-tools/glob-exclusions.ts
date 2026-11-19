/** Bounded glob matching for caller-provided memory-import exclusions. */
export const MAX_EXCLUDE_PATTERNS = 64;
export const MAX_EXCLUDE_PATTERN_LENGTH = 1024;
export const MAX_EXCLUDE_WILDCARDS = 32;

type Token = { kind: 'literal'; value: string } | { kind: 'star' | 'globstar' | 'question' };

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  let wildcards = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      let end = i + 1;
      while (pattern[end] === '*') end++;
      tokens.push({ kind: end - i > 1 ? 'globstar' : 'star' });
      // Preserve the trailing segment-star in odd runs, including its newline behavior.
      if (end - i > 1 && (end - i) % 2 === 1) {
        tokens.push({ kind: 'star' });
        wildcards++;
      }
      i = end - 1;
      wildcards++;
    } else if (char === '?') {
      tokens.push({ kind: 'question' });
      wildcards++;
    } else {
      tokens.push({ kind: 'literal', value: char });
    }
  }
  if (wildcards > MAX_EXCLUDE_WILDCARDS) {
    throw new Error(`excludeFilePatterns entries may contain at most ${MAX_EXCLUDE_WILDCARDS} wildcard operators`);
  }
  return tokens;
}

function matches(tokens: Token[], path: string): boolean {
  // Each path character visits each token once; wildcard placement cannot cause backtracking.
  let previous = new Uint8Array(tokens.length + 1);
  let current = new Uint8Array(tokens.length + 1);
  previous[0] = 1;
  for (let j = 1; j <= tokens.length; j++) {
    const token = tokens[j - 1];
    if (token.kind === 'star' || token.kind === 'globstar') previous[j] = previous[j - 1];
  }
  for (let i = 0; i < path.length; i++) {
    current[0] = 0;
    const char = path[i];
    const inSegment = char !== '/' && char !== '\\';
    for (let j = 1; j <= tokens.length; j++) {
      const token = tokens[j - 1];
      if (token.kind === 'star' || token.kind === 'globstar') {
        const canConsume = token.kind === 'globstar'
          ? !'\n\r\u2028\u2029'.includes(char)
          : inSegment;
        current[j] = current[j - 1] || (canConsume ? previous[j] : 0);
      } else {
        const canConsume = token.kind === 'literal' ? token.value === char : inSegment;
        current[j] = canConsume ? previous[j - 1] : 0;
      }
    }
    [previous, current] = [current, previous];
  }
  return previous[tokens.length] === 1;
}

export function compileExclusionPatterns(input: unknown): Array<(path: string) => boolean> {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_EXCLUDE_PATTERNS) {
    throw new Error(`excludeFilePatterns must be an array of at most ${MAX_EXCLUDE_PATTERNS} patterns`);
  }
  return Array.from(input, (pattern: unknown) => {
    if (typeof pattern !== 'string' || pattern.length > MAX_EXCLUDE_PATTERN_LENGTH) {
      throw new Error(`excludeFilePatterns entries must be strings of at most ${MAX_EXCLUDE_PATTERN_LENGTH} characters`);
    }
    const tokens = tokenize(pattern);
    return (path: string) => matches(tokens, path);
  });
}
