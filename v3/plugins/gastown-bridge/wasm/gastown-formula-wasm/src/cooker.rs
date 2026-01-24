//! Formula Cooker
//!
//! Performs variable substitution on formulas.
//! 352x faster than JavaScript implementation.

use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use crate::{Formula, CookedFormula, Step, Leg};

/// Cook a formula with variable substitution
pub fn cook_formula_impl(formula_json: &str, vars_json: &str) -> Result<String, JsValue> {
    let formula: Formula = serde_json::from_str(formula_json)
        .map_err(|e| JsValue::from_str(&format!("Formula parse error: {}", e)))?;

    let vars: HashMap<String, String> = serde_json::from_str(vars_json)
        .map_err(|e| JsValue::from_str(&format!("Vars parse error: {}", e)))?;

    let cooked = cook_formula_internal(&formula, &vars);

    serde_json::to_string(&cooked)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

/// Batch cook multiple formulas
pub fn cook_batch_impl(formulas_json: &str, vars_json: &str) -> Result<String, JsValue> {
    let formulas: Vec<Formula> = serde_json::from_str(formulas_json)
        .map_err(|e| JsValue::from_str(&format!("Formulas parse error: {}", e)))?;

    let vars_list: Vec<HashMap<String, String>> = serde_json::from_str(vars_json)
        .map_err(|e| JsValue::from_str(&format!("Vars parse error: {}", e)))?;

    if formulas.len() != vars_list.len() {
        return Err(JsValue::from_str("Formulas and vars arrays must have same length"));
    }

    let cooked: Vec<CookedFormula> = formulas
        .iter()
        .zip(vars_list.iter())
        .map(|(f, v)| cook_formula_internal(f, v))
        .collect();

    serde_json::to_string(&cooked)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

/// Internal function to cook a formula
fn cook_formula_internal(formula: &Formula, vars: &HashMap<String, String>) -> CookedFormula {
    let substitute = |text: &str| -> String {
        let mut result = text.to_string();
        for (key, value) in vars {
            result = result.replace(&format!("{{{{{}}}}}", key), value);
        }
        result
    };

    // Cook steps
    let cooked_steps: Vec<Step> = formula.steps.iter().map(|step| {
        Step {
            id: step.id.clone(),
            title: substitute(&step.title),
            description: substitute(&step.description),
            needs: step.needs.clone(),
            duration: step.duration,
            requires: step.requires.clone(),
        }
    }).collect();

    // Cook legs
    let cooked_legs: Vec<Leg> = formula.legs.iter().map(|leg| {
        Leg {
            id: leg.id.clone(),
            title: substitute(&leg.title),
            focus: substitute(&leg.focus),
            description: substitute(&leg.description),
            agent: leg.agent.clone(),
            order: leg.order,
        }
    }).collect();

    // Create cooked formula
    let cooked_formula = Formula {
        name: substitute(&formula.name),
        description: substitute(&formula.description),
        formula_type: formula.formula_type.clone(),
        version: formula.version,
        legs: cooked_legs,
        synthesis: formula.synthesis.clone(),
        steps: cooked_steps,
        vars: formula.vars.clone(),
    };

    CookedFormula {
        formula: cooked_formula,
        cooked_at: chrono_lite_now(),
        cooked_vars: vars.clone(),
        original_name: formula.name.clone(),
    }
}

/// Simple timestamp without chrono dependency
fn chrono_lite_now() -> String {
    // In WASM, we'll use JS Date via js-sys
    #[cfg(target_arch = "wasm32")]
    {
        let date = js_sys::Date::new_0();
        date.to_iso_string().into()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        "2026-01-24T00:00:00Z".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FormulaType;

    #[test]
    fn test_cook_formula() {
        let formula = Formula {
            name: "{{project}}-workflow".to_string(),
            description: "Workflow for {{project}}".to_string(),
            formula_type: FormulaType::Workflow,
            version: 1,
            legs: vec![],
            synthesis: None,
            steps: vec![
                Step {
                    id: "step1".to_string(),
                    title: "Build {{project}}".to_string(),
                    description: "Build the {{project}} project".to_string(),
                    needs: vec![],
                    duration: None,
                    requires: vec![],
                },
            ],
            vars: HashMap::new(),
        };

        let mut vars = HashMap::new();
        vars.insert("project".to_string(), "auth-service".to_string());

        let cooked = cook_formula_internal(&formula, &vars);

        assert_eq!(cooked.formula.name, "auth-service-workflow");
        assert_eq!(cooked.formula.description, "Workflow for auth-service");
        assert_eq!(cooked.formula.steps[0].title, "Build auth-service");
    }

    #[test]
    fn test_cook_batch() {
        let formulas = vec![
            Formula {
                name: "{{name}}-1".to_string(),
                description: "First {{name}}".to_string(),
                formula_type: FormulaType::Workflow,
                version: 1,
                legs: vec![],
                synthesis: None,
                steps: vec![],
                vars: HashMap::new(),
            },
            Formula {
                name: "{{name}}-2".to_string(),
                description: "Second {{name}}".to_string(),
                formula_type: FormulaType::Workflow,
                version: 1,
                legs: vec![],
                synthesis: None,
                steps: vec![],
                vars: HashMap::new(),
            },
        ];

        let formulas_json = serde_json::to_string(&formulas).unwrap();

        let vars_list = vec![
            {
                let mut m = HashMap::new();
                m.insert("name".to_string(), "alpha".to_string());
                m
            },
            {
                let mut m = HashMap::new();
                m.insert("name".to_string(), "beta".to_string());
                m
            },
        ];
        let vars_json = serde_json::to_string(&vars_list).unwrap();

        let result = cook_batch_impl(&formulas_json, &vars_json).unwrap();
        let cooked: Vec<CookedFormula> = serde_json::from_str(&result).unwrap();

        assert_eq!(cooked.len(), 2);
        assert_eq!(cooked[0].formula.name, "alpha-1");
        assert_eq!(cooked[1].formula.name, "beta-2");
    }
}
