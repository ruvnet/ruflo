# ruRE

ruRE is an experimental Ruflo plugin for static inspection of local applications and binaries. It maps JavaScript, TypeScript and Electron code and reports findings with file and line evidence. Its binary readers inventory container, metadata or bytecode structures without executing the target.

Use ruRE on an app you own or have permission to study. See the [scope and dual-use policy](docs/adrs/0001-scope-and-dual-use-policy.md).

## Skill and command

The [Analyze App skill](skills/analyze-app/SKILL.md) guides target selection, evidence collection and interpretation. With the plugin enabled, the [`/rure-analyze` command](commands/rure-analyze.md) takes a local path and a question. For example, use this command with a local Electron app you own:

```text
/rure-analyze ./my-electron-app Explain how search crosses the Electron IPC boundary
```

For an `.asar` archive, extract it first and pass the returned directory to the JavaScript analyzer. Review the cited source locations before drawing a conclusion.

## MCP tools

| Tool | What it does |
| --- | --- |
| `rure_extract_asar` | Unpacks an Electron ASAR archive for static inspection. |
| `rure_analyze_js_app` | Maps modules, imports and Electron process boundaries in a local directory. |
| `rure_find_feature` | Narrows the search to evidence relevant to a named feature. |
| `rure_analyze_binary` | Inventories ELF, PE and Mach-O container structure, imports and exports. |
| `rure_analyze_dotnet` | Reads managed assembly metadata, types and interop declarations. |
| `rure_analyze_evm` | Inventories EVM bytecode selectors, opcodes and related metadata. |
| `rure_analyze_cuda` | Inventories CUDA fatbin, cubin and PTX entries. |
| `rure_cuda_launch_plan` | Estimates theoretical occupancy from static CUDA metadata. |

The [tool registry](../../v3/@claude-flow/cli/src/mcp-tools/rure-tools.ts) defines the inputs and outputs. Dynamic analysis is outside the current plugin scope. CUDA launch plans are estimates; use measured runs to establish performance.
