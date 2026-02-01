//! Witnessing chain module

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::TrustLevel;

/// Witness event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WitnessEvent {
    pub witness_id: String,
    pub witnessed_id: String,
    pub trust_score: f64,
    pub trust_level: TrustLevel,
    pub timestamp: String,
    pub depth: u32,
}

impl WitnessEvent {
    pub fn new(witness_id: String, witnessed_id: String, trust_score: f64) -> Self {
        Self {
            witness_id,
            witnessed_id,
            trust_score,
            trust_level: TrustLevel::from_score(trust_score),
            timestamp: js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default(),
            depth: 1,
        }
    }
}

/// Witnessing chain for an entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WitnessingChain {
    pub entity_id: String,
    pub t3_composite: f64,
    pub trust_level: TrustLevel,
    pub witnessed_by: Vec<WitnessNode>,
    pub has_witnessed: Vec<WitnessNode>,
}

/// Node in witnessing chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WitnessNode {
    pub entity_id: String,
    pub t3_composite: f64,
    pub trust_level: TrustLevel,
    pub depth: u32,
}

impl WitnessNode {
    pub fn new(entity_id: String, t3_composite: f64, depth: u32) -> Self {
        Self {
            entity_id,
            t3_composite,
            trust_level: TrustLevel::from_score(t3_composite),
            depth,
        }
    }
}

impl WitnessingChain {
    pub fn new(entity_id: String, t3_composite: f64) -> Self {
        Self {
            entity_id,
            t3_composite,
            trust_level: TrustLevel::from_score(t3_composite),
            witnessed_by: Vec::new(),
            has_witnessed: Vec::new(),
        }
    }

    pub fn add_witness(&mut self, node: WitnessNode) {
        self.witnessed_by.push(node);
    }

    pub fn add_witnessed(&mut self, node: WitnessNode) {
        self.has_witnessed.push(node);
    }

    /// Calculate aggregate trust from witnesses
    pub fn aggregate_witness_trust(&self) -> f64 {
        if self.witnessed_by.is_empty() {
            return 0.0;
        }
        let total: f64 = self.witnessed_by.iter().map(|w| w.t3_composite).sum();
        total / self.witnessed_by.len() as f64
    }

    /// Calculate transitive trust score
    /// Combines direct trust with witness attestations: direct * 0.7 + witness * 0.3
    pub fn transitive_trust(&self) -> f64 {
        let witness_trust = self.aggregate_witness_trust();
        self.t3_composite * 0.7 + witness_trust * 0.3
    }
}

/// Record a witness event
pub fn record_witness_impl(
    witness_id: &str,
    witnessed_id: &str,
    trust_score: f64,
) -> Result<String, JsValue> {
    let event = WitnessEvent::new(
        witness_id.to_string(),
        witnessed_id.to_string(),
        trust_score,
    );

    serde_json::to_string(&event)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_witness_event_new() {
        let event = WitnessEvent::new(
            "session:a".to_string(),
            "tool:read".to_string(),
            0.8,
        );
        assert_eq!(event.witness_id, "session:a");
        assert_eq!(event.witnessed_id, "tool:read");
        assert_eq!(event.trust_level, TrustLevel::MediumHigh);
    }

    #[test]
    fn test_witnessing_chain_aggregate() {
        let mut chain = WitnessingChain::new("tool:read".to_string(), 0.5);
        chain.add_witness(WitnessNode::new("session:a".to_string(), 0.8, 1));
        chain.add_witness(WitnessNode::new("session:b".to_string(), 0.6, 1));

        let aggregate = chain.aggregate_witness_trust();
        assert!((aggregate - 0.7).abs() < 0.001);
    }

    #[test]
    fn test_transitive_trust() {
        let mut chain = WitnessingChain::new("tool:read".to_string(), 0.5);
        chain.add_witness(WitnessNode::new("session:a".to_string(), 0.9, 1));
        chain.add_witness(WitnessNode::new("session:b".to_string(), 0.9, 1));

        let transitive = chain.transitive_trust();
        // 0.5 * 0.7 + 0.9 * 0.3 = 0.35 + 0.27 = 0.62
        assert!((transitive - 0.62).abs() < 0.01);
    }
}
