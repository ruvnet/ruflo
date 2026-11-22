/** The structural XML check the SVG specs share (tests/svg-pictures.spec.ts, tests/vector-pictures.spec.ts). */
/**
 * A structural XML check for what gridToSvg writes (not a general XML parser, and not evidence beyond its own rules): one root element, every tag closed in order, close tags bare,
 * attributes quoted and unique, no bare `&` or character XML 1.0 cannot hold in text or in a value, and no `]]>` in text.
 */
const BAD_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const BAD_REF = /&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/
const BAD_TEXT = (text: string): boolean => BAD_REF.test(text) || text.includes(']]>') || BAD_CHAR.test(text)
const BAD_VALUE = (value: string): boolean => BAD_REF.test(value) || BAD_CHAR.test(value)

export function isWellFormed(xml: string): boolean {
  const stack: string[] = []
  const token = /<\/([A-Za-z][\w:-]*)>|<([A-Za-z][\w:-]*)((?:[ \t\r\n]+[A-Za-z_:][\w:.-]*="[^"<]*")*)[ \t\r\n]*(\/?)>|([^<]+)/gy
  let seenRoot = false
  let at = 0

  while (at < xml.length) {
    token.lastIndex = at
    const m = token.exec(xml)

    if (m === null) return false
    at = token.lastIndex
    if (m[5] !== undefined) {
      if (stack.length === 0 || BAD_TEXT(m[5])) return false
    } else if (m[1] !== undefined) {
      if (stack.pop() !== m[1]) return false
    } else {
      const values = [...(m[3] ?? '').matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)]

      if (new Set(values.map(v => v[1])).size !== values.length || values.some(v => BAD_VALUE(v[2] ?? ''))) return false
      // One root element: nothing opens once it has closed.
      if (stack.length === 0 && seenRoot) return false
      seenRoot = true
      if (m[4] !== '/') stack.push(m[2] as string)
    }
  }

  return seenRoot && stack.length === 0
}
