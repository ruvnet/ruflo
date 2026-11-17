//! Enforcement Gates — Secret scanning and destructive command detection
//!
//! Regex-based pattern matching for security-critical content scanning.
//! Runs entirely in WASM for consistent, predictable performance.

use regex::Regex;
use std::sync::OnceLock;

/// Pre-compiled secret detection patterns.
/// OnceLock ensures patterns are compiled exactly once.
static SECRET_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static DESTRUCTIVE_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

fn get_secret_patterns() -> &'static Vec<Regex> {
    SECRET_PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r#"(?i)(?:api[_\-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]"#).unwrap(),
            Regex::new(r#"(?i)(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]"#).unwrap(),
            Regex::new(r#"(?i)(?:token|bearer)\s*[:=]\s*['"][^'"]{10,}['"]"#).unwrap(),
            Regex::new(r"-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----").unwrap(),
            Regex::new(r"sk-[a-zA-Z0-9]{20,}").unwrap(),
            Regex::new(r"ghp_[a-zA-Z0-9]{36}").unwrap(),
            Regex::new(r"npm_[a-zA-Z0-9]{36}").unwrap(),
            Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
        ]
    })
}

fn get_destructive_patterns() -> &'static Vec<Regex> {
    DESTRUCTIVE_PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)\brm\s+-rf?\b").unwrap(),
            Regex::new(r"(?i)\bdrop\s+(database|table|schema|index)\b").unwrap(),
            Regex::new(r"(?i)\btruncate\s+table\b").unwrap(),
            Regex::new(r"(?i)\bgit\s+push\s+.*--force\b").unwrap(),
            Regex::new(r"(?i)\bgit\s+reset\s+--hard\b").unwrap(),
            Regex::new(r"(?i)\bgit\s+clean\s+-fd?\b").unwrap(),
            Regex::new(r"(?i)\bformat\s+[a-z]:").unwrap(),
            Regex::new(r"(?i)\bdel\s+/[sf]\b").unwrap(),
            Regex::new(r"(?i)\b(?:kubectl|helm)\s+delete\s+(?:--all|namespace)\b").unwrap(),
            Regex::new(r"(?i)\bDROP\s+(?:DATABASE|TABLE|SCHEMA)\b").unwrap(),
            Regex::new(r"(?i)\bDELETE\s+FROM\s+\w+\s*$").unwrap(),
            Regex::new(r"(?i)\bALTER\s+TABLE\s+\w+\s+DROP\b").unwrap(),
        ]
    })
}

/// Scan content for secret patterns. Returns a vec of redacted matches.
///
/// Each match is redacted: first 4 and last 4 chars visible, middle replaced
/// with asterisks. Matches of 12 chars or fewer are fully masked.
pub fn scan_secrets(content: &str) -> Vec<String> {
    let patterns = get_secret_patterns();
    let mut results = Vec::new();

    for pattern in patterns.iter() {
        for mat in pattern.find_iter(content) {
            // Count characters, not bytes: a byte index can land inside a
            // multi-byte character in the secret value and panic.
            let chars: Vec<char> = mat.as_str().chars().collect();
            let redacted = if chars.len() > 12 {
                let start: String = chars[..4].iter().collect();
                let end: String = chars[chars.len() - 4..].iter().collect();
                let stars = "*".repeat(chars.len() - 8);
                format!("{}{}{}", start, stars, end)
            } else {
                "*".repeat(chars.len())
            };
            results.push(redacted);
        }
    }

    results
}

/// Detect destructive command patterns. Returns the first match, or None.
pub fn detect_destructive(command: &str) -> Option<String> {
    let patterns = get_destructive_patterns();

    for pattern in patterns.iter() {
        if let Some(mat) = pattern.find(command) {
            return Some(mat.as_str().to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_secrets_non_ascii_value() {
        // The last 4 bytes of this match start inside an "é", so byte slicing
        // used to panic (a trap in WASM) instead of returning a result.
        let matches = scan_secrets(r#"password = "passéé""#);
        assert_eq!(matches, vec![format!("pass{}séé\"", "*".repeat(11))]);

        // Short non-ASCII matches are fully masked, one star per character.
        let matches = scan_secrets(r#"pwd="éééé""#);
        assert_eq!(matches, vec!["*".repeat(10)]);
    }

    #[test]
    fn test_scan_secrets_api_key() {
        let content = r#"api_key = "sk-abcdefghij1234567890""#;
        let matches = scan_secrets(content);
        assert!(!matches.is_empty());
        // Should be redacted
        assert!(matches[0].contains("****"));
    }

    #[test]
    fn test_scan_secrets_private_key() {
        let content = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...";
        let matches = scan_secrets(content);
        assert!(!matches.is_empty());
    }

    #[test]
    fn test_scan_secrets_clean() {
        let content = "This is a normal string with no secrets";
        let matches = scan_secrets(content);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_detect_destructive_rm_rf() {
        assert!(detect_destructive("rm -rf /").is_some());
    }

    #[test]
    fn test_detect_destructive_drop_table() {
        assert!(detect_destructive("DROP TABLE users").is_some());
    }

    #[test]
    fn test_detect_destructive_git_force_push() {
        assert!(detect_destructive("git push origin main --force").is_some());
    }

    #[test]
    fn test_detect_destructive_clean() {
        assert!(detect_destructive("git commit -m 'hello'").is_none());
    }
}
