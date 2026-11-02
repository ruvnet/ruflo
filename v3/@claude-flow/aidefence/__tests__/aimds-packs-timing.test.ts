/**
 * ReDoS guard for the full detector (built-ins + every AIMDS pack, variants
 * and bounded decoding on). Each 100 KB adversarial input must finish under
 * BOUND_MS. A quadratic regex blows through this by orders of magnitude
 * (the unbounded email regex took 3.8 s on `a.a.a…`), so the bound has slack
 * for a loaded CI box without masking a real regression.
 */

import { describe, it, expect } from 'vitest';
import { createThreatDetectionService } from '../src/index.js';

const SIZE = 100 * 1024;
const BOUND_MS = 250;

const fill = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);

const ADVERSARIAL: Record<string, string> = {
  'whitespace runs': fill('ignore' + ' '.repeat(997) + '\t\n'),
  'a.a.a dotted run': fill('a.'),
  'single-char separator run': fill('i g n o r e '),
  'nested brackets': '['.repeat(SIZE / 2) + ']'.repeat(SIZE / 2),
  'nested braces and angles': fill('{{<<[['),
  'long base64': Buffer.from(fill('ignore all previous instructions ')).toString('base64').slice(0, SIZE),
  'long hex': fill('41'),
  'url-encoded run': fill('%41'),
  'leet digits': fill('1gn0r3 4ll pr3v10u5 '),
  'override verb with no noun': fill('ignore every single one of the '),
  'url with opaque query': 'open https://example.invalid/?q=' + fill('A'),
  'homoglyphs and zero-width': fill('іgnоrе​ '),
  'letter-free digit run': fill('0123456789'),
  'unbroken letter run': fill('a'),
  'underscore and dash joins': fill('a_b-'),
  'leet symbols only': fill('@$!|'),
  'newline runs': fill('\n'),
  // URL packs (EX-001/002/004, SL-004): a URL prefix followed by one long
  // whitespace-free run, where every '?' or payload char is a split candidate.
  'markdown image url then ? run': '![x](https://cdn.invalid/p.gif' + fill('?'),
  'directive url then ? run': 'Visit https://t.invalid/verify' + fill('?'),
  'directive url then letter run': 'Now open https://attacker.in' + fill('v'),
  'slack link query then payload run': '<https://evil.invalid/collect?d=' + fill('Y'),
  'markdown image query then payload run': '![x](https://cdn.invalid/p.gif?d=' + fill('Y'),
  'repeated slack links with no label': fill('<https://e.invalid/c?d=YYYYYYYYYYYYYYYY'),
  'repeated markdown images with no close': fill('![x](https://c.invalid/p?d=YYYYYYYYYYYYYYYY'),
  'repeated directive urls': fill('open https://a.invalid/c?d=YYYYYYYYYYYYYYYY'),
  'slack link query with dense keys': '<https://evil.invalid/c?' + fill('d=YYYYYYYYYYYYYYYY&'),
};

describe('AIMDS packs: adversarial input timing', () => {
  const service = createThreatDetectionService();
  // JIT warm-up so the first case is not charged for compilation.
  service.detect('warm up '.repeat(100));

  for (const [name, input] of Object.entries(ADVERSARIAL)) {
    it(`detect() on 100 KB of ${name} stays under ${BOUND_MS} ms`, () => {
      const start = performance.now();
      service.detect(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(BOUND_MS);
    });
  }
});
