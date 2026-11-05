import { describe, expect, it } from "vitest";
import { isValidUrl } from "./urlSafety";

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
