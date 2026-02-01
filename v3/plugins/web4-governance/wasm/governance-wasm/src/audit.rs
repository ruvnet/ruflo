//! R6 Audit chain module

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use crate::{PolicyDecision, ToolCategory};

/// R6 action record (Rules/Role/Request/Reference/Resource/Result)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Action {
    /// Unique action ID
    pub action_id: String,
    /// Rules: Policy that governed this action
    pub rules: R6Rules,
    /// Role: Who performed the action
    pub role: R6Role,
    /// Request: What was requested
    pub request: R6Request,
    /// Reference: Hash link to previous action
    pub reference: R6Reference,
    /// Resource: What was affected
    pub resource: R6Resource,
    /// Result: Outcome of the action
    pub result: R6Result,
    /// Timestamp
    pub timestamp: String,
    /// Content hash for chain integrity
    pub content_hash: String,
}

/// R6 Rules component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Rules {
    pub policy_id: String,
    pub policy_hash: String,
    pub matched_rule: Option<String>,
    pub decision: PolicyDecision,
}

/// R6 Role component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Role {
    pub session_id: String,
    pub agent_id: Option<String>,
    pub trust_score: f64,
}

/// R6 Request component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Request {
    pub tool_name: String,
    pub category: ToolCategory,
    pub parameters_hash: String,
}

/// R6 Reference component (chain linkage)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Reference {
    pub previous_hash: Option<String>,
    pub sequence_number: u64,
}

/// R6 Resource component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Resource {
    pub target: Option<String>,
    pub target_type: String,
}

/// R6 Result component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6Result {
    pub success: bool,
    pub enforced: bool,
    pub blocked: bool,
    pub error: Option<String>,
}

/// Audit chain state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditChain {
    pub session_id: String,
    pub policy_id: String,
    pub entries: Vec<String>,  // Content hashes only for efficiency
    pub latest_hash: Option<String>,
    pub sequence_number: u64,
    pub created_at: String,
}

impl AuditChain {
    pub fn new(session_id: String, policy_id: String) -> Self {
        Self {
            session_id,
            policy_id,
            entries: Vec::new(),
            latest_hash: None,
            sequence_number: 0,
            created_at: js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default(),
        }
    }

    pub fn append(&mut self, action: &R6Action) -> String {
        let hash = action.content_hash.clone();
        self.entries.push(hash.clone());
        self.latest_hash = Some(hash.clone());
        self.sequence_number += 1;
        hash
    }
}

/// Create action content hash
fn compute_action_hash(action: &R6ActionInput) -> String {
    let content = serde_json::to_string(action).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    result.iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

/// Input for creating an R6 action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct R6ActionInput {
    pub policy_id: String,
    pub policy_hash: String,
    pub matched_rule: Option<String>,
    pub decision: PolicyDecision,
    pub session_id: String,
    pub agent_id: Option<String>,
    pub trust_score: f64,
    pub tool_name: String,
    pub parameters_hash: String,
    pub target: Option<String>,
    pub success: bool,
    pub enforced: bool,
    pub blocked: bool,
    pub error: Option<String>,
}

/// Append to audit chain
pub fn append_audit_impl(
    chain_json: &str,
    action_json: &str,
) -> Result<String, JsValue> {
    let mut chain: AuditChain = serde_json::from_str(chain_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid chain JSON: {}", e)))?;

    let input: R6ActionInput = serde_json::from_str(action_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid action JSON: {}", e)))?;

    let category = ToolCategory::from_tool_name(&input.tool_name);
    let content_hash = compute_action_hash(&input);
    let now = js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default();

    let action = R6Action {
        action_id: format!("r6:{}:{}", chain.session_id, chain.sequence_number + 1),
        rules: R6Rules {
            policy_id: input.policy_id,
            policy_hash: input.policy_hash,
            matched_rule: input.matched_rule,
            decision: input.decision,
        },
        role: R6Role {
            session_id: input.session_id,
            agent_id: input.agent_id,
            trust_score: input.trust_score,
        },
        request: R6Request {
            tool_name: input.tool_name,
            category,
            parameters_hash: input.parameters_hash,
        },
        reference: R6Reference {
            previous_hash: chain.latest_hash.clone(),
            sequence_number: chain.sequence_number + 1,
        },
        resource: R6Resource {
            target: input.target,
            target_type: format!("{:?}", category).to_lowercase(),
        },
        result: R6Result {
            success: input.success,
            enforced: input.enforced,
            blocked: input.blocked,
            error: input.error,
        },
        timestamp: now,
        content_hash: content_hash.clone(),
    };

    chain.append(&action);

    let response = serde_json::json!({
        "chain": chain,
        "action": action,
        "new_hash": content_hash,
    });

    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_chain_new() {
        let chain = AuditChain::new("session:a".to_string(), "policy:default".to_string());
        assert_eq!(chain.sequence_number, 0);
        assert!(chain.entries.is_empty());
    }

    #[test]
    fn test_r6_action_creation() {
        let action = R6Action {
            action_id: "r6:test:1".to_string(),
            rules: R6Rules {
                policy_id: "policy:test".to_string(),
                policy_hash: "abc123".to_string(),
                matched_rule: Some("rule:1".to_string()),
                decision: PolicyDecision::Allow,
            },
            role: R6Role {
                session_id: "session:a".to_string(),
                agent_id: None,
                trust_score: 0.8,
            },
            request: R6Request {
                tool_name: "Read".to_string(),
                category: ToolCategory::FileRead,
                parameters_hash: "def456".to_string(),
            },
            reference: R6Reference {
                previous_hash: None,
                sequence_number: 1,
            },
            resource: R6Resource {
                target: Some("/path/to/file".to_string()),
                target_type: "file_read".to_string(),
            },
            result: R6Result {
                success: true,
                enforced: true,
                blocked: false,
                error: None,
            },
            timestamp: "2026-01-31T00:00:00Z".to_string(),
            content_hash: "xyz789".to_string(),
        };

        assert_eq!(action.action_id, "r6:test:1");
        assert_eq!(action.rules.decision, PolicyDecision::Allow);
    }
}
