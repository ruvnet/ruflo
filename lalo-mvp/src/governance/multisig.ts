import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import {
  Proposal,
  MultiSigSignature,
  MultiSigError,
  MultiSigSchema
} from '../types/index.js';

export interface MultiSigEvents {
  'signature:added': [string, MultiSigSignature]; // proposalId, signature
  'signature:verified': [string, string]; // proposalId, signer
  'threshold:reached': [string, number]; // proposalId, signatureCount
  'signature:revoked': [string, string]; // proposalId, signer
}

export interface MultiSigConfig {
  threshold: number;
  signers: string[];
  requireAllSigners: boolean;
  signatureTimeout: number; // milliseconds
  allowRevokeSignatures: boolean;
}

export class MultiSigManager extends EventEmitter {
  private signatures = new Map<string, Map<string, MultiSigSignature>>(); // proposalId -> signer -> signature
  private configs = new Map<string, MultiSigConfig>(); // proposalId -> config
  private proposalHashes = new Map<string, string>(); // proposalId -> hash

  constructor() {
    super();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('signature:added', (proposalId, signature) => {
      console.log(`Multi-sig signature added for proposal ${proposalId} by ${signature.signer}`);
    });

    this.on('threshold:reached', (proposalId, count) => {
      console.log(`Multi-sig threshold reached for proposal ${proposalId}: ${count} signatures`);
    });
  }

  /**
   * Initialize multi-sig requirements for a proposal
   */
  initializeMultiSig(
    proposalId: string,
    proposal: Proposal,
    config: Partial<MultiSigConfig> = {}
  ): void {
    if (this.configs.has(proposalId)) {
      throw new MultiSigError(`Multi-sig already initialized for proposal: ${proposalId}`);
    }

    const defaultConfig: MultiSigConfig = {
      threshold: 2,
      signers: proposal.requiredApprovals,
      requireAllSigners: false,
      signatureTimeout: 24 * 60 * 60 * 1000, // 24 hours
      allowRevokeSignatures: true
    };

    const finalConfig = { ...defaultConfig, ...config };

    if (finalConfig.threshold > finalConfig.signers.length) {
      throw new MultiSigError(
        `Threshold (${finalConfig.threshold}) cannot exceed number of signers (${finalConfig.signers.length})`
      );
    }

    this.configs.set(proposalId, finalConfig);
    this.signatures.set(proposalId, new Map());

    // Generate and store proposal hash
    const proposalHash = this.generateProposalHash(proposal);
    this.proposalHashes.set(proposalId, proposalHash);
  }

  /**
   * Add a signature to a proposal
   */
  async addSignature(
    proposalId: string,
    signer: string,
    signature: string
  ): Promise<void> {
    const config = this.configs.get(proposalId);
    if (!config) {
      throw new MultiSigError(`Multi-sig not initialized for proposal: ${proposalId}`);
    }

    // Verify signer is authorized
    if (!config.signers.includes(signer)) {
      throw new MultiSigError(`Signer not authorized for this proposal: ${signer}`);
    }

    const proposalSignatures = this.signatures.get(proposalId)!;

    // Check if signer has already signed
    if (proposalSignatures.has(signer)) {
      throw new MultiSigError(`Signer has already signed this proposal: ${signer}`);
    }

    // Verify signature
    const proposalHash = this.proposalHashes.get(proposalId)!;
    if (!this.verifySignature(signature, proposalHash, signer)) {
      throw new MultiSigError(`Invalid signature from signer: ${signer}`);
    }

    // Validate signature data
    const signatureData = {
      signer,
      signature,
      proposalHash
    };

    try {
      MultiSigSchema.parse(signatureData);
    } catch (error) {
      throw new MultiSigError('Invalid signature data', { validationError: error });
    }

    const multiSigSignature: MultiSigSignature = {
      signer,
      signature,
      timestamp: new Date(),
      proposalHash
    };

    proposalSignatures.set(signer, multiSigSignature);

    this.emit('signature:added', proposalId, multiSigSignature);
    this.emit('signature:verified', proposalId, signer);

    // Check if threshold is reached
    const signatureCount = proposalSignatures.size;
    if (this.isThresholdReached(proposalId)) {
      this.emit('threshold:reached', proposalId, signatureCount);
    }
  }

  /**
   * Revoke a signature
   */
  async revokeSignature(proposalId: string, signer: string): Promise<void> {
    const config = this.configs.get(proposalId);
    if (!config) {
      throw new MultiSigError(`Multi-sig not initialized for proposal: ${proposalId}`);
    }

    if (!config.allowRevokeSignatures) {
      throw new MultiSigError('Signature revocation not allowed for this proposal');
    }

    const proposalSignatures = this.signatures.get(proposalId)!;

    if (!proposalSignatures.has(signer)) {
      throw new MultiSigError(`No signature found from signer: ${signer}`);
    }

    proposalSignatures.delete(signer);
    this.emit('signature:revoked', proposalId, signer);
  }

  /**
   * Check if multi-sig threshold is reached
   */
  isThresholdReached(proposalId: string): boolean {
    const config = this.configs.get(proposalId);
    const signatures = this.signatures.get(proposalId);

    if (!config || !signatures) {
      return false;
    }

    if (config.requireAllSigners) {
      return signatures.size === config.signers.length;
    }

    return signatures.size >= config.threshold;
  }

