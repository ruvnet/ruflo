# ADR 421: Recording aids: RUFLO_CONSOLE_ROWS

Status: Accepted (ships in ruflo-console 0.22.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/state.ts` (`paneRowsOf`, `dockRows`), `hooks/register.ts`, `hooks/controller.ts`, `tests/pane-rows.spec.ts`.

Extends: ADR 407. Companion to ADR 420 (the tour GIF).

## 1. Context

Seated inline above Claude's prompt (a terminal narrower than the 110 columns a dock needs, such as a portrait 9:11 recording), the pane opens as tall as the view asks for, which is 24 to 60 body rows, then the layout caps it. A recording that wants every view to fill the frame had no way to ask for one height for all of them; a width already had `RUFLO_CONSOLE_COLUMNS`.

## 2. Decision

`RUFLO_CONSOLE_ROWS` (a whole number from 8 to 200) makes the pane ask the engine for that many body rows for every view, instead of each view's own. Anything else, or unset, leaves each view's own height. It is a request, as the columns one is: the engine's layout cap still applies, and a height the person dragged wins.

`paneRowsOf(dockRows, view)` in `hooks/state.ts` is the one place the request is made; both pane-open calls in `controller.ts` use it.

## 3. Alternatives considered

- **Raising every view's `rows`.** Rejected: the heights are per-view on purpose, and a tall view on a short terminal would then always be capped.
- **A setting in the plugin config.** Rejected: it is for recordings, like `RUFLO_CONSOLE_COLUMNS` and `RUFLO_CONSOLE_PANEL`, so an environment variable is the right scope.

## 4. Consequences

A recording can crop a tall terminal to the bottom rows and show the cockpit filling the frame. Nothing changes for anyone who does not set the variable.

## 5. Tests

`tests/pane-rows.spec.ts`: unset, a view asks for its own rows; set, every view (including `agent`) asks for the requested rows.
