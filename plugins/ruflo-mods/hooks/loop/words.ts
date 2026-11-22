/**
 * Bash word splitting for the learning loop's verifier and taint checks (#5067). One splitter, so the verifier
 * decision and the ADR-503 taints read a command the way the shell will run it.
 */

/**
 * Shell words of one segment, as bash splits them: quotes group (`-t "a --help b"` is two words, the second never a
 * flag), a quoted flag is still that flag (`'--listTests'`), an unquoted backslash escapes the next character, and
 * inside double quotes a backslash escapes only `$`, `` ` ``, `"` and `\\`. Comments are refused before this runs.
 */
export function shellWords(segment: string): string[] {
  const words: string[] = []
  let word = ''
  let quoted = false
  let quote: '' | "'" | '"' = ''
  const flush = () => {
    if (word !== '' || quoted) words.push(word)
    word = ''
    quoted = false
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote === "'") {
      if (c === "'") quote = ''
      else word += c
    } else if (quote === '"') {
      if (c === '"') quote = ''
      else if (c === '\\' && i + 1 < segment.length && '$`"\\'.includes(segment[i + 1]!)) word += segment[++i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      quoted = true
    } else if (c === '\\' && i + 1 < segment.length) word += segment[++i]
    else if (/\s/.test(c)) flush()
    else word += c
  }
  flush()
  return words
}

/**
 * Whether an unquoted, unescaped `#` starts a word, i.e. the shell would drop the rest of the command as a comment.
 * An escaped space does not end a word, so `a\\ #b` has no comment.
 */
export function hasComment(command: string): boolean {
  let quote = ''
  let wordStart = true
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote !== '') {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') i++
    } else if (c === "'" || c === '"') {
      quote = c
      wordStart = false
    } else if (c === '\\') {
      i++
      wordStart = false
    } else if (/\s/.test(c)) wordStart = true
    else if (c === '#' && wordStart) return true
    else wordStart = false
  }
  return false
}
