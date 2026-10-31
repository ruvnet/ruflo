/**
 * Vendored from midstream `AIMDS/src/detection/normalize.ts` at commit abe78d6.
 * Detection-only: output of this module is matched against, never shown to users.
 */

/**
 * Text normalisation for injection detection.
 *
 * Produces a canonical form (NFKC, zero-width stripped, confusables folded,
 * whitespace collapsed) plus a small set of bounded variants that undo common
 * obfuscations (separator-joined words, single-character spacing, leetspeak,
 * whitespace removal). Every transform is linear in input length.
 */

/** Zero-width and invisible formatting code points that carry no text. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u180E]/g;

/**
 * Explicit confusables map: Cyrillic and Greek letters whose glyphs are
 * indistinguishable from Latin ones. NFKC does not fold these.
 */
const CONFUSABLES: Record<string, string> = {
  'а': 'a', 'А': 'A', // а А
  'е': 'e', 'Е': 'E', // е Е
  'о': 'o', 'О': 'O', // о О
  'р': 'p', 'Р': 'P', // р Р
  'с': 'c', 'С': 'C', // с С
  'у': 'y', 'У': 'Y', // у У
  'х': 'x', 'Х': 'X', // х Х
  'і': 'i', 'І': 'I', // і І
  'ј': 'j', 'Ј': 'J', // ј Ј
  'һ': 'h', 'Һ': 'H', // һ Һ
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'ѕ': 's', 'Ѕ': 'S', // ѕ Ѕ
  'в': 'B', 'В': 'B', // в В (visually B in caps)
  'к': 'k', 'К': 'K', // к К
  'м': 'm', 'М': 'M', // м М
  'н': 'H', 'Н': 'H', // н Н
  'т': 'T', 'Т': 'T', // т Т
  'α': 'a', 'Α': 'A', // α Α
  'ε': 'e', 'Ε': 'E', // ε Ε
  'ο': 'o', 'Ο': 'O', // ο Ο
  'ρ': 'p', 'Ρ': 'P', // ρ Ρ
  'ι': 'i', 'Ι': 'I', // ι Ι
  'κ': 'k', 'Κ': 'K', // κ Κ
  'ν': 'v', 'Ν': 'N', // ν Ν
  'τ': 't', 'Τ': 'T', // τ Τ
  'υ': 'u', 'Υ': 'Y', // υ Υ
  'χ': 'x', 'Χ': 'X', // χ Χ
  'Β': 'B', 'Η': 'H', 'Μ': 'M', 'Ζ': 'Z',
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

/** Leetspeak digits/symbols that stand in for letters. */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l',
};

export interface TextVariant {
  /** Name of the transform that produced this text. */
  readonly name: 'base' | 'separators' | 'leet' | 'compact';
  readonly text: string;
  /** True when the variant has no whitespace left, so `\s+`-free regexes must be used. */
  readonly compactForm: boolean;
}

/**
 * Canonical form used for all matching. Idempotent.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\r?\n ?/g, '\n')
    .trim();
}

/**
 * Join runs of single characters separated by one repeated separator
 * ("i.g.n.o.r.e", "i g n o r e") into a word, and turn `_`/`-` between
 * letters into spaces ("ignore_all_previous" -> "ignore all previous").
 */
function undoSeparators(text: string): string {
  // Runs of 3+ single letters joined by the same separator: i.g.n / i g n / i-g-n
  const joined = text.replace(
    /\b(?:[A-Za-z][.\-_ ]){2,}[A-Za-z]\b/g,
    (run) => run.replace(/[.\-_ ]/g, ''),
  );
  return joined.replace(/(?<=[A-Za-z])[_\-]+(?=[A-Za-z])/g, ' ');
}

/**
 * Fold leet digits to letters, only inside tokens that already contain a
 * letter (so numbers, hashes, and IDs are left alone).
 */
function undoLeet(text: string): string {
  // ruflo: upstream matched `[cls]*[A-Za-z][cls]*`, which rescans a
  // letter-free run (e.g. 100 KB of hex digits) from every start position:
  // quadratic, 1.8 s per 100 KB. Matching maximal runs and checking for a
  // letter in the callback yields the same tokens in linear time.
  return text.replace(/[A-Za-z0-9@$!|]+/g, (token) => {
    if (!/[A-Za-z]/.test(token)) return token;
    if (!/[0-9@$!|]/.test(token)) return token;
    return token.replace(/[0-9@$!|]/g, (ch) => LEET[ch] ?? ch);
  });
}

/**
 * Variants of a normalised text, de-duplicated. `base` is always first.
 * Variants are only generated for the first `limit` characters so the
 * scan cost stays bounded.
 */
export function textVariants(normalized: string, limit = 65536): TextVariant[] {
  const head = normalized.length > limit ? normalized.slice(0, limit) : normalized;
  const out: TextVariant[] = [{ name: 'base', text: normalized, compactForm: false }];
  const seen = new Set<string>([normalized]);
  const push = (name: TextVariant['name'], text: string) => {
    if (!seen.has(text)) {
      seen.add(text);
      out.push({ name, text, compactForm: name === 'compact' || !/\s/.test(text) });
    }
  };
  const sep = undoSeparators(head);
  push('separators', sep);
  push('leet', undoLeet(sep));
  push('compact', sep.replace(/[ \t.\-_]+/g, ''));
  return out;
}

/** Compact-form regex source: `\s+`/`\s*` become empty so joined words match. */
export function compactSource(source: string): string {
  return source.replace(/\\s[+*]/g, '');
}
