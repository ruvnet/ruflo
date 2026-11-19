/**
 * #4481 hive-mind scan: addNode() resolved a requested role for the node's
 * `role` field but passed the *raw* request to calculateInitialConnections().
 * In centralized/hierarchical topologies a second node requesting
 * coordinator/queen is downgraded to worker, yet was wired to every existing
 * node as if it were the leader.
 */

import { describe, expect, it } from 'vitest';
// Import the TS source explicitly: there is no generated .js for this module,
// and this keeps the implementation under test unambiguous.
import { createTopologyManager } from '../src/topology-manager.ts';

const CASES = [
  {
    type: 'centralized' as const,
    leaderRequest: 'coordinator' as const,
    leaderRole: 'coordinator' as const,
  },
  {
    type: 'hierarchical' as const,
    leaderRequest: 'queen' as const,
    leaderRole: 'queen' as const,
  },
];

describe('TopologyManager resolved-role initial connections (#4481)', () => {
  it.each(CASES)(
    'wires a downgraded $type leader only to the existing leader',
    async ({ type, leaderRequest, leaderRole }) => {
      const topology = createTopologyManager({
        type,
        maxAgents: 10,
        autoRebalance: false,
      });
      await topology.initialize();

      const leader = await topology.addNode('leader', leaderRequest);
      expect(leader.role).toBe(leaderRole);

      const worker = await topology.addNode('worker', 'worker');
      expect(worker.role).toBe('worker');
      expect(worker.connections).toEqual(['leader']);

      // A second request for the leader role is resolved to worker. It must
      // connect to the leader only, not to every pre-existing node.
      const downgraded = await topology.addNode('late-leader', leaderRequest);
      expect(downgraded.role).toBe('worker');
      expect(downgraded.connections).toEqual(['leader']);
      expect(topology.getNeighbors('late-leader')).toEqual(['leader']);
      expect(topology.isConnected('late-leader', 'leader')).toBe(true);
      expect(topology.isConnected('late-leader', 'worker')).toBe(false);
    },
  );
});
