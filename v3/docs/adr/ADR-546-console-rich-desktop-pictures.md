# ADR-546: Native vector pictures for the console on surfaces that draw Svg

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-437 (cost ledger and budget ladder), ADR-478 (What's new changelog), ADR-404 (ruflo as a mod)
- **Surfaces:** `plugins/ruflo-console/hooks/gfx/vector.ts` (builders), `hooks/views/vector-art.ts` (which keys), `hooks/views/common.ts` `art()` (the one seam), `hooks/desktop-art.ts` (the setting), `hooks/register.ts` (per render), Settings → UI → Desktop pictures

## Context

The console draws its pictures (swarm graph, cost gauge, sparklines, BBS titles, boot screen) as a cell `Grid`. On the terminal that grid is a `Raster`. On the surfaces that draw `Svg` instead (Claude Code Desktop, the editor, the mobile app), `hooks/gfx/svg.ts` writes the same cells as one SVG, rectangle by rectangle. That is faithful, but it is a picture of a terminal: block glyphs, a fixed cell pitch, no hover, and no motion. The desktop draws the frame once per render, so the terminal's frame loop cannot animate it.

The host's `Svg` element (Claude Code mod types, `SvgProps`) offers more than an image:

- `isInteractive: true` draws the document in a script-less sandboxed frame. CSS `:hover`, CSS/SMIL animation and `<title>` tooltips work there.
- Scripts and event-handler attributes are always stripped. Presses still belong on an enclosing element.
- `source` is capped at 131072 characters, and a longer one invalidates the whole tree.
- `width` and `height` are CSS px.

The terminal has no `Svg` and must not change.

## Decision

1. **One seam.** `art()` in `views/common.ts` is where every picture becomes a `Raster` or an `Svg`. Where the surface draws `Svg` and the frame has a vector form for that picture key (`ctx.vectors`), it draws that document with `isInteractive: true`. It keeps the same `svg-<key>` box, so every page still draws one picture per key on every surface. It is never drawn wider than the cell picture it replaces, which is already fitted to the pane (a BBS title beside the nav icons); the viewBox scales it down. Otherwise it draws the cell SVG as before. The terminal path is untouched.

   **Host gate.** `height` and `isInteractive` are declared by the 2.1.289 types. An engine refuses a whole tree that carries a prop it does not know (the reason for `text-weight.ts`), so the vectors are drawn only where the host takes Text `weight` (2.1.299 and later). An older or unreadable host gets the cell pictures.
2. **Which pictures.** `views/vector-art.ts` `vectorsOf(state, columns, nowMs)` reads the same data `views/frames.ts` does:
   Six keys:

   - `topology` (swarm): the same `layout()` and `edges()`, scaled to px. Busy nodes pulse and traffic runs along their edges, and a node with a recent event rings three times. Every node has a `<title>` (label · status · id) and a hover state, and labels are drawn up to 24 nodes.
   - `gauge` (cost): a half-ring filled to spend/limit, with ADR-437 ladder ticks at 50/75/90/100%. An unknown spend reads n/a, never $0.
   - `activity` (overview) and `burn` (cost): sparklines, with one tooltip column per sample and the newest value labelled.
   - `header`/`title` in the BBS look: a neon sign with a local glow filter and a tube flicker.

   The boot screen and every other picture stay cell pictures for now.
3. **Pure builders.** `gfx/vector.ts` has no `$`, no Node and no clock. A document is a function of its data alone, so the string changes only when the data does. Motion is CSS keyframes that run in the surface, never in the plugin's frame loop. Only motion that loops is used (the pulse, the edge traffic, the flicker). A picture whose data ticks, such as a sparkline every 5 s or the gauge every turn, is a new document each time, so an entrance animation there would replay on every tick; those pictures are still and hoverable. When the console's `fps` is 0 no motion CSS is emitted, and `@media (prefers-reduced-motion: reduce)` stops every animation.
4. **Setting.** Settings → UI → **Desktop pictures** offers `rich` (the default) or `cells`. It is kept in the plugin's store under `desktop-art`, like the nav style, and only the two known values are read back. The terminal never reads it.
5. **Limits.** Every document is checked against `SVG_SOURCE_MAX`, and past it the cell picture is drawn. Inputs are bounded so that cannot happen in practice:
   - at most 100 nodes (`MAX_NODES`) and 300 edges;
   - the newest 120 samples per series, and at most four series;
   - labels cut to 24 characters;
   - width and height clamped to 1600 × 900 px.

   A 100-agent mesh with long labels is about 30k characters.

## Security

The document is data the host renders, so the builders hold these rules, each tested:

- Data reaches markup only through `escapeXml` (text, `<title>`, attribute values) or as a finite, rounded number. NaN and Infinity become 0 or n/a.
- A colour is accepted only as `#rgb`/`#rrggbb` and only as an attribute. The plain look's palette is terminal colour names (`claude`, `success`) and Orbital palettes are user-authored, so anything else falls back to the default.
- The `<style>` is one of two constants. No data is ever written into it.
- The builders emit no `<script>`, `<a>`, `<use>`, `<image>`, `<foreignObject>`, `<animate>`/`<set>`, `href`/`xlink:href`/`src`, `on*` attribute or external `url(...)`. The only `url()` is the glow filter's local `url(#glow)`.
- The host's sandbox is the second layer: no scripts, and handlers are stripped. This design relies on it but does not depend on it.

## Verification

- `tests/vector-pictures.spec.ts` (vitest, in smoke step 14): 24 tests.
  - Every builder's output is checked for well-formedness (shared `tests/xml-check.ts`) and against an attribute-level active-content walker, which is itself tested against planted bad documents. Hostile labels, statuses, ids and series names are run through it, along with hostile palettes and sizes.
  - Other checks: the size cap at 100 nodes, the 120-sample bound, motion only while animating, a constant stylesheet, and determinism.
  - Build cost: a 100-agent mesh in under 15 ms (measured about 0.3 ms per build).
- `tests/desktop-rich.test.ts` (`claude plugin test`): 9 end-to-end tests through the real console on the `desktop` and `terminal` surfaces, in all three looks.
  - Each of the six keys is an interactive vector on the desktop and a `Raster` on the terminal.
  - The BBS title fits the pane at 110 and 64 columns.
  - A 2.1.289 host gets the cell pictures.
  - The words are the same on both surfaces.
  - A saved `cells` draws the cell pictures, and fps 0 draws still.
  - Pressing the Settings chip saves `cells` and redraws.
- The existing `tests/surface-pictures.test.ts` (one Svg per Raster key, on every page, in every look) passes unchanged.
- Real rendering: the generated documents were loaded in headless Chromium in `<iframe sandbox="">`.
  - The looping animations ran, and none ran under `reducedMotion: 'reduce'`.
  - Hovering a node widened its stroke from 1px to 3px, and `elementFromPoint` resolved that node's `<title>`.
  - No script element was present.
  - This was not checked in the Claude Desktop app itself, whose frame is the host's.

## Consequences

- The desktop console reads as a native app on the pages that matter most, at no cost to the terminal.
- There are now two drawings of these six pictures, and they can drift. `surface-pictures.test.ts` holds the keys equal, and `desktop-rich.test.ts` holds the vector form to the same data.
- Later phases, not in this change:
  - vector forms for the hive, flow, learning curve, MetaHarness radar and boot screen;
  - `Markdown`/`Code` for help pages and logs (this would break the text-equality check between surfaces, so it needs its own rule);
  - a `Client` region for drag and hover-follow, which the mobile app does not draw.
