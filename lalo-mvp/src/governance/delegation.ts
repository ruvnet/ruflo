import { EventEmitter } from 'events';
import {
  Delegation,
  VotingPower,
  DelegationError,
  DelegationSchema
} from '../types/index.js';

export interface DelegationEvents {
  'delegation:created': [Delegation];
  'delegation:revoked': [string, string]; // delegator, delegate
  'delegation:expired': [Delegation];
  'power:transferred': [string, string, number]; // from, to, amount
}

export class DelegationManager extends EventEmitter {
  private delegations = new Map<string, Delegation[]>(); // delegator -> delegations
  private delegates = new Map<string, Delegation[]>(); // delegate -> received delegations
  private maxDepth: number;

  constructor(maxDepth: number = 3) {
    super();
    this.maxDepth = maxDepth;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('delegation:created', (delegation) => {
      console.log(`Delegation created: ${delegation.delegator} -> ${delegation.delegate}`);
    });

    this.on('delegation:revoked', (delegator, delegate) => {
      console.log(`Delegation revoked: ${delegator} -> ${delegate}`);
    });
  }

  /**
   * Create a new delegation
   */
  async createDelegation(
    delegator: string,
    delegate: string,
    power: number,
    scope: 'all' | 'category' | 'specific',
    restrictions?: string[],
    expiresAt?: Date
  ): Promise<string> {
    // Validate delegation data
    const delegationData = {
      delegator,
      delegate,
      power,
      scope,
      restrictions,
      expiresAt
    };

    try {
      DelegationSchema.parse(delegationData);
    } catch (error) {
      throw new DelegationError('Invalid delegation data', { validationError: error });
    }

    // Check for circular delegation
    if (this.wouldCreateCircularDelegation(delegator, delegate)) {
      throw new DelegationError(
        `Circular delegation detected: ${delegator} -> ${delegate}`
      );
    }

    // Check delegation depth
    const delegationDepth = this.getDelegationDepth(delegate);
    if (delegationDepth >= this.maxDepth) {
      throw new DelegationError(
        `Maximum delegation depth exceeded: ${delegationDepth + 1} > ${this.maxDepth}`
      );
    }

    // Check if delegator has enough power
    const availablePower = this.getAvailableDelegationPower(delegator);
    if (availablePower < power) {
      throw new DelegationError(
        `Insufficient delegation power. Available: ${availablePower}, Requested: ${power}`
      );
    }

    const delegation: Delegation = {
      delegator,
      delegate,
      power,
      scope,
      restrictions,
      expiresAt,
      createdAt: new Date(),
      isActive: true
    };

    // Store delegation
    if (!this.delegations.has(delegator)) {
      this.delegations.set(delegator, []);
    }
    if (!this.delegates.has(delegate)) {
      this.delegates.set(delegate, []);
    }

    this.delegations.get(delegator)!.push(delegation);
    this.delegates.get(delegate)!.push(delegation);

    this.emit('delegation:created', delegation);
    this.emit('power:transferred', delegator, delegate, power);

    return `${delegator}-${delegate}-${Date.now()}`;
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(delegator: string, delegate: string): Promise<void> {
    const delegatorDelegations = this.delegations.get(delegator) || [];
    const delegateReceived = this.delegates.get(delegate) || [];

    // Find and remove the delegation
    const delegationIndex = delegatorDelegations.findIndex(
      d => d.delegate === delegate && d.isActive
    );

    if (delegationIndex === -1) {
      throw new DelegationError(`No active delegation found: ${delegator} -> ${delegate}`);
    }

    const delegation = delegatorDelegations[delegationIndex];
    delegation.isActive = false;

    // Remove from delegate's received list
    const receivedIndex = delegateReceived.findIndex(
      d => d.delegator === delegator && d.isActive
    );
    if (receivedIndex !== -1) {
      delegateReceived[receivedIndex].isActive = false;
    }

    this.emit('delegation:revoked', delegator, delegate);
    this.emit('power:transferred', delegate, delegator, delegation.power);
  }

  /**
   * Get effective voting power including delegations
   */
  getEffectiveVotingPower(
    address: string,
    basePower: number,
    scope?: string
  ): number {
    let effectivePower = basePower;

    // Add delegated power received
    const receivedDelegations = this.delegates.get(address) || [];
    for (const delegation of receivedDelegations) {
      if (delegation.isActive && !this.isDelegationExpired(delegation)) {
        if (!scope || this.delegationApplies(delegation, scope)) {
          effectivePower += delegation.power;
        }
      }
    }

    // Subtract delegated power given away
    const givenDelegations = this.delegations.get(address) || [];
    for (const delegation of givenDelegations) {
      if (delegation.isActive && !this.isDelegationExpired(delegation)) {
        if (!scope || this.delegationApplies(delegation, scope)) {
          effectivePower -= delegation.power;
        }
      }
    }

    return Math.max(0, effectivePower);
  }

  /**
   * Get delegation chain for an address
   */
  getDelegationChain(address: string, visited = new Set<string>()): string[] {
    if (visited.has(address)) {
      return []; // Circular delegation detected
    }

    visited.add(address);
    const chain = [address];

    const receivedDelegations = this.delegates.get(address) || [];
    for (const delegation of receivedDelegations) {
      if (delegation.isActive && !this.isDelegationExpired(delegation)) {
        const subChain = this.getDelegationChain(delegation.delegator, visited);
        chain.push(...subChain);
      }
    }

    visited.delete(address);
    return chain;
  }

  /**
   * Get all delegations for an address
   */
  getDelegations(address: string): {
    given: Delegation[];
    received: Delegation[];
  } {
    return {
      given: (this.delegations.get(address) || []).filter(d => d.isActive),
      received: (this.delegates.get(address) || []).filter(d => d.isActive)
    };
  }

  /**
   * Clean up expired delegations
   */
  cleanupExpiredDelegations(): number {
    let cleanedCount = 0;

    for (const [delegator, delegations] of this.delegations.entries()) {
      for (const delegation of delegations) {
        if (delegation.isActive && this.isDelegationExpired(delegation)) {
          delegation.isActive = false;
          cleanedCount++;
          this.emit('delegation:expired', delegation);
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Get delegation statistics
   */
  getDelegationStats(): {
    totalDelegations: number;
    activeDelegations: number;
    totalDelegators: number;
    totalDelegates: number;
    avgDelegationPower: number;
  } {
    let totalDelegations = 0;
    let activeDelegations = 0;
    let totalPower = 0;

    for (const delegations of this.delegations.values()) {
      for (const delegation of delegations) {
        totalDelegations++;
        if (delegation.isActive && !this.isDelegationExpired(delegation)) {
          activeDelegations++;
          totalPower += delegation.power;
        }
      }
    }

    return {
      totalDelegations,
      activeDelegations,
      totalDelegators: this.delegations.size,
      totalDelegates: this.delegates.size,
      avgDelegationPower: activeDelegations > 0 ? totalPower / activeDelegations : 0
    };
  }

  // Private helper methods
  private wouldCreateCircularDelegation(delegator: string, delegate: string): boolean {
    const chain = this.getDelegationChain(delegate);
    return chain.includes(delegator);
  }

  private getDelegationDepth(address: string, visited = new Set<string>()): number {
    if (visited.has(address)) {
      return 0; // Prevent infinite recursion
    }

    visited.add(address);
    let maxDepth = 0;

    const receivedDelegations = this.delegates.get(address) || [];
    for (const delegation of receivedDelegations) {
      if (delegation.isActive && !this.isDelegationExpired(delegation)) {
        const depth = 1 + this.getDelegationDepth(delegation.delegator, visited);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    visited.delete(address);
    return maxDepth;
  }

  private getAvailableDelegationPower(delegator: string): number {
    // This would need to be integrated with the main voting power system
    // For now, return a default value
    return 1000; // Placeholder
  }

  private isDelegationExpired(delegation: Delegation): boolean {
    return delegation.expiresAt ? new Date() > delegation.expiresAt : false;
  }

  private delegationApplies(delegation: Delegation, scope: string): boolean {
    switch (delegation.scope) {
      case 'all':
        return true;
      case 'category':
        return delegation.restrictions?.includes(scope) || false;
      case 'specific':
        return delegation.restrictions?.includes(scope) || false;
      default:
        return false;
    }
  }
}

export default DelegationManager;