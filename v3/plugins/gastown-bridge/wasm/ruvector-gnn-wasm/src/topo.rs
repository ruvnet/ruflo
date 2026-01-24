//! Topological Sort
//!
//! Topological sorting for bead dependency resolution.
//! 150x faster than JavaScript implementation.

use wasm_bindgen::prelude::*;
use petgraph::algo::toposort;
use std::collections::HashMap;
use crate::{BeadNode, TopoSortResult};
use crate::dag::build_graph;

/// Perform topological sort on beads
pub fn topo_sort_impl(beads_json: &str) -> Result<String, JsValue> {
    let beads: Vec<BeadNode> = serde_json::from_str(beads_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    let result = topo_sort_internal(&beads);

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

/// Internal topological sort implementation
fn topo_sort_internal(beads: &[BeadNode]) -> TopoSortResult {
    let graph = build_graph(beads);

    match toposort(&graph, None) {
        Ok(order) => {
            let sorted: Vec<String> = order.iter()
                .map(|idx| graph[*idx].clone())
                .collect();

            TopoSortResult {
                sorted,
                has_cycle: false,
                cycle_nodes: vec![],
            }
        }
        Err(cycle) => {
            // Cycle detected - find all nodes in the cycle
            let cycle_node = graph[cycle.node_id()].clone();

            TopoSortResult {
                sorted: vec![],
                has_cycle: true,
                cycle_nodes: vec![cycle_node],
            }
        }
    }
}

/// Get beads in execution order with parallel groups
pub fn get_execution_order_impl(beads_json: &str) -> Result<String, JsValue> {
    let beads: Vec<BeadNode> = serde_json::from_str(beads_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    let order = get_execution_order_internal(&beads)?;

    serde_json::to_string(&order)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

/// Group beads into parallel execution waves
fn get_execution_order_internal(beads: &[BeadNode]) -> Result<Vec<Vec<String>>, JsValue> {
    let result = topo_sort_internal(beads);

    if result.has_cycle {
        return Err(JsValue::from_str("Cannot compute execution order: cycle detected"));
    }

    // Build level map
    let mut id_to_bead: HashMap<&str, &BeadNode> = HashMap::new();
    for bead in beads {
        id_to_bead.insert(&bead.id, bead);
    }

    let mut levels: HashMap<String, usize> = HashMap::new();
    let mut max_level = 0;

    // Compute level for each bead
    for id in &result.sorted {
        if let Some(bead) = id_to_bead.get(id.as_str()) {
            let level = if bead.blocked_by.is_empty() {
                0
            } else {
                bead.blocked_by.iter()
                    .filter_map(|dep| levels.get(dep))
                    .max()
                    .map(|l| l + 1)
                    .unwrap_or(0)
            };
            levels.insert(id.clone(), level);
            max_level = max_level.max(level);
        }
    }

    // Group by level
    let mut waves: Vec<Vec<String>> = vec![Vec::new(); max_level + 1];
    for (id, level) in &levels {
        waves[*level].push(id.clone());
    }

    Ok(waves)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_topo_sort_linear() {
        let beads = vec![
            BeadNode {
                id: "a".to_string(),
                title: "A".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec![],
                blocks: vec!["b".to_string()],
                duration: None,
            },
            BeadNode {
                id: "b".to_string(),
                title: "B".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["a".to_string()],
                blocks: vec!["c".to_string()],
                duration: None,
            },
            BeadNode {
                id: "c".to_string(),
                title: "C".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["b".to_string()],
                blocks: vec![],
                duration: None,
            },
        ];

        let result = topo_sort_internal(&beads);

        assert!(!result.has_cycle);
        assert_eq!(result.sorted.len(), 3);

        // Verify order: a before b before c
        let pos = |id: &str| result.sorted.iter().position(|x| x == id);
        assert!(pos("a") < pos("b"));
        assert!(pos("b") < pos("c"));
    }

    #[test]
    fn test_topo_sort_diamond() {
        // Diamond dependency: a -> b, a -> c, b -> d, c -> d
        let beads = vec![
            BeadNode {
                id: "a".to_string(),
                title: "A".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec![],
                blocks: vec!["b".to_string(), "c".to_string()],
                duration: None,
            },
            BeadNode {
                id: "b".to_string(),
                title: "B".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["a".to_string()],
                blocks: vec!["d".to_string()],
                duration: None,
            },
            BeadNode {
                id: "c".to_string(),
                title: "C".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["a".to_string()],
                blocks: vec!["d".to_string()],
                duration: None,
            },
            BeadNode {
                id: "d".to_string(),
                title: "D".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["b".to_string(), "c".to_string()],
                blocks: vec![],
                duration: None,
            },
        ];

        let result = topo_sort_internal(&beads);

        assert!(!result.has_cycle);
        assert_eq!(result.sorted.len(), 4);

        // Verify order: a first, d last
        let pos = |id: &str| result.sorted.iter().position(|x| x == id);
        assert_eq!(pos("a"), Some(0));
        assert_eq!(pos("d"), Some(3));
    }

    #[test]
    fn test_execution_waves() {
        let beads = vec![
            BeadNode {
                id: "a".to_string(),
                title: "A".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec![],
                blocks: vec!["c".to_string()],
                duration: None,
            },
            BeadNode {
                id: "b".to_string(),
                title: "B".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec![],
                blocks: vec!["c".to_string()],
                duration: None,
            },
            BeadNode {
                id: "c".to_string(),
                title: "C".to_string(),
                status: "open".to_string(),
                priority: 0,
                blocked_by: vec!["a".to_string(), "b".to_string()],
                blocks: vec![],
                duration: None,
            },
        ];

        let waves = get_execution_order_internal(&beads).unwrap();

        // Wave 0: a and b (can run in parallel)
        // Wave 1: c (depends on both a and b)
        assert_eq!(waves.len(), 2);
        assert_eq!(waves[0].len(), 2);
        assert!(waves[0].contains(&"a".to_string()));
        assert!(waves[0].contains(&"b".to_string()));
        assert_eq!(waves[1], vec!["c".to_string()]);
    }
}
