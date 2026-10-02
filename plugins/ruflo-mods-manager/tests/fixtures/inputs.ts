import type { RenderInput, SessionStartInput } from 'claude-code'

export const PLUGIN = 'ruflo-mods-manager'
export const CWD = '/work'
export const PANE_ID = 'ruflo-mods-manager'

export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

/** The manager's pane as the engine asks for it: inline, 100 columns of body, `rows` tall, focused or not. */
export const paneAt = (bodyColumns = 101, bodyRows = 22, isFocused = true): RenderInput<'Pane'> => ({
  component: 'Pane',
  surface: 'terminal',
  requestId: PANE_ID,
  viewport: { columns: 120, rows: 48, isFullscreen: false },
  props: { title: 'Mods', isFocused, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows }, view: {} },
})

export const PANE = paneAt()

export const command = (args = '') => ({
  command: 'mods',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})
