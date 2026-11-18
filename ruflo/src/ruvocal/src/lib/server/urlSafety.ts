import { Address4, Address6 } from "ip-address";
import { isIP } from "node:net";
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

const UNSAFE_IPV4_SUBNETS = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
].map((s) => new Address4(s));

function isUnsafeIp(address: string): boolean {
	const family = isIP(address);

	if (family === 4) {
		const addr = new Address4(address);
		return UNSAFE_IPV4_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	if (family === 6) {
		const addr = new Address6(address);
		// Check IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
		if (addr.is4()) {
			const v4 = addr.to4();
			return UNSAFE_IPV4_SUBNETS.some((subnet) => v4.isInSubnet(subnet));
		}
		// Unique-local (fc00::/7) is private address space, like 10/8 for IPv4.
		const ula = addr.isInSubnet(new Address6("fc00::/7"));
		return addr.isLoopback() || addr.isLinkLocal() || ula || cleanIsUnspecified(address);
	}

	return true; // Unknown format → block
}

function cleanIsUnspecified(address: string): boolean {
	return /^(::|0:0:0:0:0:0:0:0)$/.test(address);
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

/**
 * Undici dispatcher that validates resolved IPs at connection time,
 * preventing TOCTOU DNS rebinding attacks.
 */
export const ssrfSafeAgent = new Agent({
	connect: {
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
	},
});

/** fetch() whose connections may only reach public addresses (see ssrfSafeAgent). */
export const ssrfSafeFetch = ((input: string | URL, init?: RequestInit) =>
	undiciFetch(input, { ...(init as object), dispatcher: ssrfSafeAgent } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
