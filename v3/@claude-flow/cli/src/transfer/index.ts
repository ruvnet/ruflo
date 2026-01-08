/**
 * Transfer Module
 * Pattern export, import, anonymization, and IPFS sharing
 */

// Types
export * from './types.js';

// Serialization
export {
  createCFP,
  serializeToJson,
  serializeToBuffer,
  deserializeCFP,
  validateCFP,
  getFileExtension,
  detectFormat,
} from './serialization/cfp.js';

// Anonymization
export {
  detectPII,
  redactPII,
  anonymizeCFP,
  scanCFPForPII,
} from './anonymization/index.js';

// Export
export {
  exportPatterns,
  exportSeraphine,
  quickExport,
  quickExportToIPFS,
} from './export.js';

// IPFS
export {
  uploadToIPFS,
  pinContent,
  unpinContent,
  checkContent,
  getGatewayURL,
  getIPNSURL,
} from './ipfs/upload.js';

// Models
export {
  SERAPHINE_VERSION,
  SERAPHINE_METADATA,
  SERAPHINE_ROUTING_PATTERNS,
  SERAPHINE_COMPLEXITY_PATTERNS,
  SERAPHINE_COVERAGE_PATTERNS,
  SERAPHINE_TRAJECTORY_PATTERNS,
  SERAPHINE_CUSTOM_PATTERNS,
  createSeraphinePatterns,
  createSeraphineGenesis,
  getSeraphineInfo,
} from './models/seraphine.js';
