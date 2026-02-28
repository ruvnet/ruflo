//! Web4 Governance WASM Module
//!
//! Trust-based policy evaluation for claude-flow, powered by Web4 trust tensors.
//!
//! # Features
//!
//! - **T3 Trust Tensors**: Fractal 3-dimensional trust (Talent/Training/Temperament)
//! - **V3 Value Tensors**: Fractal 3-dimensional value (Valuation/Veracity/Validity)
//! - **Policy Entities**: Immutable, hash-tracked policies
//! - **Witnessing Chains**: Bidirectional trust attestation
//! - **Rate Limiting**: Sliding window rate control
//! - **Audit Chain**: R6-compatible action logging
//!
//! # Fractal Tensor Structure
//!
//! Tensors are FRACTAL - base 3 dimensions, each with implementation-specific subdimensions:
//!
//! ```text
//! T3 (base 3D)                    V3 (base 3D)
//! ├── Talent                      ├── Valuation
//! │   ├── competence              │   ├── reputation
//! │   └── alignment               │   └── contribution
//! ├── Training                    ├── Veracity
//! │   ├── lineage                 │   ├── stewardship
//! │   └── witnesses               │   └── energy
//! └── Temperament                 └── Validity
//!     ├── reliability                 ├── network
//!     └── consistency                 └── temporal
//! ```
//!
//! CRITICAL: Trust is NEVER absolute - exists only within role contexts.
//!
//! # Integration
//!
//! This module integrates with claude-flow's existing systems:
//! - **Claims System**: Extends authorization with trust scores
//! - **AIDefence**: Adds trust-weighted threat decisions
//! - **Official Hooks Bridge**: Policy enforcement at tool boundaries
//!
//! # Performance Targets
//!
//! | Operation | Target | Notes |
//! |-----------|--------|-------|
//! | Policy evaluate | <0.1ms | Hot path, inlined |
//! | Trust update | <0.05ms | Incremental calculation |
//! | Witness chain query | <0.5ms | Depth-limited traversal |
//! | Audit log append | <0.02ms | Lock-free append |

#![allow(dead_code)]

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use gastown_shared::FxHashMap;

mod policy;
mod trust;
mod witness;
mod audit;

pub use policy::*;
pub use trust::*;
pub use witness::*;
pub use audit::*;

// ============================================================================
// Core Types - Mirroring web4-trust-core
// ============================================================================

/// Trust level categories
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    Unknown,
    Low,
    MediumLow,
    Medium,
    MediumHigh,
    High,
}

impl TrustLevel {
    #[inline]
    pub fn from_score(score: f64) -> Self {
        match score {
            s if s < 0.2 => TrustLevel::Low,
            s if s < 0.4 => TrustLevel::MediumLow,
            s if s < 0.6 => TrustLevel::Medium,
            s if s < 0.8 => TrustLevel::MediumHigh,
            _ => TrustLevel::High,
        }
    }
}

/// T3 Trust Tensor - Talent/Training/Temperament
///
/// Per Web4 spec (t3-v3-tensors.md), T3 measures trustworthiness through
/// three FRACTAL capability dimensions, always qualified by role context.
///
/// ## Fractal Structure
///
/// Each base dimension can expand to subdimensions:
/// - Talent → (competence, alignment)
/// - Training → (lineage, witnesses)
/// - Temperament → (reliability, consistency)
///
/// This implementation uses the base 3D. Full implementation binds to RDF/LCT.
///
/// ## Composite Formula
///
/// `talent * 0.3 + training * 0.4 + temperament * 0.3`
///
/// "T3/V3 tensors are not absolute properties - they exist only within role contexts."
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct T3Tensor {
    /// Talent: Role-specific capability, natural aptitude, creativity within domain
    /// Subdimensions: competence (can do), alignment (values fit)
    pub talent: f64,
    /// Training: Role-specific expertise, learned skills, relevant experience
    /// Subdimensions: lineage (history), witnesses (validation)
    pub training: f64,
    /// Temperament: Role-contextual reliability, consistency, role-appropriate behavior
    /// Subdimensions: reliability (will do), consistency (quality over time)
    pub temperament: f64,
}

