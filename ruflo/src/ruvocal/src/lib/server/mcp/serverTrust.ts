import { isValidUrl, ssrfSafeFetch } from "$lib/server/urlSafety";
import { getMcpServers } from "./registry";

/**
 * An MCP server URL the operator configured (MCP_SERVERS). Only these may use
 * loopback, Docker-internal or other private addresses; a URL supplied in a
 * request — including by an anonymous chat session — must be public.
 */
export function isConfiguredMcpUrl(url: string): boolean {
	return getMcpServers().some((s) => s.url === url);
}

/** Whether an MCP server URL may be contacted at all. */
export function isAllowedMcpUrl(url: string): boolean {
	return isValidUrl(url, { allowPrivate: isConfiguredMcpUrl(url) });
}

/**
 * The fetch an MCP transport should use: the default for operator-configured
 * servers, and one pinned to public addresses at connect time for everything
 * else, so a public hostname that resolves to a private address is refused.
 */
export function mcpFetchFor(url: string): typeof fetch | undefined {
	return isConfiguredMcpUrl(url) ? undefined : ssrfSafeFetch;
}
