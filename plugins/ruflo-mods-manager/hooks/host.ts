import type { CommandSpec, PaneOpenArgs, ProcessRunResult, PromptFillArgs, Settings, SettingsSource, TimerCall, UiBlitResult, UiOpenResult, UiPane } from 'claude-code'

/**
 * The engine as `session.start` bound it from its `$`. Every later hook, timer and button press reaches the engine
 * through this, so the rest is plain functions over a small interface a test can stand in for. Any member may be
 * refused (an administrator withheld it, or a mod above said no): callers catch.
 */
export type Host = {
  now: () => Promise<number>
  every: TimerCall
  run: (argv: readonly string[], timeoutMs: number) => Promise<ProcessRunResult>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  settings: (source?: SettingsSource) => Promise<Settings>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  invalidate: () => void
  toast: (text: string) => void
  status: (text: string | undefined) => void
  open: (pane: PaneOpenArgs) => Promise<UiOpenResult>
  close: (id: string) => Promise<void>
  panes: () => Promise<readonly UiPane[]>
  blit: (args: { requestId: string; key: string; cells: string; columns: number; rows: number }) => Promise<UiBlitResult>
  fill: (input: PromptFillArgs) => Promise<unknown>
  registerCommand: (spec: CommandSpec) => Promise<unknown>
}
