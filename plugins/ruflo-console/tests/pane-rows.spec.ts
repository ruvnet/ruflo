/**
 * The inline pane's requested height: each view's own, unless RUFLO_CONSOLE_ROWS asked for one height for every view. Run with
 *   npx vitest run plugins/ruflo-console/tests/pane-rows.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { newState, paneRowsOf, rowsOf } from '../hooks/state'

describe('pane rows', () => {
  it('a view asks for its own rows when nothing was requested', () => {
    expect(newState({}).dockRows).toBe(0)
    expect(paneRowsOf(0, 'menu')).toBe(rowsOf('menu'))
    expect(paneRowsOf(0, 'terminal')).toBe(rowsOf('terminal'))
  })

  it('a requested height wins for every view', () => {
    expect(paneRowsOf(41, 'menu')).toBe(41)
    expect(paneRowsOf(41, 'memory')).toBe(41)
    expect(paneRowsOf(41, 'agent')).toBe(41)
  })
})
