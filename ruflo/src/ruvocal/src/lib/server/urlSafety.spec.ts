import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isValidUrl, ssrfSafeFetch } from "./urlSafety";

// URLs from a request (custom MCP servers, fetch-url) must be public HTTPS.
// The local-development allowances apply only to operator-configured URLs.
describe("isValidUrl", () => {
	it("accepts public HTTPS URLs", () => {
		expect(isValidUrl("https://mcp.example.com/mcp")).toBe(true);
		expect(isValidUrl("https://8.8.8.8/")).toBe(true);
	});

	it("refuses loopback, Docker-internal, dotless and private targets by default", () => {
		for (const url of [
			"http://localhost:3001/mcp",
			"https://localhost/mcp",
			"http://127.0.0.1:3001/mcp",
			"https://[::1]/",
			"http://host.docker.internal:3001/mcp",
			"http://mongodb:27017/",
			"http://metadata/computeMetadata/v1/",
			"https://metadata/",
			"https://10.0.0.5/",
			"https://192.168.1.10/",
			"https://169.254.169.254/latest/meta-data/",
			"https://[fd00::1]/",
			"https://bridge.localhost/",
			"https://metadata.google.internal/",
			"http://mcp.example.com/mcp",
			"https://[::7f00:1]/",
			"https://[::ffff:0:7f00:1]/",
			"https://[2002:a9fe:a9fe::]/",
			"https://[2001:0:a9fe:a9fe::]/",
			"https://[fec0::1]/",
			"https://[ff02::1]/",
			"https://198.18.0.1/",
			"https://192.0.0.1/",
			"https://224.0.0.1/",
			"https://255.255.255.255/",
		]) {
			expect(isValidUrl(url), url).toBe(false);
		}
	});

	it("keeps the local allowances for operator-configured URLs", () => {
		expect(isValidUrl("http://localhost:3001/mcp", { allowPrivate: true })).toBe(true);
		expect(isValidUrl("http://mcp-bridge:3001/mcp", { allowPrivate: true })).toBe(true);
		expect(isValidUrl("https://10.0.0.5/", { allowPrivate: true })).toBe(true);
	});
});

describe("ssrfSafeFetch", () => {
	// An IP literal never reaches the DNS lookup hook, so it must be refused when
	// the connection opens. Redirects are followed through the same dispatcher,
	// which is what stops a public MCP server from bouncing a request inward.
	it("refuses to connect to an internal IP literal", async () => {
		let reached = false;
		const internal = await new Promise<http.Server>((resolve) => {
			const server = http
				.createServer((_req, res) => {
					reached = true;
					res.end("internal");
				})
				.listen(0, "127.0.0.1", () => resolve(server));
		});
		try {
			const port = (internal.address() as AddressInfo).port;
			await expect(ssrfSafeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
			await expect(ssrfSafeFetch(`http://[::ffff:7f00:1]:${port}/`)).rejects.toThrow();
			expect(reached).toBe(false);
		} finally {
			internal.close();
		}
	});
});
