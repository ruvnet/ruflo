/**
 * @claude-flow/browser - Security Integration
 * AIDefence integration for URL validation, PII detection, and threat scanning
 */

import { z } from 'zod';

// ============================================================================
// Security Types
// ============================================================================

export interface ThreatScanResult {
  safe: boolean;
  threats: Threat[];
  pii: PIIMatch[];
  score: number; // 0-1 (1 = safe)
  scanDuration: number;
}

export interface Threat {
  type: ThreatType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location?: string;
  mitigation?: string;
}

export type ThreatType =
  | 'xss'
  | 'injection'
  | 'phishing'
  | 'malware'
  | 'data-exfiltration'
  | 'credential-theft'
  | 'insecure-protocol'
  | 'suspicious-redirect'
  | 'blocked-domain';

export interface PIIMatch {
  type: PIIType;
  value: string;
  masked: string;
  location: string;
  confidence: number;
}

export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit-card'
  | 'api-key'
  | 'password'
  | 'address'
  | 'name';

export interface SecurityConfig {
  enableUrlValidation: boolean;
  enablePIIDetection: boolean;
  enableThreatScanning: boolean;
  blockedDomains: string[];
  allowedDomains: string[];
  maxRedirects: number;
  requireHttps: boolean;
  piiMaskingEnabled: boolean;
}

// ============================================================================
// Validation Schemas
// ============================================================================

export const URLValidationSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  { message: 'Invalid URL or unsupported protocol' }
);

// ============================================================================
// PII Detection Patterns
// ============================================================================

const PII_PATTERNS: Record<PIIType, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  'credit-card': /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  'api-key': /\b(?:sk[-_]|api[-_]?key[-_]?|token[-_]?)[a-zA-Z0-9]{20,}\b/gi,
  password: /(?:password|passwd|pwd)[\s:=]+[^\s]{6,}/gi,
  address: /\b\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct)\b/gi,
  name: /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s|$)/g,
};

// ============================================================================
// Known Threats
// ============================================================================

const PHISHING_INDICATORS = [
  'login-verify',
  'account-update',
  'security-alert',
  'verify-account',
  'suspended-account',
  'confirm-identity',
  'unusual-activity',
];

const SUSPICIOUS_TLDs = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click'];

const BLOCKED_DOMAINS_DEFAULT = [
  'bit.ly', // URL shorteners (can hide malicious URLs)
  'tinyurl.com',
  'goo.gl',
  't.co',
  // Add more as needed
];

// ============================================================================
// Security Scanner Class
// ============================================================================

