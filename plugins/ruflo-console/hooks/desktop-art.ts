/**
 * The desktop look's setting (ADR-546): where the surface draws Svg (Claude Code Desktop, the editor, the mobile app), `rich` draws the
 * native vector pictures (views/vector-art.ts) and `cells` the terminal's cell pictures written as SVG. The terminal never reads it.
 * Kept in the plugin's store, like the nav style.
 */
import type { Host } from './host'
import type { State } from './state'

export type DesktopArt = State['desktopArt']
export const DESKTOP_ARTS: readonly DesktopArt[] = ['rich', 'cells']
export const DESKTOP_ART_KEY = 'desktop-art'

/** A saved value, or null for anything that is not one of the two (a missing key, a hand-edited store). */
export const parseDesktopArt = (value: unknown): DesktopArt | null => DESKTOP_ARTS.find(mode => mode === value) ?? null

export function loadDesktopArt(state: State, host: Host): Promise<void> {
  return host.storeGet(DESKTOP_ART_KEY).then(
    saved => {
      const mode = parseDesktopArt(saved)

      if (mode !== null && mode !== state.desktopArt) {
        state.desktopArt = mode
        host.invalidate()
      }
    },
    () => undefined,
  )
}

export function setDesktopArt(state: State, host: Host, mode: DesktopArt): void {
  state.desktopArt = mode
  void host.storeSet(DESKTOP_ART_KEY, mode).catch(() => undefined)
  host.invalidate()
}
