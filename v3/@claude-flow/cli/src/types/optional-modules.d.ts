/**
 * Ambient type declarations for optional runtime-imported modules.
 *
 * These modules are dynamically imported at runtime and may or may not
 * be installed. They are NOT bundled — users install them as needed.
 * Declaring them here prevents TS2307 in strict pnpm CI builds where
 * hoisted node_modules are not available.
 */

declare module 'pg' {
  const pg: any;
  export default pg;
  export const Pool: any;
  export const Client: any;
}

declare module 'sql.js' {
  const initSqlJs: any;
  export default initSqlJs;
}

declare module 'agentic-flow' {
  const agenticFlow: any;
  export default agenticFlow;
  export const ReasoningBank: any;
  export const VERSION: string;
}

declare module 'agentic-flow/reasoningbank' {
  const reasoningBank: any;
  export default reasoningBank;
  export const ReasoningBank: any;
  export function retrieveMemories(...args: any[]): any;
}

declare module 'ruvector' {
  const ruvector: any;
  export default ruvector;
  export const VectorDB: any;
  export const VectorDb: any;
  export function isWasm(): boolean;
}

declare module '@ruvector/core' {
  const core: any;
  export default core;
}

declare module '@xenova/transformers' {
  const transformers: any;
  export default transformers;
  export const pipeline: any;
  export const env: any;
}
