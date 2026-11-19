// Client address for quotas and limits, derived from the trusted end of the
// forwarding chain. The leftmost X-Forwarded-For entry is whatever the caller
// sent, so it is never used: walk from the right across exactly `hops` proxies.
import { isIP } from 'node:net';

/** Returns `{ ip }` or `{ error }`. IPv6 addresses are grouped by /64. */
export function deriveClientIp(req, trustedProxyHops = 0) {
  const raw = req.headers['x-forwarded-for'] || '';
  if (typeof raw !== 'string' || raw.length > 1024) return { error: 'invalid forwarding chain' };
  const chain = [...raw.split(',').map(x => x.trim()).filter(Boolean), req.socket?.remoteAddress];
  const address = chain[chain.length - 1 - trustedProxyHops];
  if (!address || !isIP(address)) return { error: 'client address unavailable' };
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return { ip: address.slice(7) };
  // URL canonicalization removes alternate IPv6 spellings. Limit IPv6 by /64
  // so rotating interface identifiers does not create a fresh quota.
  if (isIP(address) === 6) {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right = ''] = canonical.split('::');
    const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
    return { ip: [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].slice(0, 4).join(':') + '::/64' };
  }
  return { ip: address };
}

/** Trusted proxy hops in front of the gateway (0..3); shared by registration and every per-IP limit. */
export function configuredProxyHops(env = process.env) {
  const n = Number(env.RUFLO_PROXY_HOPS ?? env.RUFLO_REGISTRATION_PROXY_HOPS ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
}
