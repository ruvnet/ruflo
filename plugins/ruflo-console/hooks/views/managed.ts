/** Managed runtime facts on existing pages. Local snapshots never authorize remote actions. */
import type { RenderElement } from 'claude-code'
import type { ActionSpec } from '../actions'
import type { WfRun } from '../data/workflows'
import { managedAction } from '../managed-actions'
import { MANAGED_STALE_MS, type ManagedSession } from '../data/managed'
import { ago, kv, text, rule, THEME, type Ctx } from './common'
import { flow } from './wf-layout'

const dollars = (cents: number | null): string => cents === null ? 'n/a' : `$${(cents / 100).toFixed(2)}`
const budget = (s: ManagedSession): string => `${dollars(s.listCostCents)} reported / ${dollars(s.budgetCents)} budget · remaining ${s.listCostCents === null || s.budgetCents === null ? 'n/a' : dollars(Math.max(0, s.budgetCents - s.listCostCents))}${s.listCostCents !== null && s.budgetCents !== null && s.listCostCents > s.budgetCents ? ` · overshoot ${dollars(s.listCostCents - s.budgetCents)}` : ''}`

export function managedRunRows(ctx: Ctx, run: WfRun, ask: (spec: ActionSpec) => void): RenderElement[] {
  const s = run.managed
  if (!s) return []
  const rows: RenderElement[] = [
    kv(ctx, 'runtime', `managed · ${s.status} · snapshot ${ago(run.updatedMs, ctx.nowMs)}${run.isStale ? ' · stale' : ''}`),
    kv(ctx, 'provider', s.providerFinished ? 'finished reported; correctness remains unverified' : `not finished${s.stopReason ? ` · ${s.stopReason}` : ''}`, THEME.info),
    kv(ctx, 'workers', 'inspection not independently verified by this console', THEME.warn),
    kv(ctx, 'acceptance', 'not independently verified; no green correctness badge', THEME.warn),
    kv(ctx, 'budget', budget(s)),
    kv(ctx, 'blockers', `${s.blockedEventIds.length} pending decisions · ${s.observedFailures} observed failures`),
  ]
  if (s.partial) rows.push(text(ctx, ` Showing workers ${s.threads.length ? s.threadOffset + 1 : 0}..${s.threadOffset + s.threads.length}/${s.threadCount}; totals may exceed this bounded page.`, { dimColor: true }))
  if (s.partial) {
    const pages = []
    if (s.threadOffset > 0) pages.push({ key: `managed-prev-${s.sessionId}`, label: 'Previous workers', onPress: () => { const spec = managedAction(s.sessionId, 'inspect', Math.max(0, s.threadOffset - 60)); if (spec) ask(spec) } })
    if (s.threadOffset + s.threads.length < s.threadCount && s.threadOffset + 60 <= 9999) pages.push({ key: `managed-next-${s.sessionId}`, label: 'Next workers', onPress: () => { const spec = managedAction(s.sessionId, 'inspect', s.threadOffset + 60); if (spec) ask(spec) } })
    rows.push(...flow(ctx, pages, `managed-pages-${s.sessionId}`))
  }
  if (s.blockedEventIds.length) rows.push(text(ctx, ` Pending decision IDs: ${s.blockedEventIds.slice(0, 4).join(', ')}. Inspect the current request before responding; no blanket approval control is offered.`, { color: THEME.warn }))
  rows.push(...flow(ctx, ['inspect', 'interrupt', 'terminate'].map(action => ({ key: `managed-${action}-${s.sessionId}`, label: `${action[0]!.toUpperCase()}${action.slice(1)}`, onPress: () => { const spec = managedAction(s.sessionId, action as 'inspect' | 'interrupt' | 'terminate'); if (spec) ask(spec) } })), 'managed-controls'))
  rows.push(text(ctx, ' Each action asks first and rechecks provider state and host policy at execution. Snapshot age never grants permission.', { dimColor: true }))
  return rows
}

export function managedBudgetRows(ctx: Ctx): RenderElement[] {
  const facts = ctx.state.snapshot?.managed
  if (!facts || facts.sessions.length === 0) return []
  return [rule(ctx, 'Managed cloud budgets', 'reported list cost; separate scope'),
    ...facts.sessions.map(s => kv(ctx, s.sessionId.slice(0, 16), `${budget(s)} · ${s.stopReason ?? s.status}`)),
    text(ctx, ' In-flight work can overshoot a cap. Unknown values are not zero; these sessions are not added to the local budget total.', { dimColor: true })]
}

export function managedApprovalRows(ctx: Ctx): RenderElement[] {
  const facts = ctx.state.snapshot?.managed
  if (!facts) return []
  const blocked = facts.sessions.filter(s => s.blockedEventIds.length > 0 || ['requires_action', 'budget_reached'].includes(s.stopReason ?? ''))
  if (!blocked.length) return []
  return [rule(ctx, 'Managed blockers', 'remote decisions require fresh inspection'), ...blocked.flatMap(s => [
    kv(ctx, s.sessionId.slice(0, 16), `${s.stopReason ?? 'pending decision'} · ${s.blockedEventIds.length} decision IDs${ctx.nowMs - s.updatedMs > MANAGED_STALE_MS || s.updatedMs > ctx.nowMs + 5000 ? ' · stale snapshot' : ''}`, THEME.warn),
    ...flow(ctx, [{ key: `managed-blocker-${s.sessionId}`, label: 'Inspect current request', onPress: () => { const spec = managedAction(s.sessionId, 'inspect'); if (spec) ctx.act.workflows.ask(spec) } }], `managed-blocker-row-${s.sessionId}`),
  ])]
}

export function managedLearningRows(ctx: Ctx): RenderElement[] {
  const facts = ctx.state.snapshot?.managedLearning
  if (!facts) return []
  const selected = facts.selected, evaluation = facts.evaluation
  return [rule(ctx, 'Managed workflow learning', 'advisory host reports; no automatic promotion'),
    kv(ctx, 'evidence', `${facts.verified} host-verified reported / ${facts.observations} observations · ${facts.quarantined} quarantined`),
    kv(ctx, 'separation', `${facts.training} training · ${facts.holdout} heldout; heldout outcomes do not train recommendations`),
    kv(ctx, 'suggestion', selected === null ? 'abstained or no recommendation recorded' : `${selected.id} · N=${selected.samples} · ${selected.successesPerDollar === null ? 'n/a' : selected.successesPerDollar.toFixed(2)} successes/$ · p95 ${selected.p95Ms === null ? 'n/a' : `${selected.p95Ms} ms`}`),
    ...(selected?.evidenceIds.length ? [kv(ctx, 'receipt IDs', selected.evidenceIds.map(h => h.slice(0, 12)).join(', '))] : []),
    kv(ctx, 'comparison', evaluation === null ? 'no heldout evaluation recorded' : `${evaluation.eligible ? 'eligible advisory result' : 'not eligible'} · ${evaluation.pairedResults} pairs · ${evaluation.delta === null ? 'n/a' : `${(evaluation.delta * 100).toFixed(1)}%`} efficiency change · no regression ${evaluation.noRegression ? 'reported' : 'not established'}`, THEME.info),
    text(ctx, ' Defaults remain unchanged. Summary files are display evidence, not verification authority.', { dimColor: true }),
    text(ctx, ' The runtime must revalidate signed receipts before routing.', { dimColor: true }),
    kv(ctx, 'updated', ago(facts.updatedMs, ctx.nowMs)),
  ]
}
