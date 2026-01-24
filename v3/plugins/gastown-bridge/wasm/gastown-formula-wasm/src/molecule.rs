//! Molecule Generator
//!
//! Generates bead chains (molecules) from cooked formulas.
//! Creates the dependency structure for Gas Town execution.

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use crate::CookedFormula;

/// A molecule bead definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoleculeBead {
    /// Bead title (from step/leg)
    pub title: String,
    /// Bead description
    pub description: String,
    /// Labels for the bead
    pub labels: Vec<String>,
    /// Dependencies (bead indices that must complete first)
    pub depends_on: Vec<usize>,
    /// Estimated duration in minutes
    pub duration: Option<u32>,
    /// Required capabilities
    pub requires: Vec<String>,
}

/// A molecule definition (chain of beads)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Molecule {
    /// Formula name this molecule was generated from
    pub formula_name: String,
    /// Formula type
    pub formula_type: String,
    /// Ordered list of beads
    pub beads: Vec<MoleculeBead>,
    /// Whether the molecule has cycles (should be false)
    pub has_cycle: bool,
    /// Topological order of bead indices
    pub execution_order: Vec<usize>,
}

/// Generate a molecule from a cooked formula
pub fn generate_molecule_impl(formula_json: &str) -> Result<String, JsValue> {
    let cooked: CookedFormula = serde_json::from_str(formula_json)
        .map_err(|e| JsValue::from_str(&format!("Formula parse error: {}", e)))?;

    let molecule = generate_molecule_internal(&cooked)?;

    serde_json::to_string(&molecule)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

/// Internal molecule generation
fn generate_molecule_internal(cooked: &CookedFormula) -> Result<Molecule, JsValue> {
    let formula = &cooked.formula;
    let formula_type = match &formula.formula_type {
        crate::FormulaType::Convoy => "convoy",
        crate::FormulaType::Workflow => "workflow",
        crate::FormulaType::Expansion => "expansion",
        crate::FormulaType::Aspect => "aspect",
    };

    let mut beads = Vec::new();
    let mut id_to_index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    // Generate beads from steps (for workflow type)
    if !formula.steps.is_empty() {
        for (i, step) in formula.steps.iter().enumerate() {
            id_to_index.insert(step.id.clone(), i);
            beads.push(MoleculeBead {
                title: step.title.clone(),
                description: step.description.clone(),
                labels: vec!["molecule".to_string(), formula.name.clone()],
                depends_on: vec![], // Will be filled after all beads are created
                duration: step.duration,
                requires: step.requires.clone(),
            });
        }

        // Wire dependencies
        for (i, step) in formula.steps.iter().enumerate() {
            let deps: Vec<usize> = step.needs.iter()
                .filter_map(|need| id_to_index.get(need).copied())
                .collect();
            beads[i].depends_on = deps;
        }
    }

    // Generate beads from legs (for convoy type)
    if !formula.legs.is_empty() {
        for (i, leg) in formula.legs.iter().enumerate() {
            id_to_index.insert(leg.id.clone(), i);
            beads.push(MoleculeBead {
                title: leg.title.clone(),
                description: leg.description.clone(),
                labels: vec!["molecule".to_string(), "convoy".to_string(), formula.name.clone()],
                depends_on: if i > 0 { vec![i - 1] } else { vec![] }, // Sequential by default
                duration: None,
                requires: vec![],
            });
        }
    }

    // Compute execution order (topological sort)
    let (execution_order, has_cycle) = topological_sort(&beads);

    Ok(Molecule {
        formula_name: formula.name.clone(),
        formula_type: formula_type.to_string(),
        beads,
        has_cycle,
        execution_order,
    })
}

/// Topological sort using Kahn's algorithm
fn topological_sort(beads: &[MoleculeBead]) -> (Vec<usize>, bool) {
    let n = beads.len();
    if n == 0 {
        return (vec![], false);
    }

    // Count incoming edges for each node
    let mut in_degree: Vec<usize> = vec![0; n];
    for bead in beads {
        for &dep in &bead.depends_on {
            if dep < n {
                in_degree[dep] += 1;
            }
        }
    }

    // Find nodes with no incoming edges
    // Note: We need to reverse the dependency direction for topological sort
    // depends_on means "this bead depends on those", so the dependency points TO this bead
    let mut in_degree_correct: Vec<usize> = vec![0; n];
    for (i, bead) in beads.iter().enumerate() {
        in_degree_correct[i] = bead.depends_on.len();
    }

    let mut queue: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for i in 0..n {
        if in_degree_correct[i] == 0 {
            queue.push_back(i);
        }
    }

    let mut result = Vec::new();
    let mut processed = vec![false; n];

    while let Some(node) = queue.pop_front() {
        result.push(node);
        processed[node] = true;

        // Find nodes that depend on this one
        for (i, bead) in beads.iter().enumerate() {
            if !processed[i] && bead.depends_on.contains(&node) {
                in_degree_correct[i] -= 1;
                if in_degree_correct[i] == 0 {
                    queue.push_back(i);
                }
            }
        }
    }

    let has_cycle = result.len() != n;
    (result, has_cycle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Formula, FormulaType, Step};
    use std::collections::HashMap;

    fn create_test_formula() -> CookedFormula {
        CookedFormula {
            formula: Formula {
                name: "test-workflow".to_string(),
                description: "Test workflow".to_string(),
                formula_type: FormulaType::Workflow,
                version: 1,
                legs: vec![],
                synthesis: None,
                steps: vec![
                    Step {
                        id: "analyze".to_string(),
                        title: "Analyze".to_string(),
                        description: "Analyze the code".to_string(),
                        needs: vec![],
                        duration: Some(30),
                        requires: vec![],
                    },
                    Step {
                        id: "review".to_string(),
                        title: "Review".to_string(),
                        description: "Review changes".to_string(),
                        needs: vec!["analyze".to_string()],
                        duration: Some(60),
                        requires: vec![],
                    },
                    Step {
                        id: "approve".to_string(),
                        title: "Approve".to_string(),
                        description: "Approve changes".to_string(),
                        needs: vec!["review".to_string()],
                        duration: Some(15),
                        requires: vec![],
                    },
                ],
                vars: HashMap::new(),
            },
            cooked_at: "2026-01-24T00:00:00Z".to_string(),
            cooked_vars: HashMap::new(),
            original_name: "test-workflow".to_string(),
        }
    }

    #[test]
    fn test_generate_molecule() {
        let cooked = create_test_formula();
        let molecule = generate_molecule_internal(&cooked).unwrap();

        assert_eq!(molecule.formula_name, "test-workflow");
        assert_eq!(molecule.formula_type, "workflow");
        assert_eq!(molecule.beads.len(), 3);
        assert!(!molecule.has_cycle);
        assert_eq!(molecule.execution_order.len(), 3);
    }

    #[test]
    fn test_topological_sort() {
        let beads = vec![
            MoleculeBead {
                title: "A".to_string(),
                description: "".to_string(),
                labels: vec![],
                depends_on: vec![],
                duration: None,
                requires: vec![],
            },
            MoleculeBead {
                title: "B".to_string(),
                description: "".to_string(),
                labels: vec![],
                depends_on: vec![0],
                duration: None,
                requires: vec![],
            },
            MoleculeBead {
                title: "C".to_string(),
                description: "".to_string(),
                labels: vec![],
                depends_on: vec![0, 1],
                duration: None,
                requires: vec![],
            },
        ];

        let (order, has_cycle) = topological_sort(&beads);
        assert!(!has_cycle);
        assert_eq!(order.len(), 3);
        // A must come before B and C
        assert!(order.iter().position(|&x| x == 0) < order.iter().position(|&x| x == 1));
        assert!(order.iter().position(|&x| x == 1) < order.iter().position(|&x| x == 2));
    }
}