impl Default for T3Tensor {
    fn default() -> Self {
        Self {
            talent: 0.5,
            training: 0.5,
            temperament: 0.5,
        }
    }
}

impl T3Tensor {
    /// Calculate composite trust score (weighted average per spec)
    /// talent * 0.3 + training * 0.4 + temperament * 0.3
    #[inline]
    pub fn composite(&self) -> f64 {
        self.talent * 0.3 + self.training * 0.4 + self.temperament * 0.3
    }

    /// Get trust level from composite score
    #[inline]
    pub fn level(&self) -> TrustLevel {
        TrustLevel::from_score(self.composite())
    }

    /// Update from outcome per Web4 spec evolution mechanics
    ///
    /// | Outcome | Talent Impact | Training Impact | Temperament Impact |
    /// |---------|--------------|-----------------|-------------------|
    /// | Novel Success | +0.02 to +0.05 | +0.01 to +0.02 | +0.01 |
    /// | Standard Success | 0 | +0.005 to +0.01 | +0.005 |
    /// | Unexpected Failure | -0.02 | -0.01 | -0.02 |
    #[inline]
    pub fn update_from_outcome(&mut self, success: bool, is_novel: bool) {
        let clamp = |v: f64| v.clamp(0.0, 1.0);

        if success {
            if is_novel {
                self.talent = clamp(self.talent + 0.03);
                self.training = clamp(self.training + 0.015);
                self.temperament = clamp(self.temperament + 0.01);
            } else {
                self.training = clamp(self.training + 0.008);
                self.temperament = clamp(self.temperament + 0.005);
            }
        } else {
            self.talent = clamp(self.talent - 0.02);
            self.training = clamp(self.training - 0.01);
            self.temperament = clamp(self.temperament - 0.02);
        }
    }
}

/// Policy decision types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Allow,
    Deny,
    AskUser,
    LogOnly,
}

/// Tool categories for policy matching
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    FileRead,
    FileWrite,
    Execute,
    Network,
    Agent,
    Memory,
    System,
}

impl ToolCategory {
    pub fn from_tool_name(name: &str) -> Self {
        match name {
            "Read" | "Glob" | "Grep" => ToolCategory::FileRead,
            "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => ToolCategory::FileWrite,
            "Bash" => ToolCategory::Execute,
            "WebFetch" | "WebSearch" => ToolCategory::Network,
            "Task" => ToolCategory::Agent,
            _ => ToolCategory::System,
        }
    }
}

/// Policy evaluation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvaluation {
    pub decision: PolicyDecision,
    pub matched_rule: Option<String>,
    pub enforced: bool,
    pub reason: String,
    pub trust_score: f64,
    pub constraints: Vec<String>,
}

// ============================================================================
// WASM Exports
// ============================================================================

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Evaluate a tool call against a policy
///
/// # Arguments
/// * `policy_json` - Policy configuration as JSON
/// * `tool_name` - Name of the tool being called
/// * `target` - Optional target (file path, URL, etc.)
/// * `entity_trust_json` - Entity trust state as JSON
///
/// # Returns
/// * Policy evaluation result as JSON
#[wasm_bindgen]
pub fn evaluate_policy(
    policy_json: &str,
    tool_name: &str,
    target: Option<String>,
    entity_trust_json: &str,
) -> Result<String, JsValue> {
    policy::evaluate_policy_impl(policy_json, tool_name, target.as_deref(), entity_trust_json)
}

/// Update entity trust from tool call outcome
///
/// # Arguments
/// * `entity_json` - Current entity trust state as JSON
/// * `tool_name` - Name of the tool that was called
/// * `success` - Whether the call succeeded
/// * `weight` - Update weight (typically 0.05-0.15)
///
/// # Returns
/// * Updated entity trust as JSON
#[wasm_bindgen]
pub fn update_trust(
    entity_json: &str,
    tool_name: &str,
    success: bool,
    weight: f64,
) -> Result<String, JsValue> {
    trust::update_trust_impl(entity_json, tool_name, success, weight)
}