  /**
   * Check if all required signers have signed
   */
  isFullySigned(proposalId: string): boolean {
    const config = this.configs.get(proposalId);
    const signatures = this.signatures.get(proposalId);

    if (!config || !signatures) {
      return false;
    }

    return signatures.size === config.signers.length;
  }

  /**
   * Get signature status for a proposal
   */
  getSignatureStatus(proposalId: string): {
    signatureCount: number;
    requiredSignatures: number;
    thresholdReached: boolean;
    fullySigned: boolean;
    remainingSigners: string[];
    signedBy: string[];
    progress: number;
  } {
    const config = this.configs.get(proposalId);
    const signatures = this.signatures.get(proposalId);

    if (!config || !signatures) {
      throw new MultiSigError(`Multi-sig not found for proposal: ${proposalId}`);
    }

    const signedBy = Array.from(signatures.keys());
    const remainingSigners = config.signers.filter(signer => !signedBy.includes(signer));
    const requiredSignatures = config.requireAllSigners ? config.signers.length : config.threshold;

    return {
      signatureCount: signatures.size,
      requiredSignatures,
      thresholdReached: this.isThresholdReached(proposalId),
      fullySigned: this.isFullySigned(proposalId),
      remainingSigners,
      signedBy,
      progress: signatures.size / requiredSignatures
    };
  }

  /**
   * Get all signatures for a proposal
   */
  getSignatures(proposalId: string): MultiSigSignature[] {
    const signatures = this.signatures.get(proposalId);
    if (!signatures) {
      throw new MultiSigError(`Multi-sig not found for proposal: ${proposalId}`);
    }

    return Array.from(signatures.values());
  }

  /**
   * Verify a signature
   */
  private verifySignature(signature: string, proposalHash: string, signer: string): boolean {
    // In a real implementation, this would use proper cryptographic verification
    // For now, we'll do a simple hash-based verification
    const expectedSignature = createHash('sha256')
      .update(`${proposalHash}:${signer}`)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Generate a hash for a proposal
   */
  private generateProposalHash(proposal: Proposal): string {
    const proposalString = JSON.stringify({
      id: proposal.id,
      title: proposal.title,
      description: proposal.description,
      type: proposal.type,
      category: proposal.category,
      executionData: proposal.executionData
    });

    return createHash('sha256').update(proposalString).digest('hex');
  }

  /**
   * Clean up expired signatures
   */
  cleanupExpiredSignatures(): number {
    let cleanedCount = 0;
    const now = new Date();

    for (const [proposalId, signatures] of this.signatures.entries()) {
      const config = this.configs.get(proposalId);
      if (!config) continue;

      for (const [signer, signature] of signatures.entries()) {
        const expirationTime = new Date(signature.timestamp.getTime() + config.signatureTimeout);
        if (now > expirationTime) {
          signatures.delete(signer);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Get multi-sig statistics
   */
  getMultiSigStats(): {
    totalProposals: number;
    completedMultiSigs: number;
    pendingMultiSigs: number;
    avgSignatureTime: number;
    avgThreshold: number;
  } {
    const proposals = Array.from(this.configs.keys());
    let completedCount = 0;
    let totalThreshold = 0;
    let totalSignatureTime = 0;
    let signatureCount = 0;

    for (const proposalId of proposals) {
      const config = this.configs.get(proposalId)!;
      const signatures = this.signatures.get(proposalId)!;

      totalThreshold += config.threshold;

      if (this.isThresholdReached(proposalId)) {
        completedCount++;
      }

      // Calculate average signature time
      for (const signature of signatures.values()) {
        totalSignatureTime += signature.timestamp.getTime();
        signatureCount++;
      }
    }

    return {
      totalProposals: proposals.length,
      completedMultiSigs: completedCount,
      pendingMultiSigs: proposals.length - completedCount,
      avgSignatureTime: signatureCount > 0 ? totalSignatureTime / signatureCount : 0,
      avgThreshold: proposals.length > 0 ? totalThreshold / proposals.length : 0
    };
  }

  /**
   * Remove multi-sig configuration and signatures for a proposal
   */
  removeMultiSig(proposalId: string): void {
    this.configs.delete(proposalId);
    this.signatures.delete(proposalId);
    this.proposalHashes.delete(proposalId);
  }

  /**
   * Get multi-sig configuration for a proposal
   */
  getConfig(proposalId: string): MultiSigConfig | undefined {
    return this.configs.get(proposalId);
  }

  /**
   * Update multi-sig configuration (only if no signatures exist)
   */
  updateConfig(proposalId: string, updates: Partial<MultiSigConfig>): void {
    const config = this.configs.get(proposalId);
    if (!config) {
      throw new MultiSigError(`Multi-sig not found for proposal: ${proposalId}`);
    }

    const signatures = this.signatures.get(proposalId)!;
    if (signatures.size > 0) {
      throw new MultiSigError('Cannot update multi-sig config after signatures have been added');
    }

    const updatedConfig = { ...config, ...updates };

    if (updatedConfig.threshold > updatedConfig.signers.length) {
      throw new MultiSigError(
        `Threshold (${updatedConfig.threshold}) cannot exceed number of signers (${updatedConfig.signers.length})`
      );
    }

    this.configs.set(proposalId, updatedConfig);
  }
}

export default MultiSigManager;