//! Trust management module

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::{T3Tensor, TrustLevel, ToolCategory};

/// Entity trust record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTrustRecord {
    pub entity_id: String,
    pub entity_type: EntityType,
    pub t3: T3Tensor,
    pub level: TrustLevel,
    pub interaction_count: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub last_updated: String,
    pub created_at: String,
}

/// Entity types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Tool,
    Session,
    Agent,
    Policy,
    User,
}

impl EntityTrustRecord {
    pub fn new(entity_id: String, entity_type: EntityType) -> Self {
        let now = js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default();
        Self {
            entity_id,
            entity_type,
            t3: T3Tensor::default(),
            level: TrustLevel::Medium,
            interaction_count: 0,
            success_count: 0,
            failure_count: 0,
            last_updated: now.clone(),
            created_at: now,
        }
    }

    /// Update trust from an outcome
    #[inline]
    pub fn update_from_outcome(&mut self, success: bool, is_novel: bool) {
        self.interaction_count += 1;
        if success {
            self.success_count += 1;
        } else {
            self.failure_count += 1;
        }
        self.t3.update_from_outcome(success, is_novel);
        self.level = self.t3.level();
        self.last_updated = js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default();
    }
}

/// Trust update result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustUpdateResult {
    pub entity: EntityTrustRecord,
    pub delta: TrustDelta,
}

/// Trust change details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustDelta {
    pub previous_composite: f64,
    pub new_composite: f64,
    pub previous_level: TrustLevel,
    pub new_level: TrustLevel,
    pub changed: bool,
}

/// Update entity trust from tool call outcome
pub fn update_trust_impl(
    entity_json: &str,
    tool_name: &str,
    success: bool,
    _weight: f64,  // Ignored - using spec-defined deltas
) -> Result<String, JsValue> {
    let mut entity: EntityTrustRecord = serde_json::from_str(entity_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid entity JSON: {}", e)))?;

    let previous_composite = entity.t3.composite();
    let previous_level = entity.level;

    // Determine if this is a novel action based on category
    let category = ToolCategory::from_tool_name(tool_name);
    let is_novel = is_novel_category(category);

    entity.update_from_outcome(success, is_novel);

    let new_composite = entity.t3.composite();
    let new_level = entity.level;

    let result = TrustUpdateResult {
        entity,
        delta: TrustDelta {
            previous_composite,
            new_composite,
            previous_level,
            new_level,
            changed: previous_level != new_level,
        },
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Determine if a category represents novel/creative work
#[inline]
fn is_novel_category(category: ToolCategory) -> bool {
    matches!(category, ToolCategory::Agent | ToolCategory::Network)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_trust_record_new() {
        let entity = EntityTrustRecord::new("mcp:test".to_string(), EntityType::Tool);
        assert_eq!(entity.entity_id, "mcp:test");
        assert_eq!(entity.interaction_count, 0);
        assert_eq!(entity.level, TrustLevel::Medium);
    }

    #[test]
    fn test_update_from_outcome() {
        let mut entity = EntityTrustRecord::new("mcp:test".to_string(), EntityType::Tool);
        entity.update_from_outcome(true, false); // standard success
        assert_eq!(entity.interaction_count, 1);
        assert_eq!(entity.success_count, 1);
        assert!(entity.t3.composite() > 0.5);
    }

    #[test]
    fn test_is_novel_category() {
        assert!(is_novel_category(ToolCategory::Agent));
        assert!(is_novel_category(ToolCategory::Network));
        assert!(!is_novel_category(ToolCategory::FileRead));
    }
}