/// Record a witnessing relationship
///
/// # Arguments
/// * `witness_id` - Entity doing the witnessing
/// * `witnessed_id` - Entity being witnessed
/// * `trust_score` - Trust score of the witness
///
/// # Returns
/// * Witness event as JSON
#[wasm_bindgen]
pub fn record_witness(
    witness_id: &str,
    witnessed_id: &str,
    trust_score: f64,
) -> Result<String, JsValue> {
    witness::record_witness_impl(witness_id, witnessed_id, trust_score)
}

/// Append to audit chain
///
/// # Arguments
/// * `chain_json` - Current chain state as JSON
/// * `action_json` - Action to append as JSON
///
/// # Returns
/// * Updated chain as JSON with new entry hash
#[wasm_bindgen]
pub fn append_audit(
    chain_json: &str,
    action_json: &str,
) -> Result<String, JsValue> {
    audit::append_audit_impl(chain_json, action_json)
}

/// Check rate limit
///
/// # Arguments
/// * `state_json` - Rate limiter state as JSON
/// * `key` - Rate limit key (tool:category or rule:id)
/// * `max_count` - Maximum allowed in window
/// * `window_ms` - Window size in milliseconds
///
/// # Returns
/// * Rate limit check result as JSON
#[wasm_bindgen]
pub fn check_rate_limit(
    state_json: &str,
    key: &str,
    max_count: u32,
    window_ms: u64,
) -> Result<String, JsValue> {
    policy::check_rate_limit_impl(state_json, key, max_count, window_ms)
}

/// Compute policy content hash
///
/// # Arguments
/// * `policy_json` - Policy configuration as JSON
///
/// # Returns
/// * SHA-256 hash (first 16 chars)
#[wasm_bindgen]
pub fn compute_policy_hash(policy_json: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(policy_json.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

/// Get module metrics
#[wasm_bindgen]
pub fn get_metrics() -> JsValue {
    let metrics = serde_json::json!({
        "version": "0.1.0",
        "integration": "web4-trust-core",
        "targets": {
            "evaluate_policy_ms": 0.1,
            "update_trust_ms": 0.05,
            "witness_chain_ms": 0.5,
            "audit_append_ms": 0.02
        },
        "capabilities": [
            "t3_trust_tensors",
            "policy_entities",
            "witnessing_chains",
            "rate_limiting",
            "r6_audit_chain"
        ],
        "compatibility": {
            "claims_system": true,
            "aidefence": true,
            "official_hooks": true
        }
    });

    serde_wasm_bindgen::to_value(&metrics).unwrap_or(JsValue::NULL)
}

// Hex encoding helper
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_level_from_score() {
        assert_eq!(TrustLevel::from_score(0.1), TrustLevel::Low);
        assert_eq!(TrustLevel::from_score(0.5), TrustLevel::Medium);
        assert_eq!(TrustLevel::from_score(0.9), TrustLevel::High);
    }

    #[test]
    fn test_t3_tensor_composite() {
        let tensor = T3Tensor::default();
        // 0.5 * 0.3 + 0.5 * 0.4 + 0.5 * 0.3 = 0.5
        assert!((tensor.composite() - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_t3_update_from_outcome() {
        let mut tensor = T3Tensor::default();
        tensor.update_from_outcome(true, false); // standard success
        assert!(tensor.composite() > 0.5);

        tensor.update_from_outcome(false, false); // failure
        // Should decrease from the gains
    }

    #[test]
    fn test_tool_category_from_name() {
        assert_eq!(ToolCategory::from_tool_name("Read"), ToolCategory::FileRead);
        assert_eq!(ToolCategory::from_tool_name("Bash"), ToolCategory::Execute);
        assert_eq!(ToolCategory::from_tool_name("Task"), ToolCategory::Agent);
    }
}
