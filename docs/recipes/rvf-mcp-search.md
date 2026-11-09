# Search a portable RVF index from a Ruflo project

Use the [RuVector RVF MCP server](https://www.npmjs.com/package/@ruvector/rvf-mcp-server) beside Ruflo to look up nearest vectors in a local `.rvf` file. The recipe keeps the index on your machine and leaves the default Ruflo install unchanged.

## Quickstart: check the local search path

Use Node.js 20 or later and a native RVF build for your platform. The smoke test below was run on Linux x64. The [RVF platform table](https://github.com/ruvnet/ruvector/tree/main/npm/packages/rvf#platform-support) lists other targets; this stdio server uses the Node backend, not browser WASM.

From this repository's root, run:

```sh
demo_dir="$(mktemp -d)"
cp docs/recipes/rvf-mcp-search.mjs "$demo_dir/"
cd "$demo_dir"
npm init -y
npm install --ignore-scripts --no-audit --no-fund --save-exact @ruvector/rvf-mcp-server@0.2.2 @ruvector/rvf@0.4.8 @modelcontextprotocol/sdk@1.32.2
node rvf-mcp-search.mjs
```

Expected final line:

```text
Nearest vector: 1; read-only write rejected; traversal rejected; RVF unchanged.
```

The script creates a temporary three-vector fixture, connects over stdio, opens the index read-only, checks the nearest match, verifies that an attempted write and path traversal are rejected, and checks that the original bytes did not change. It removes the fixture on exit. No model, API key, remote endpoint, or telemetry is needed.

## Use it next to Ruflo

1. In the directory where you explicitly installed the packages above, make a dedicated `rvf-search-data` directory. Put only a **copy of a trusted index** in it. If the index came from the RVF MCP server and uses metadata filters, copy its matching `.mcp-meta.jsonl` sidecar too.
2. In your MCP client for the Ruflo project, add a separate `rvf-search` server alongside the existing Ruflo server. For Claude Code, merge the entry below into the project's `.mcp.json`, replacing both absolute paths. Review the project MCP configuration before enabling it.

   ```json
   {
     "mcpServers": {
       "rvf-search": {
         "command": "node",
         "args": [
           "/absolute/recipe/node_modules/@ruvector/rvf-mcp-server/dist/cli.js",
           "--transport", "stdio",
           "--data-dir", "/absolute/recipe/rvf-search-data"
         ]
       }
     }
   }
   ```

3. Ask the client to use `rvf_open_store` with a relative `path` and **`readOnly: true`**. Then call `rvf_query` with the returned `storeId`, a vector of the same dimensions and embedding space as the index, and `k`. Call `rvf_close_store` when finished. The server searches supplied vectors; it does not automatically embed a text query in this recipe.

Keep transport on stdio. Read-only applies to the opened handle; the server still advertises write tools and can open other handles. Keep the data directory isolated, keep automatic tool approval off, and permit only open/query/close calls for this workflow. If the client cannot constrain calls, use the deterministic script with a disposable fixture instead of exposing a sensitive index to an agent.

Continue with the [RVF SDK quickstart](https://github.com/ruvnet/ruvector/tree/main/npm/packages/rvf#quick-start) to create your own index, or explore the [Ruvnet ecosystem](https://ruv.io).
