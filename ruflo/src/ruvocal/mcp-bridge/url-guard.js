// SSRF guard for the bridge's outbound calls (CWE-918).
//
// Only public HTTPS endpoints pass. The hostname is checked as written and,
// in assertPublicUrl, again after DNS resolution, so a public name that
// resolves to a private address is refused too.
//
// This file exists twice (src/mcp-bridge and src/ruvocal/mcp-bridge) and the
// copies must stay byte-identical; test-url-guard.mjs fails if they drift.
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // carrier-grade NAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, cloud metadata
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, broadcast
]) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],           // unspecified
  ["::1", 128],          // loopback
  ["64:ff9b::", 96],     // NAT64, maps onto IPv4
  ["fc00::", 7],         // unique-local
  ["fe80::", 10],        // link-local
  ["ff00::", 8],         // multicast
]) BLOCKED.addSubnet(net, prefix, "ipv6");

/** True when an IP literal is loopback, private, link-local or otherwise not public. */
export function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  // An IPv4-mapped IPv6 address is matched against the IPv4 rules as well.
  if (family === 6) return BLOCKED.check(address, "ipv6");
  return true; // not an IP literal: refuse instead of guessing
}

function bareHostname(parsed) {
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Synchronous check of the URL as written. Throws on anything not public HTTPS. */
export function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("SSRF guard: invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`SSRF guard: only HTTPS URLs are permitted, got ${parsed.protocol}`);
  }
  const host = bareHostname(parsed);
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`SSRF guard: private/loopback address rejected — ${host}`);
    }
    return parsed;
  }
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`SSRF guard: private/loopback host rejected — ${host}`);
  }
  return parsed;
}

/**
 * assertSafeUrl plus a check of every address the hostname resolves to.
 * `lookup` is injectable for tests.
 */
export async function assertPublicUrl(rawUrl, lookup = dnsLookup) {
  const parsed = assertSafeUrl(rawUrl);
  const host = bareHostname(parsed);
  if (isIP(host)) return parsed;
  const addresses = await lookup(host, { all: true });
  if (!addresses.length) throw new Error(`SSRF guard: ${host} did not resolve`);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`SSRF guard: ${host} resolves to a private/loopback address (${address})`);
    }
  }
  return parsed;
}
