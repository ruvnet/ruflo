/**
 * @claude-flow/browser - Security Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BrowserSecurityScanner,
  getSecurityScanner,
  isUrlSafe,
  containsPII,
  type SecurityConfig,
} from '../src/infrastructure/security-integration.js';

describe('BrowserSecurityScanner', () => {
  let scanner: BrowserSecurityScanner;

  beforeEach(() => {
    scanner = new BrowserSecurityScanner();
  });

  describe('scanUrl', () => {
    it('should pass safe HTTPS URLs', async () => {
      const result = await scanner.scanUrl('https://example.com');
      expect(result.safe).toBe(true);
      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should warn about HTTP URLs when requireHttps is enabled', async () => {
      const strictScanner = new BrowserSecurityScanner({ requireHttps: true });
      const result = await strictScanner.scanUrl('http://example.com');
      expect(result.threats.some(t => t.type === 'insecure-protocol')).toBe(true);
    });

    it('should detect blocked domains', async () => {
      const result = await scanner.scanUrl('https://bit.ly/abcd123');
      expect(result.threats.some(t => t.type === 'blocked-domain')).toBe(true);
    });

    it('should detect suspicious TLDs', async () => {
      const result = await scanner.scanUrl('https://suspicious-site.xyz');
      expect(result.threats.some(t => t.type === 'phishing')).toBe(true);
    });

    it('should detect IP address URLs', async () => {
      const result = await scanner.scanUrl('https://192.168.1.1/login');
      expect(result.threats.some(t => t.type === 'suspicious-redirect')).toBe(true);
    });

    it('should detect phishing indicators in URL', async () => {
      const result = await scanner.scanUrl('https://secure-login-verify.example.com');
      expect(result.threats.some(t => t.type === 'phishing')).toBe(true);
    });

    it('should allow domains in allowedDomains list', async () => {
      const allowedScanner = new BrowserSecurityScanner({
        allowedDomains: ['bit.ly'],
      });
      const result = await allowedScanner.scanUrl('https://bit.ly/safe');
      expect(result.threats.some(t => t.type === 'blocked-domain')).toBe(false);
    });
  });

  describe('scanContent', () => {
    it('should detect email addresses', () => {
      const result = scanner.scanContent('Contact us at test@example.com for help');
      expect(result.pii.some(p => p.type === 'email')).toBe(true);
    });

    it('should detect phone numbers', () => {
      const result = scanner.scanContent('Call us at 555-123-4567');
      expect(result.pii.some(p => p.type === 'phone')).toBe(true);
    });

    it('should detect SSNs', () => {
      const result = scanner.scanContent('SSN: 123-45-6789');
      expect(result.pii.some(p => p.type === 'ssn')).toBe(true);
    });

    it('should detect credit card numbers', () => {
      const result = scanner.scanContent('Card: 4111-1111-1111-1111');
      expect(result.pii.some(p => p.type === 'credit-card')).toBe(true);
    });

    it('should detect API keys', () => {
      // API key pattern requires at least 20 characters after the prefix
      const result = scanner.scanContent('API Key: sk_test_1234567890abcdefghijklmnop');
      expect(result.pii.some(p => p.type === 'api-key')).toBe(true);
    });

    it('should add threat for sensitive PII', () => {
      const result = scanner.scanContent('SSN: 123-45-6789, Card: 4111-1111-1111-1111');
      expect(result.threats.some(t => t.type === 'data-exfiltration')).toBe(true);
    });

    it('should return safe for content without PII', () => {
      const result = scanner.scanContent('This is just regular text content');
      expect(result.pii.length).toBe(0);
      expect(result.safe).toBe(true);
    });
  });

  describe('validateInput', () => {
    it('should detect SQL injection patterns', () => {
      const result = scanner.validateInput("'; DROP TABLE users; --", 'username');
      expect(result.threats.some(t => t.type === 'injection')).toBe(true);
    });

    it('should detect XSS patterns', () => {
      const result = scanner.validateInput('<script>alert("xss")</script>', 'comment');
      expect(result.threats.some(t => t.type === 'xss')).toBe(true);
    });

    it('should detect event handler XSS', () => {
      const result = scanner.validateInput('<img src="x" onerror="alert(1)">', 'bio');
      expect(result.threats.some(t => t.type === 'xss')).toBe(true);
    });

    it('should pass safe input', () => {
      const result = scanner.validateInput('Hello, World!', 'message');
      expect(result.safe).toBe(true);
    });
  });

  describe('sanitizeInput', () => {
    it('should escape HTML entities', () => {
      const result = scanner.sanitizeInput('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    it('should remove script tags', () => {
      const result = scanner.sanitizeInput('Hello <script>evil()</script> World');
      expect(result).not.toContain('<script>');
    });

    it('should escape HTML entities', () => {
      const result = scanner.sanitizeInput('<div onclick="evil()">click me</div>');
      // The sanitizer escapes HTML entities (which also neutralizes event handlers)
      expect(result).toContain('&lt;div');
      expect(result).toContain('&gt;');
    });
  });

  describe('maskPII', () => {
    it('should mask email addresses', () => {
      const result = scanner.maskPII('test@example.com', 'email');
      expect(result).toMatch(/t\*+@example\.com/);
    });

    it('should mask phone numbers', () => {
      const result = scanner.maskPII('555-123-4567', 'phone');
      expect(result).toMatch(/\*+4567/);
    });

    it('should mask SSNs', () => {
      const result = scanner.maskPII('123-45-6789', 'ssn');
      expect(result).toBe('***-**-6789');
    });

    it('should mask credit card numbers', () => {
      const result = scanner.maskPII('4111111111111111', 'credit-card');
      expect(result).toMatch(/\*+ 1111$/);
    });

    it('should mask API keys', () => {
      const result = scanner.maskPII('sk_live_1234567890abcdefghij', 'api-key');
      expect(result).toMatch(/^sk_live_\*+/);
    });

    it('should completely mask passwords', () => {
      const result = scanner.maskPII('secretpassword', 'password');
      expect(result).toBe('********');
    });
  });
});

describe('factory functions', () => {
  it('getSecurityScanner should return scanner', () => {
    const scanner = getSecurityScanner();
    expect(scanner).toBeInstanceOf(BrowserSecurityScanner);
  });

  it('isUrlSafe should return boolean', async () => {
    const result = await isUrlSafe('https://example.com');
    expect(typeof result).toBe('boolean');
  });

  it('containsPII should detect PII', () => {
    expect(containsPII('My email is test@example.com')).toBe(true);
    expect(containsPII('Hello World')).toBe(false);
  });
});
