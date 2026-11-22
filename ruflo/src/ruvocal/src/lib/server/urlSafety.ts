import { Address4, Address6 } from "ip-address";
import { isIP } from "node:net";
import dns from "node:dns";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

const UNSAFE_IPV4_SUBNETS = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"224.0.0.0/4",
	"240.0.0.0/4",
].map((s) => new Address4(s));

const IPV4_MAPPED = new Address6("::ffff:0:0/96");

// IPv6 ranges that are not public, or that embed an IPv4 address the
// IPv4 rules would otherwise have to judge (NAT64, 6to4, Teredo, SIIT,
// IPv4-compatible). Kept in step with mcp-bridge/url-guard.js.
const UNSAFE_IPV6_SUBNETS = [
	"::/96", // unspecified, loopback, IPv4-compatible
	"::ffff:0:0:0/96", // SIIT IPv4-translated
	"64:ff9b::/96", // NAT64
	"64:ff9b:1::/48", // local-use NAT64
	"2001::/32", // Teredo
	"2002::/16", // 6to4
	"fc00::/7", // unique-local
	"fe80::/10", // link-local
	"fec0::/10", // site-local (deprecated)
	"ff00::/8", // multicast
].map((s) => new Address6(s));

function isUnsafeIp(address: string): boolean {
	const family = isIP(address);

	if (family === 4) {
		const addr = new Address4(address);
		return UNSAFE_IPV4_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	if (family === 6) {
		const addr = new Address6(address);
		// An IPv4-mapped address (::ffff:a.b.c.d, which URL parsing rewrites to
		// hex) is judged by the IPv4 rules for the address it embeds.
		if (addr.is4() || addr.isInSubnet(IPV4_MAPPED)) {
			const v4 = addr.to4();
			return UNSAFE_IPV4_SUBNETS.some((subnet) => v4.isInSubnet(subnet));
		}
		return UNSAFE_IPV6_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	return true; // Unknown format → block
}

/**
 * Synchronous URL validation: checks protocol and hostname string.
 *
 * By default only public HTTPS URLs pass: no loopback or Docker-internal
 * names, no dotless hosts, no private IP literals. `allowPrivate` restores the
 * local-development allowances and is only for URLs the operator configured
 * (MCP_SERVERS), never for URLs taken from a request.
 */
export function isValidUrl(urlString: string, opts: { allowPrivate?: boolean } = {}): boolean {
	try {
		const url = new URL(urlString.trim());
		const hostname = url.hostname.toLowerCase();
		// Allow HTTP for localhost/loopback/Docker-internal (dev & local MCP bridge)
		if (opts.allowPrivate && (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1" ||
			hostname === "host.docker.internal"
		)) {
			return url.protocol === "http:" || url.protocol === "https:";
		}
		// Allow HTTP for Docker-internal service names (no dots = private network)
		if (opts.allowPrivate && !hostname.includes(".") && url.protocol === "http:") {
			return true;
		}
		if (url.protocol !== "https:") {
			return false;
		}
		// If the hostname is a raw IP literal, validate it
		const cleanHostname = hostname.replace(/^\[|]$/g, "");
		if (isIP(cleanHostname)) {
			return opts.allowPrivate || !isUnsafeIp(cleanHostname);
		}
		if (!opts.allowPrivate && (!hostname.includes(".") || hostname.endsWith(".localhost") || hostname.endsWith(".internal") || hostname.endsWith(".local"))) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Assert that a resolved IP address is safe (not internal/private).
 * Throws if the IP is internal. Used in undici's custom DNS lookup
 * to validate IPs at connection time (prevents TOCTOU DNS rebinding).
 */
export function assertSafeIp(address: string, hostname: string): void {
	if (isUnsafeIp(address)) {
		throw new Error(`Resolved IP for ${hostname} is internal (${address})`);
	}
}

/** Connector whose DNS lookup refuses a hostname that resolves to an internal address. */
const lookupCheckedConnector = buildConnector({
	lookup: (hostname, options, callback) => {
		dns.lookup(hostname, options, (err, address, family) => {
			if (err) return callback(err, "", 4);
			if (typeof address === "string") {
				try {
					assertSafeIp(address, hostname);
				} catch (e) {
					return callback(e as Error, "", 4);
				}
			} else if (Array.isArray(address)) {
				for (const entry of address) {
					try {
						assertSafeIp(entry.address, hostname);
					} catch (e) {
						return callback(e as Error, "", 4);
					}
				}
			}
			return callback(null, address, family);
		});
	},
});

/**
 * Undici dispatcher that validates the address of every connection it opens,
 * preventing TOCTOU DNS rebinding attacks. A hostname is checked after DNS
 * resolution; an IP literal never reaches the resolver, so it is checked here
 * before connecting. That covers redirects too: fetch follows them through the
 * same dispatcher, so a public server cannot bounce a request to an internal
 * address.
 */
export const ssrfSafeAgent = new Agent({
	connect: (opts, callback) => {
		const host = String(opts.hostname ?? "").replace(/^\[|]$/g, "");
		if (isIP(host) && isUnsafeIp(host)) {
			callback(new Error(`Connection to internal address ${host} refused`), null);
			return;
		}
		lookupCheckedConnector(opts, callback);
	},
});

/** fetch() whose connections may only reach public addresses (see ssrfSafeAgent). */
export const ssrfSafeFetch = ((input: string | URL, init?: RequestInit) =>
	undiciFetch(input, { ...(init as object), dispatcher: ssrfSafeAgent } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
