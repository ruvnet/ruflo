export function isTruthScore(obj) {
    return typeof obj === 'object' && obj !== null && typeof obj.score === 'number' && typeof obj.components === 'object' && obj.timestamp instanceof Date;
}
export function isVerificationResult(obj) {
    return typeof obj === 'object' && obj !== null && typeof obj.id === 'string' && typeof obj.status === 'string' && typeof obj.passed === 'boolean';
}
export function isAgentClaim(obj) {
    return typeof obj === 'object' && obj !== null && typeof obj.id === 'string' && typeof obj.type === 'string' && obj.submittedAt instanceof Date;
}
export function isStateSnapshot(obj) {
    return typeof obj === 'object' && obj !== null && typeof obj.id === 'string' && obj.timestamp instanceof Date && typeof obj.checksum === 'string';
}
export const VERIFICATION_CONSTANTS = {
    DEFAULT_TRUTH_THRESHOLD: 0.95,
    DEFAULT_CONFIDENCE_LEVEL: 0.95,
    DEFAULT_MIN_SAMPLE_SIZE: 30,
    DEFAULT_MAX_ERROR_MARGIN: 0.05,
    DEFAULT_VERIFICATION_TIMEOUT: 5 * 60 * 1000,
    DEFAULT_CHECKPOINT_TIMEOUT: 2 * 60 * 1000,
    DEFAULT_CLAIM_VALIDATION_TIMEOUT: 1 * 60 * 1000,
    DEFAULT_TEST_TIMEOUT: 10 * 60 * 1000,
    DEFAULT_ROLLBACK_TIMEOUT: 3 * 60 * 1000,
    DEFAULT_RETRY_ATTEMPTS: 3,
    MAX_RETRY_ATTEMPTS: 10,
    DEFAULT_MAX_SNAPSHOTS: 100,
    DEFAULT_SNAPSHOT_RETENTION_DAYS: 30,
    DEFAULT_COMPRESSION_THRESHOLD: 1024 * 1024,
    MIN_TRUTH_SCORE: 0.0,
    MAX_TRUTH_SCORE: 1.0,
    HIGH_CONFIDENCE_THRESHOLD: 0.9,
    MEDIUM_CONFIDENCE_THRESHOLD: 0.7,
    LOW_CONFIDENCE_THRESHOLD: 0.5,
    MAX_VERIFICATION_MEMORY: 512 * 1024 * 1024,
    MAX_SNAPSHOT_SIZE: 1024 * 1024 * 1024,
    MAX_TEST_DURATION: 60 * 60 * 1000
};
export default {
    VERIFICATION_CONSTANTS,
    isTruthScore,
    isVerificationResult,
    isAgentClaim,
    isStateSnapshot
};

//# sourceMappingURL=types.js.map