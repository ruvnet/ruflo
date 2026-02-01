//! Policy evaluation module

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::{PolicyDecision, PolicyEvaluation, ToolCategory, T3Tensor, TrustLevel};
use gastown_shared::FxHashMap;

/// Policy configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyConfig {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub enforce: bool,
    pub default_policy: PolicyDecision,
    pub rules: Vec<PolicyRule>,
}

/// Individual policy rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub id: String,
    pub name: String,
    pub priority: u32,
    #[serde(rename = "match")]
    pub match_spec: PolicyMatch,
    pub decision: PolicyDecision,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Rule matching specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyMatch {
    #[serde(default)]
    pub tools: Option<Vec<String>>,
    #[serde(default)]
    pub categories: Option<Vec<ToolCategory>>,
    #[serde(default)]
    pub target_patterns: Option<Vec<String>>,
    #[serde(default)]
    pub target_patterns_are_regex: bool,
    #[serde(default)]
    pub rate_limit: Option<RateLimitSpec>,
    #[serde(default)]
    pub min_trust: Option<f64>,
}

/// Rate limit specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitSpec {
    pub max_count: u32,
    pub window_ms: u64,
}

/// Entity trust state for evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTrust {
    pub entity_id: String,
    pub t3: T3Tensor,
    #[serde(default)]
    pub interaction_count: u64,
}

/// Rate limiter state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimiterState {
    pub windows: FxHashMap<String, Vec<u64>>,
}

/// Rate limit check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub current_count: u32,
    pub max_count: u32,
    pub reset_in_ms: u64,
}

/// Evaluate policy against a tool call
#[inline]
pub fn evaluate_policy_impl(
    policy_json: &str,
    tool_name: &str,
    target: Option<&str>,
    entity_trust_json: &str,
) -> Result<String, JsValue> {
    let policy: PolicyConfig = serde_json::from_str(policy_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid policy JSON: {}", e)))?;

    let entity: EntityTrust = serde_json::from_str(entity_trust_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid entity trust JSON: {}", e)))?;

    let category = ToolCategory::from_tool_name(tool_name);
    let trust_score = entity.t3.composite();

    // Sort rules by priority (lower = evaluated first)
    let mut rules = policy.rules.clone();
    rules.sort_by_key(|r| r.priority);

    for rule in &rules {
        if matches_rule(tool_name, category, target, &rule.match_spec, trust_score) {
            let enforced = rule.decision != PolicyDecision::Deny || policy.enforce;
            let result = PolicyEvaluation {
                decision: rule.decision,
                matched_rule: Some(rule.id.clone()),
                enforced,
                reason: rule.reason.clone().unwrap_or_else(|| format!("Matched rule: {}", rule.name)),
                trust_score,
                constraints: vec![
                    format!("policy:{}", policy.name),
                    format!("rule:{}", rule.id),
                    format!("decision:{:?}", rule.decision),
                ],
            };
            return serde_json::to_string(&result)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }
    }

    // No rule matched - use default policy
    let result = PolicyEvaluation {
        decision: policy.default_policy,
        matched_rule: None,
        enforced: true,
        reason: format!("Default policy: {:?}", policy.default_policy),
        trust_score,
        constraints: vec![
            format!("policy:{}", policy.name),
            "rule:default".to_string(),
            format!("decision:{:?}", policy.default_policy),
        ],
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Check if a tool call matches a rule
#[inline]
fn matches_rule(
    tool_name: &str,
    category: ToolCategory,
    target: Option<&str>,
    match_spec: &PolicyMatch,
    trust_score: f64,
) -> bool {
    // Check minimum trust requirement
    if let Some(min_trust) = match_spec.min_trust {
        if trust_score < min_trust {
            return false;
        }
    }

    // Check tool name match
    if let Some(tools) = &match_spec.tools {
        if !tools.iter().any(|t| t == tool_name) {
            return false;
        }
    }

    // Check category match
    if let Some(categories) = &match_spec.categories {
        if !categories.contains(&category) {
            return false;
        }
    }

    // Check target pattern match
    if let Some(patterns) = &match_spec.target_patterns {
        let Some(target) = target else {
            return false;
        };

        let matched = patterns.iter().any(|pattern| {
            if match_spec.target_patterns_are_regex {
                // Simple regex matching (avoid full regex crate for WASM size)
                target.contains(pattern)
            } else {
                // Glob matching
                glob_match(pattern, target)
            }
        });

        if !matched {
            return false;
        }
    }

    true
}

/// Simple glob pattern matching
#[inline]
fn glob_match(pattern: &str, target: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern == "**" {
        return true;
    }
    if pattern.starts_with("**/") {
        let suffix = &pattern[3..];
        return target.ends_with(suffix) || target.contains(&format!("/{}", suffix));
    }
    if pattern.ends_with("/**") {
        let prefix = &pattern[..pattern.len() - 3];
        return target.starts_with(prefix);
    }
    if pattern.contains('*') {
        let parts: Vec<&str> = pattern.split('*').collect();
        if parts.len() == 2 {
            return target.starts_with(parts[0]) && target.ends_with(parts[1]);
        }
    }
    pattern == target
}

/// Check rate limit
pub fn check_rate_limit_impl(
    state_json: &str,
    key: &str,
    max_count: u32,
    window_ms: u64,
) -> Result<String, JsValue> {
    let mut state: RateLimiterState = serde_json::from_str(state_json)
        .unwrap_or_else(|_| RateLimiterState {
            windows: FxHashMap::default(),
        });

    let now = js_sys::Date::now() as u64;
    let window_start = now.saturating_sub(window_ms);

    // Get or create window for this key
    let timestamps = state.windows.entry(key.to_string()).or_insert_with(Vec::new);

    // Remove expired entries
    timestamps.retain(|&ts| ts > window_start);

    let current_count = timestamps.len() as u32;
    let allowed = current_count < max_count;

    if allowed {
        timestamps.push(now);
    }

    let reset_in_ms = if let Some(&oldest) = timestamps.first() {
        (oldest + window_ms).saturating_sub(now)
    } else {
        0
    };

    let result = RateLimitResult {
        allowed,
        current_count,
        max_count,
        reset_in_ms,
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match("*.ts", "foo.ts"));
        assert!(glob_match("**/test.ts", "src/test.ts"));
        assert!(glob_match("src/**", "src/foo/bar.ts"));
        assert!(!glob_match("*.ts", "foo.js"));
    }

    #[test]
    fn test_matches_rule_basic() {
        let match_spec = PolicyMatch {
            tools: Some(vec!["Read".to_string()]),
            categories: None,
            target_patterns: None,
            target_patterns_are_regex: false,
            rate_limit: None,
            min_trust: None,
        };

        assert!(matches_rule("Read", ToolCategory::FileRead, None, &match_spec, 0.5));
        assert!(!matches_rule("Write", ToolCategory::FileWrite, None, &match_spec, 0.5));
    }

    #[test]
    fn test_matches_rule_min_trust() {
        let match_spec = PolicyMatch {
            tools: None,
            categories: None,
            target_patterns: None,
            target_patterns_are_regex: false,
            rate_limit: None,
            min_trust: Some(0.7),
        };

        assert!(matches_rule("Read", ToolCategory::FileRead, None, &match_spec, 0.8));
        assert!(!matches_rule("Read", ToolCategory::FileRead, None, &match_spec, 0.5));
    }
}
