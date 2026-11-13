/**
 * Pattern Download Service
 * Secure download and verification of patterns from IPFS
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  PatternEntry,
  DownloadOptions,
  DownloadResult,
  StoreConfig,
} from './types.js';
import { DEFAULT_STORE_CONFIG } from './registry.js';
import type { CFPFormat } from '../types.js';
import { sanitizeName, assertInside, verifyEd25519 } from './security.js';

/**
 * Download progress callback
 */
export type DownloadProgressCallback = (progress: {
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
}) => void;

/**
 * Pattern Downloader
 * Handles secure download and verification of patterns
 */
export class PatternDownloader {
  private config: StoreConfig;
  private downloadCache: Map<string, { path: string; downloadedAt: number }>;

  constructor(config: Partial<StoreConfig> = {}) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
    this.downloadCache = new Map();
  }

  /**
   * Download a pattern from IPFS
   */
  async downloadPattern(
    pattern: PatternEntry,
    options: DownloadOptions = {},
    onProgress?: DownloadProgressCallback
  ): Promise<DownloadResult> {
    console.log(`[Download] Starting download: ${pattern.displayName}`);
    console.log(`[Download] CID: ${pattern.cid}`);
    console.log(`[Download] Size: ${pattern.size} bytes`);

    // Check cache
    const cached = this.downloadCache.get(pattern.cid);
    if (cached && fs.existsSync(cached.path)) {
      console.log(`[Download] Found in cache: ${cached.path}`);
      return {
        success: true,
        pattern,
        outputPath: cached.path,
        imported: false,
        verified: true,
        size: pattern.size,
      };
    }

    try {
      // Determine output path
      const outputPath = this.resolveOutputPath(pattern, options);
      console.log(`[Download] Output path: ${outputPath}`);

      // Ensure directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Fetch from IPFS
      const content = await this.fetchFromIPFS(pattern.cid, onProgress);

      if (!content) {
        return {
          success: false,
          pattern,
          verified: false,
          size: 0,
        };
      }

      // Verify checksum
      let verified = false;
      if (options.verify !== false) {
        verified = this.verifyChecksum(content, pattern.checksum);
        if (!verified) {
          console.warn(`[Download] Warning: Checksum verification failed!`);
          if (this.config.requireVerification) {
            return {
              success: false,
              pattern,
              verified: false,
              size: content.length,
            };
          }
        } else {
          console.log(`[Download] Checksum verified!`);
        }
      }

      // Verify the signature (#4750). A signature that does not verify against
      // the resolved key is refused rather than written. When requireVerification
      // is on, verification must be backed by a *pinned* key: a self-declared
      // pattern.publicKey is not trusted, so an entry that supplies its own key
      // is refused rather than allowed to self-sign.
      const { key: trustedKey, pinned } = this.resolveVerificationKey(pattern);
      if (this.config.requireVerification && !pinned) {
        console.warn(
          `[Download] requireVerification is on but no trusted (pinned) key is configured for ${pattern.id}; refusing self-declared key. Configure StoreConfig.trustedRegistryPublicKeys to download this pattern, or disable requireVerification.`
        );
        return {
          success: false,
          pattern,
          verified: false,
          size: content.length,
        };
      }
      if (pattern.signature && trustedKey) {
        const sigVerified = await verifyEd25519(content, pattern.signature, trustedKey);
        if (!sigVerified) {
          console.warn(`[Download] Signature verification failed against trusted key, not writing the pattern.`);
          return {
            success: false,
            pattern,
            verified: false,
            size: content.length,
          };
        }
        console.log(`[Download] Signature verified!`);
        verified = true;
      } else if (this.config.requireVerification) {
        console.warn(`[Download] No verifiable signature and requireVerification is on, not writing the pattern.`);
        return {
          success: false,
          pattern,
          verified: false,
          size: content.length,
        };
      }

      // Write to file
      fs.writeFileSync(outputPath, content);
      console.log(`[Download] Written to: ${outputPath}`);

      // Update cache
      this.downloadCache.set(pattern.cid, {
        path: outputPath,
        downloadedAt: Date.now(),
      });

      // Import if requested
      let imported = false;
      if (options.import) {
        imported = await this.importPattern(outputPath, options.importStrategy);
      }

      return {
        success: true,
        pattern,
        outputPath,
        imported,
        verified,
        size: content.length,
      };
    } catch (error) {
      console.error(`[Download] Failed:`, error);
      return {
        success: false,
        pattern,
        verified: false,
        size: 0,
      };
    }
  }

  /**
   * Fetch content from IPFS gateway or GCS
   */
  private async fetchFromIPFS(
    cid: string,
    onProgress?: DownloadProgressCallback
  ): Promise<Buffer | null> {
    // Check if this is a GCS URI
    if (cid.startsWith('gs://')) {
      return this.fetchFromGCS(cid, onProgress);
    }

    const url = `${this.config.gateway}/ipfs/${cid}`;
    console.log(`[Download] Fetching: ${url}`);

    try {
      return await this.fetchBounded(url, onProgress);
    } catch (error) {
      console.error(`[Download] Fetch failed:`, error);

      // Try alternative gateways
      const alternativeGateways = [
        'https://ipfs.io',
        'https://cloudflare-ipfs.com',
        'https://dweb.link',
        'https://gateway.pinata.cloud',
      ];

      for (const gateway of alternativeGateways) {
        if (gateway === this.config.gateway) continue;
        try {
          console.log(`[Download] Trying alternative gateway: ${gateway}`);
          return await this.fetchBounded(`${gateway}/ipfs/${cid}`, onProgress);
        } catch {
          // Continue to next gateway
        }
      }

      return null;
    }
  }

  /**
   * Fetch a single URL with a hard timeout and a byte cap (#4750). The timeout
   * aborts the request; the byte cap aborts mid-stream once exceeded. Both
   * protect against a registry serving a hung or oversized response.
   */
  private async fetchBounded(
    url: string,
    onProgress?: DownloadProgressCallback
  ): Promise<Buffer | null> {
    const maxBytes = this.config.maxBytes ?? 8 * 1024 * 1024;
    const timeoutMs = this.config.timeout ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        console.error(`[Download] HTTP ${response.status}: ${response.statusText}`);
        return null;
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > maxBytes) {
        throw new Error(`content-length ${contentLength} exceeds maxBytes ${maxBytes}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let downloaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          downloaded += value.length;
          if (downloaded > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error(`download exceeded maxBytes ${maxBytes}`);
          }

          chunks.push(value);
          if (onProgress && contentLength > 0) {
            onProgress({
              bytesDownloaded: downloaded,
              totalBytes: contentLength,
              percentage: Math.round((downloaded / contentLength) * 100),
            });
          }
        }

        const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        console.log(`[Download] Downloaded ${buffer.length} bytes from ${url}`);
        return buffer;
      }

      // No stream body: read the whole thing, then check the cap.
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > maxBytes) {
        throw new Error(`download exceeded maxBytes ${maxBytes}`);
      }
      console.log(`[Download] Downloaded ${buffer.length} bytes from ${url}`);
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch content from Google Cloud Storage
   */
  private async fetchFromGCS(
    uri: string,
    onProgress?: DownloadProgressCallback
  ): Promise<Buffer | null> {
    console.log(`[Download] Fetching from GCS: ${uri}`);

    try {
      const { downloadFromGCS, hasGCSCredentials } = await import('../storage/gcs.js');

      if (!hasGCSCredentials()) {
        console.error(`[Download] GCS not configured`);
        return null;
      }

      const buffer = await downloadFromGCS(uri);

      if (buffer && onProgress) {
        onProgress({
          bytesDownloaded: buffer.length,
          totalBytes: buffer.length,
          percentage: 100,
        });
      }

      return buffer;
    } catch (error) {
      console.error(`[Download] GCS fetch failed:`, error);
      return null;
    }
  }

  /**
   * Verify content checksum
   */
  private verifyChecksum(content: Buffer, expectedChecksum: string): boolean {
    const actualChecksum = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return actualChecksum === expectedChecksum;
  }

  /**
   * Verify an Ed25519 signature over the content. Any error is a failure.
   */
  private async verifySignature(
    content: Buffer,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    if (!signature.startsWith('ed25519:') || !publicKey.startsWith('ed25519:')) {
      return false;
    }
    try {
      const ed = await import('@noble/ed25519');
      const sigBytes = Buffer.from(signature.slice('ed25519:'.length), 'hex');
      const pubBytes = Buffer.from(publicKey.slice('ed25519:'.length), 'hex');
      if (sigBytes.length !== 64 || pubBytes.length !== 32) {
        return false;
      }
      // RFC 8032 strict mode, as in transfer/ipfs/client.ts.
      return await ed.verifyAsync(sigBytes, content, pubBytes, { zip215: false });
    } catch {
      return false;
    }
  }

  /**
   * Resolve the Ed25519 public key a pattern's signature must verify against
   * (#4750). Returns whether the key is *pinned* (came from the operator's
   * config.trustedRegistryPublicKeys) or merely the entry's own self-declared
   * publicKey. Callers that enforce verification must treat a self-declared key
   * as untrusted: otherwise a malicious registry entry can sign its own content
   * with its own key and pass (the exact gap #4750 was filed to close).
   */
  private resolveVerificationKey(pattern: PatternEntry): { key: string | null; pinned: boolean } {
    const trusted = this.config.trustedRegistryPublicKeys;
    if (trusted) {
      const candidates = [pattern.author?.id, pattern.source, pattern.id].filter(Boolean) as string[];
      for (const key of candidates) {
        const pinned = trusted[key];
        if (pinned && pinned.startsWith('ed25519:')) {
          return { key: pinned, pinned: true };
        }
      }
      // Any configured key also matches a pattern that declares the same key.
      if (pattern.publicKey && Object.values(trusted).includes(pattern.publicKey)) {
        return { key: pattern.publicKey, pinned: true };
      }
    }
    if (pattern.publicKey && pattern.publicKey.startsWith('ed25519:')) {
      return { key: pattern.publicKey, pinned: false };
    }
    return { key: null, pinned: false };
  }

  /**
   * Thin wrapper kept for callers that only need a usable key.
   */
  private resolveTrustedPublicKey(pattern: PatternEntry): string | null {
    return this.resolveVerificationKey(pattern).key;
  }

  /**
   * Sanitize a pattern's name/version and assert the resulting path stays inside
   * the cache directory before anything is written (#4750).
   */
  private sanitizeAndAssertOutput(fileName: string, baseDir: string): string {
    // fileName is a single path component already assembled from sanitized
    // name/version; re-sanitize defensively and assert containment.
    const safe = sanitizeName(fileName);
    const resolvedBase = path.resolve(baseDir);
    const target = path.join(resolvedBase, safe);
    return assertInside(resolvedBase, target);
  }

  /**
   * Resolve output path for pattern
   */
  private resolveOutputPath(pattern: PatternEntry, options: DownloadOptions): string {
    if (options.output) {
      // If output is a directory, append filename
      if (fs.existsSync(options.output) && fs.statSync(options.output).isDirectory()) {
        const fileName = `${sanitizeName(pattern.name)}.cfp.json`;
        return this.sanitizeAndAssertOutput(fileName, options.output);
      }
      return options.output;
    }

    // Default: cache directory. Name and version come from an untrusted registry
    // entry, so sanitize both and assert the final path stays inside cacheDir
    // (#4750 path traversal).
    const cacheDir = path.resolve(this.config.cacheDir);
    const fileName = `${sanitizeName(pattern.name)}-${sanitizeName(pattern.version)}.cfp.json`;
    return this.sanitizeAndAssertOutput(fileName, cacheDir);
  }

  /**
   * Import downloaded pattern
   */
  private async importPattern(
    filePath: string,
    strategy: 'replace' | 'merge' | 'append' = 'merge'
  ): Promise<boolean> {
    console.log(`[Download] Importing pattern with strategy: ${strategy}`);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const cfp: CFPFormat = JSON.parse(content);

      // In production: Import to local pattern store
      // For demo: Just validate
      if (cfp.magic !== 'CFP1') {
        console.error(`[Download] Invalid CFP format`);
        return false;
      }

      console.log(`[Download] Pattern imported: ${cfp.metadata.name}`);
      return true;
    } catch (error) {
      console.error(`[Download] Import failed:`, error);
      return false;
    }
  }

  // NOTE: generateMockContent removed - using real HTTP fetch from IPFS gateways or GCS

  /**
   * Clear download cache
   */
  clearCache(): void {
    this.downloadCache.clear();
    console.log(`[Download] Cache cleared`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; totalSize: number } {
    let totalSize = 0;

    for (const { path: cachedPath } of this.downloadCache.values()) {
      if (fs.existsSync(cachedPath)) {
        totalSize += fs.statSync(cachedPath).size;
      }
    }

    return {
      count: this.downloadCache.size,
      totalSize,
    };
  }
}

/**
 * Batch download multiple patterns
 */
export async function batchDownload(
  patterns: PatternEntry[],
  options: DownloadOptions = {},
  config?: Partial<StoreConfig>
): Promise<DownloadResult[]> {
  const downloader = new PatternDownloader(config);
  const results: DownloadResult[] = [];

  for (const pattern of patterns) {
    const result = await downloader.downloadPattern(pattern, options);
    results.push(result);
  }

  return results;
}

/**
 * Create downloader with default config
 */
export function createDownloader(config?: Partial<StoreConfig>): PatternDownloader {
  return new PatternDownloader(config);
}
