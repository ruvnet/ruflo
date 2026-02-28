# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| v3.5.x  | :white_check_mark: |
| v3.0.x  | :white_check_mark: |
| v2.x    | :x:                |
| < v2.0  | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### 1. Do Not Disclose Publicly

Please **DO NOT** open a public issue or discuss the vulnerability in public forums until it has been addressed.

### 2. Report Privately

Send security reports to:
- Email: security@ruv.io
- Or DM @ruv on X/Twitter

Include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### 3. Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix Timeline**: Depends on severity
  - Critical: 7 days
  - High: 30 days
  - Medium: 90 days

### 4. Disclosure

Once fixed, we will:
1. Credit you in the release notes (unless you prefer anonymity)
2. Publish a security advisory
3. Notify users through appropriate channels

## Security Best Practices

### API Keys

- Never commit API keys to version control
- Use environment variables or secure key management
- Rotate keys regularly
- Use least-privilege access

### Supported Environment Variables

```bash
# Required for core functionality
ANTHROPIC_API_KEY=your_key_here

# Optional providers
MOONSHOT_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here

# Security settings
RUFLO_DISABLE_TELEMETRY=false
```

### Local Development

- Keep `.env` files out of git (already in .gitignore)
- Use `.env.example` as template
- Run `scripts/health-check.sh` to verify setup

## Security Features

Ruflo includes several security features:

- **API Key Validation**: All providers validate API keys before use
- **Rate Limiting**: Built-in protection against API abuse
- **Input Sanitization**: User inputs are validated and sanitized
- **Audit Logging**: Security events are logged (opt-in)
- **CORS Protection**: Configurable cross-origin restrictions

## Known Limitations

- No built-in encryption at rest for local data
- Relies on external provider security (Anthropic, OpenAI, etc.)
- Network security depends on user's environment

## Security Audits

Last audit: 2026-02-28 (Bronze Level)
- Score: 85/100
- Status: Pass
- Tool: AresSec Scanner

Key findings:
- No hardcoded credentials
- HTTPS used for all external APIs
- No dangerous eval() in production code
- Test files use dynamic mocking (expected)

## Acknowledgments

We thank the following contributors for responsible disclosure:

- [Your name here for future security reporters]

---

For questions about this security policy, please open a non-sensitive issue or contact the maintainers.
