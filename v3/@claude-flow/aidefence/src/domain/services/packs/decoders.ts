/**
 * Vendored from midstream `AIMDS/src/detection/decoders.ts` at commit abe78d6.
 * Detection-only: output of this module is matched against, never shown to users.
 */

/**
 * Bounded decoders for the encoded_instruction pack.
 *
 * Finds base64 / hex / URL-encoded blobs of at least 16 characters, decodes
 * them, and returns only candidates that look like text (printable ratio).
 * Also produces rot13 and reversed variants of the whole (capped) input.
 * All work is linear and capped by `maxCandidates` and `maxBytes`.
 */

export type Encoding = 'base64' | 'hex' | 'url' | 'rot13' | 'reverse';

export interface DecodedCandidate {
  readonly encoding: Encoding;
  readonly decoded: string;
  /** Character offset of the blob in the source text (whole-text variants use 0). */
  readonly offset: number;
  readonly sourceLength: number;
}

export interface DecoderOptions {
  readonly maxCandidates?: number;
  readonly maxBytes?: number;
  readonly minBlob?: number;
  readonly rot13?: boolean;
  readonly reverse?: boolean;
  /** Whole-text variants (rot13/reverse) are only produced up to this length. */
  readonly wholeTextLimit?: number;
}

const DEFAULTS: Required<DecoderOptions> = {
  maxCandidates: 8,
  maxBytes: 4096,
  minBlob: 16,
  rot13: true,
  reverse: true,
  wholeTextLimit: 16384,
};

const BASE64_RE = /[A-Za-z0-9+/_-]{16,}={0,2}/g;
const HEX_RE = /(?:[0-9a-fA-F]{2}){8,}/g;
const URLENC_RE = /(?:%[0-9a-fA-F]{2}){6,}/g;

/** Share of decoded characters that are printable ASCII or common whitespace. */
export function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  let printable = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09) printable++;
  }
  return printable / text.length;
}

function looksLikeText(decoded: string): boolean {
  return decoded.length >= 8 && printableRatio(decoded) >= 0.9 && /[A-Za-z]{3}/.test(decoded);
}

function decodeBase64(blob: string): string | null {
  const body = blob.replace(/=+$/, '');
  if (body.length % 4 === 1) return null; // impossible base64 length
  // Must contain both letter classes or a digit to avoid matching plain words.
  if (!/[a-z]/.test(body) || !/[A-Z0-9]/.test(body)) return null;
  try {
    const buf = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length === 0) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function decodeHex(blob: string): string | null {
  if (blob.length % 2 !== 0) return null;
  try {
    return Buffer.from(blob, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

function decodeUrl(blob: string): string | null {
  try {
    return decodeURIComponent(blob);
  } catch {
    return null;
  }
}

export function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function reverseText(text: string): string {
  return Array.from(text).reverse().join('');
}

/**
 * Extract decodable candidates from `text`. The caller is expected to
 * re-scan each `decoded` string once; decoded output is never fed back here.
 */
export function extractDecodedCandidates(text: string, opts: DecoderOptions = {}): DecodedCandidate[] {
  const o = { ...DEFAULTS, ...opts };
  const out: DecodedCandidate[] = [];
  let bytes = 0;
  const seen = new Set<string>();

  const consider = (encoding: Encoding, decoded: string | null, offset: number, sourceLength: number) => {
    if (out.length >= o.maxCandidates || !decoded) return;
    const trimmed = decoded.length > o.maxBytes ? decoded.slice(0, o.maxBytes) : decoded;
    if (bytes + trimmed.length > o.maxBytes * o.maxCandidates) return;
    if (!looksLikeText(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    bytes += trimmed.length;
    out.push({ encoding, decoded: trimmed, offset, sourceLength });
  };

  const scan = (re: RegExp, encoding: Encoding, decode: (blob: string) => string | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // ruflo: cap each blob before decoding so a single 200 KB base64 run is
    // not decoded in full only to be trimmed to maxBytes afterwards. The cap is
    // a multiple of 12 so base64 quads, hex pairs and %XX triplets stay whole.
    const maxBlob = Math.max(12, Math.floor((o.maxBytes * 3) / 12) * 12);
    while ((m = re.exec(text)) !== null && out.length < o.maxCandidates) {
      if (m[0].length < o.minBlob) continue;
      const blob = m[0].length > maxBlob ? m[0].slice(0, maxBlob) : m[0];
      consider(encoding, decode(blob), m.index, m[0].length);
    }
  };

  scan(URLENC_RE, 'url', decodeUrl);
  scan(HEX_RE, 'hex', decodeHex);
  scan(BASE64_RE, 'base64', decodeBase64);

  if (text.length <= o.wholeTextLimit && /[A-Za-z]{4}/.test(text)) {
    if (o.rot13) consider('rot13', rot13(text), 0, text.length);
    if (o.reverse) consider('reverse', reverseText(text), 0, text.length);
  }
  return out;
}
