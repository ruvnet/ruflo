#!/bin/bash
# Security Audit - Full Scan Script
# Run comprehensive security scan pipeline

set -e

echo "Running full security scan..."

# Input validation
echo "Checking input validation..."
npx @claude-flow/cli security scan --check input-validation

# Path traversal
echo "Checking path traversal..."
npx @claude-flow/cli security scan --check path-traversal

# SQL injection
echo "Checking SQL injection..."
npx @claude-flow/cli security scan --check sql-injection

# XSS
echo "Checking XSS..."
npx @claude-flow/cli security scan --check xss

# Secrets
echo "Checking for hardcoded secrets..."
npx @claude-flow/cli security validate --check secrets

# CVE scan
echo "Scanning dependencies for CVEs..."
npx @claude-flow/cli security cve --scan

echo "Security scan complete"
