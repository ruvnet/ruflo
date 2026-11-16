/**
 * Swarm view agent ordering & selection parity: busy workers and active swarm
 * members sort ahead of unattached idle agents so active workers are never hidden
 * below the 10-row console cutoff, and j/k selection follows the same order.
 */
import { describe, expect, it } from 'vitest'

import type { AgentRecord, SwarmInfo } from '../hooks/data/parse'
import { sortAgentsForDisplay } from '../hooks/data/swarm-status'
import { selection } from '../hooks/views/select'
import { newState } from '../hooks/state'

describe('swarm agent display ordering', () => {
  const swarm: SwarmInfo = {
    id: 'swarm-1',
    topology: 'hierarchical',
    status: 'running',
    agentIds: ['member-idle', 'member-busy'],
  }

  const agents: AgentRecord[] = [
    { id: 'old-stopped', type: 'coder', status: 'terminated', taskCount: 99 },
    { id: 'other-idle', type: 'coder', status: 'idle', taskCount: 10 },
    { id: 'member-idle', type: 'tester', status: 'idle', taskCount: 1 },
    { id: 'other-busy', type: 'coder', status: 'working', taskCount: 0 },
    { id: 'member-busy', type: 'reviewer', status: 'busy', taskCount: 3 },
  ]

  it('orders busy/working first, then active swarm members, then higher taskCount, and stopped last', () => {
    const sorted = sortAgentsForDisplay(agents, swarm)

    expect(sorted.map(a => a.id)).toEqual([
      'member-busy',
      'other-busy',
      'member-idle',
      'other-idle',
      'old-stopped',
    ])
  })

  it('aligns selection().agent with the sorted Swarm display order', () => {
    const state = newState({})

    state.snapshot = {
      swarm,
      agents,
      claims: [],
      tasks: [],
    } as never
    state.select.agent = 0

    expect(selection(state).agent?.id).toBe('member-busy')
  })
})
