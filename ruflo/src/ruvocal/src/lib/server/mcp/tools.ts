import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";
import { mcpFetchFor } from "./serverTrust";
import { logger } from "$lib/server/logger";
// use console.* for lightweight diagnostics in production logs

export type OpenAiTool = {
	type: "function";
	function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export interface McpToolMapping {
	fnName: string;
	server: string;
	tool: string;
}

interface CacheEntry {
	fetchedAt: number;
	ttlMs: number;
	tools: OpenAiTool[];
	mapping: Record<string, McpToolMapping>;
}

const DEFAULT_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// Per OpenAI tool/function name guidelines most providers enforce:
//   ^[a-zA-Z0-9_-]{1,64}$
// Dots are not universally accepted (e.g., MiniMax via HF router rejects them).
// Normalize any disallowed characters (including ".") to underscore and trim to 64 chars.
function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function buildCacheKey(servers: McpServerConfig[]): string {
	const normalized = servers
		.map((server) => ({
			name: server.name,
			url: server.url,
			headers: server.headers
				? Object.entries(server.headers)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([key, value]) => [key, value])
				: [],
		}))
		.sort((a, b) => {
			const byName = a.name.localeCompare(b.name);
			if (byName !== 0) return byName;
			return a.url.localeCompare(b.url);
		});

	return JSON.stringify(normalized);
}

type ListedTool = {
	name?: string;
	inputSchema?: Record<string, unknown>;
	description?: string;
	annotations?: { title?: string };
};

async function listServerTools(
	server: McpServerConfig,
	opts: { signal?: AbortSignal } = {}
): Promise<ListedTool[]> {
	const url = new URL(server.url);
	const client = new Client({ name: "chat-ui-mcp", version: "0.1.0" });
	try {
		try {
			const transport = new StreamableHTTPClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: mcpFetchFor(server.url),
			});
			await client.connect(transport);
		} catch {
			const transport = new SSEClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: mcpFetchFor(server.url),
			});
			await client.connect(transport);
		}

		const response = await client.listTools({});
		const tools = Array.isArray(response?.tools) ? (response.tools as ListedTool[]) : [];
		try {
			logger.debug(
				{
					server: server.name,
					url: server.url,
					count: tools.length,
					toolNames: tools.map((t) => t?.name).filter(Boolean),
				},
				"[mcp] listed tools from server"
			);
		} catch {}
		return tools;
	} finally {
		try {
			await client.close?.();
		} catch {
			// ignore close errors
		}
	}
}

export async function getOpenAiToolsForMcp(
	servers: McpServerConfig[],
	{ ttlMs = DEFAULT_TTL_MS, signal }: { ttlMs?: number; signal?: AbortSignal } = {}
): Promise<{ tools: OpenAiTool[]; mapping: Record<string, McpToolMapping> }> {
	const now = Date.now();
	const cacheKey = buildCacheKey(servers);
	const cached = cache.get(cacheKey);
	if (cached && now - cached.fetchedAt < cached.ttlMs) {
		return { tools: cached.tools, mapping: cached.mapping };
	}

	const tools: OpenAiTool[] = [];
	const mapping: Record<string, McpToolMapping> = {};

	const seenNames = new Set<string>();

	const pushToolDefinition = (
		name: string,
		description: string | undefined,
		parameters: Record<string, unknown> | undefined
	) => {
		if (seenNames.has(name)) return;
		tools.push({
			type: "function",
			function: {
				name,
				description,
				parameters,
			},
		});
		seenNames.add(name);
	};

	// Fetch tools in parallel; tolerate individual failures
	const tasks = servers.map((server) => listServerTools(server, { signal }));
	const results = await Promise.allSettled(tasks);

	for (let i = 0; i < results.length; i++) {
		const server = servers[i];
		const r = results[i];
		if (r.status === "fulfilled") {
			const serverTools = r.value;
			for (const tool of serverTools) {
				if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
					continue;
				}

				const parameters =
					tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : undefined;
				const description = tool.description ?? tool.annotations?.title;
				const toolName = tool.name;

				// Emit a collision-aware function name.
				// Prefer the plain tool name; on conflict, suffix with server name.
				let plainName = sanitizeName(toolName);
				if (plainName in mapping) {
					const suffix = sanitizeName(server.name);
					const candidate = `${plainName}_${suffix}`.slice(0, 64);
					if (!(candidate in mapping)) {
						plainName = candidate;
					} else {
						let i = 2;
						let next = `${candidate}_${i}`;
						while (i < 10 && next in mapping) {
							i += 1;
							next = `${candidate}_${i}`;
						}
						plainName = next.slice(0, 64);
					}
				}

				pushToolDefinition(plainName, description, parameters);
				mapping[plainName] = {
					fnName: plainName,
					server: server.name,
					tool: toolName,
				};
			}
		} else {
			// ignore failure for this server
			continue;
		}
	}

	cache.set(cacheKey, { fetchedAt: now, ttlMs, tools, mapping });
	return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache.clear();
}