export class BrowserSecurityScanner {
  private config: SecurityConfig;

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = {
      enableUrlValidation: true,
      enablePIIDetection: true,
      enableThreatScanning: true,
      blockedDomains: [...BLOCKED_DOMAINS_DEFAULT],
      allowedDomains: [],
      maxRedirects: 5,
      requireHttps: true,
      piiMaskingEnabled: true,
      ...config,
    };
  }

  /**
   * Full security scan of a URL before navigation
   */
  async scanUrl(url: string): Promise<ThreatScanResult> {
    const startTime = Date.now();
    const threats: Threat[] = [];
    const pii: PIIMatch[] = [];

    // Validate URL format
    if (this.config.enableUrlValidation) {
      const urlThreats = this.validateUrl(url);
      threats.push(...urlThreats);
    }

    // Check for blocked domains
    if (this.isBlockedDomain(url)) {
      threats.push({
        type: 'blocked-domain',
        severity: 'high',
        description: 'This domain is on the blocked list',
        location: url,
        mitigation: 'Use the original URL instead of a shortener',
      });
    }

    // Check for phishing indicators
    if (this.config.enableThreatScanning) {
      const phishingThreats = this.detectPhishing(url);
      threats.push(...phishingThreats);
    }

    // Calculate safety score
    const score = this.calculateSafetyScore(threats);

    return {
      safe: score >= 0.7 && !threats.some((t) => t.severity === 'critical'),
      threats,
      pii,
      score,
      scanDuration: Date.now() - startTime,
    };
  }

  /**
   * Scan content for PII before filling forms
   */
  scanContent(content: string, context: string = 'unknown'): ThreatScanResult {
    const startTime = Date.now();
    const threats: Threat[] = [];
    const pii: PIIMatch[] = [];

    if (!this.config.enablePIIDetection) {
      return { safe: true, threats, pii, score: 1, scanDuration: Date.now() - startTime };
    }

    // Detect PII in content
    for (const [type, pattern] of Object.entries(PII_PATTERNS) as [PIIType, RegExp][]) {
      const matches = content.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const value = match[0];
        pii.push({
          type,
          value,
          masked: this.maskPII(value, type),
          location: context,
          confidence: this.calculatePIIConfidence(value, type),
        });
      }
    }

    // Add threat if sensitive PII found
    const sensitivePII = pii.filter((p) => ['ssn', 'credit-card', 'api-key', 'password'].includes(p.type));
    if (sensitivePII.length > 0) {
      threats.push({
        type: 'data-exfiltration',
        severity: 'high',
        description: `Sensitive data detected: ${sensitivePII.map((p) => p.type).join(', ')}`,
        location: context,
        mitigation: 'Consider masking or removing sensitive data before processing',
      });
    }

    const score = this.calculateSafetyScore(threats);

    return {
      safe: score >= 0.7,
      threats,
      pii,
      score,
      scanDuration: Date.now() - startTime,
    };
  }

  /**
   * Validate input before filling a form field
   */
  validateInput(value: string, fieldType: string): ThreatScanResult {
    const threats: Threat[] = [];
    const pii: PIIMatch[] = [];

    // Check for injection patterns
    if (this.containsInjection(value)) {
      threats.push({
        type: 'injection',
        severity: 'critical',
        description: 'Potential injection attack detected in input',
        location: fieldType,
        mitigation: 'Sanitize input before submission',
      });
    }

    // Check for XSS
    if (this.containsXSS(value)) {
      threats.push({
        type: 'xss',
        severity: 'critical',
        description: 'Potential XSS attack detected in input',
        location: fieldType,
        mitigation: 'Escape HTML entities before submission',
      });
    }

    // Detect PII in input
    const contentScan = this.scanContent(value, fieldType);
    pii.push(...contentScan.pii);

    const score = this.calculateSafetyScore(threats);

    return {
      safe: score >= 0.7,
      threats,
      pii,
      score,
      scanDuration: 0,
    };
  }

  /**
   * Sanitize input by removing detected threats
   */
  sanitizeInput(value: string): string {
    let sanitized = value;

    // Escape HTML entities
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');

    // Remove script tags
    sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    // Remove event handlers
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');

    return sanitized;
  }

  /**
   * Mask PII for safe logging/display
   */
  maskPII(value: string, type: PIIType): string {
    if (!this.config.piiMaskingEnabled) return value;

    switch (type) {
      case 'email': {
        const [local, domain] = value.split('@');
        return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 5))}@${domain}`;
      }
      case 'phone':
        return value.replace(/\d(?=\d{4})/g, '*');
      case 'ssn':
        return '***-**-' + value.slice(-4);
      case 'credit-card':
        return '**** **** **** ' + value.replace(/\D/g, '').slice(-4);
      case 'api-key':
        return value.slice(0, 8) + '*'.repeat(Math.min(value.length - 8, 20));
      case 'password':
        return '********';
      default:
        return '*'.repeat(value.length);
    }
  }

  // Private helpers

  private validateUrl(url: string): Threat[] {
    const threats: Threat[] = [];

    try {
      const parsed = new URL(url);

      // Check HTTPS requirement
      if (this.config.requireHttps && parsed.protocol !== 'https:') {
        threats.push({
          type: 'insecure-protocol',
          severity: 'medium',
          description: 'URL uses insecure HTTP protocol',
          location: url,
          mitigation: 'Use HTTPS for secure communication',
        });
      }

      // Check for suspicious TLDs
      if (SUSPICIOUS_TLDs.some((tld) => parsed.hostname.endsWith(tld))) {
        threats.push({
          type: 'phishing',
          severity: 'medium',
          description: 'URL uses a suspicious top-level domain',
          location: parsed.hostname,
          mitigation: 'Verify the legitimacy of this domain',
        });
      }

      // Check for IP address in URL (often suspicious)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)) {
        threats.push({
          type: 'suspicious-redirect',
          severity: 'medium',
          description: 'URL points to an IP address instead of a domain',
          location: parsed.hostname,
          mitigation: 'Legitimate sites typically use domain names',
        });
      }
    } catch {
      threats.push({
        type: 'malware',
        severity: 'high',
        description: 'Invalid URL format',
        location: url,
      });
    }

    return threats;
  }

  private isBlockedDomain(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Check allowed domains first
      if (
        this.config.allowedDomains.length > 0 &&
        this.config.allowedDomains.some((d) => hostname.includes(d.toLowerCase()))
      ) {
        return false;
      }

      // Check blocked domains
      return this.config.blockedDomains.some((d) => hostname.includes(d.toLowerCase()));
    } catch {
      return false;
    }
  }

  private detectPhishing(url: string): Threat[] {
    const threats: Threat[] = [];
    const urlLower = url.toLowerCase();

    // Check for phishing indicators in URL
    for (const indicator of PHISHING_INDICATORS) {
      if (urlLower.includes(indicator)) {
        threats.push({
          type: 'phishing',
          severity: 'high',
          description: `URL contains phishing indicator: ${indicator}`,
          location: url,
          mitigation: 'Verify this is a legitimate request from the service',
        });
        break;
      }
    }

    // Check for lookalike domains (typosquatting)
    const commonDomains = ['google', 'facebook', 'amazon', 'microsoft', 'apple', 'paypal', 'bank'];
    for (const domain of commonDomains) {
      const pattern = new RegExp(`${domain.split('').join('[^a-z]?')}`, 'i');
      if (pattern.test(urlLower) && !urlLower.includes(`.${domain}.`)) {
        const parsed = new URL(url);
        if (!parsed.hostname.includes(domain)) {
          threats.push({
            type: 'phishing',
            severity: 'high',
            description: `URL may be impersonating ${domain}`,
            location: url,
            mitigation: 'Verify you are on the official domain',
          });
        }
      }
    }

    return threats;
  }

  private containsInjection(value: string): boolean {
    const injectionPatterns = [
      /['";]/,
      /--/,
      /\/\*/,
      /\bOR\b.*\b=\b/i,
      /\bAND\b.*\b=\b/i,
      /\bUNION\b.*\bSELECT\b/i,
      /\bDROP\b.*\bTABLE\b/i,
      /\bINSERT\b.*\bINTO\b/i,
    ];

    return injectionPatterns.some((pattern) => pattern.test(value));
  }

  private containsXSS(value: string): boolean {
    const xssPatterns = [
      /<script[^>]*>/i,
      /javascript:/i,
      /\bon\w+\s*=/i,
      /<img[^>]+onerror/i,
      /<svg[^>]+onload/i,
      /data:text\/html/i,
    ];

    return xssPatterns.some((pattern) => pattern.test(value));
  }

  private calculateSafetyScore(threats: Threat[]): number {
    if (threats.length === 0) return 1;

    const severityWeights = { low: 0.1, medium: 0.25, high: 0.4, critical: 0.6 };
    let penalty = 0;

    for (const threat of threats) {
      penalty += severityWeights[threat.severity];
    }

    return Math.max(0, 1 - penalty);
  }

  private calculatePIIConfidence(value: string, type: PIIType): number {
    // Basic confidence calculation based on pattern match quality
    switch (type) {
      case 'email':
        return value.includes('.') && value.includes('@') ? 0.95 : 0.7;
      case 'ssn':
        return /^\d{3}-\d{2}-\d{4}$/.test(value) ? 0.95 : 0.8;
      case 'credit-card':
        return value.replace(/\D/g, '').length === 16 ? 0.9 : 0.7;
      case 'api-key':
        return value.length > 30 ? 0.85 : 0.6;
      default:
        return 0.7;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let defaultScanner: BrowserSecurityScanner | null = null;

export function getSecurityScanner(config?: Partial<SecurityConfig>): BrowserSecurityScanner {
  if (!defaultScanner || config) {
    defaultScanner = new BrowserSecurityScanner(config);
  }
  return defaultScanner;
}

/**
 * Quick check if a URL is safe to navigate
 */
export async function isUrlSafe(url: string): Promise<boolean> {
  const scanner = getSecurityScanner();
  const result = await scanner.scanUrl(url);
  return result.safe;
}

/**
 * Quick check if content contains PII
 */
export function containsPII(content: string): boolean {
  const scanner = getSecurityScanner();
  const result = scanner.scanContent(content);
  return result.pii.length > 0;
}
