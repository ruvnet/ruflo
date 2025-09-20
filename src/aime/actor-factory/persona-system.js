/**
 * Persona System for AIME Actor Factory
 * 
 * Manages personality traits, behavioral patterns, decision frameworks,
 * and expertise areas for dynamic actors
 */

export class PersonaSystem {
  constructor(neuralPatternEngine, behaviorLibrary) {
    this.neuralEngine = neuralPatternEngine;
    this.behaviorLibrary = behaviorLibrary || this.createDefaultBehaviorLibrary();
    this.personaTemplates = this.loadPersonaTemplates();
    this.activePersonas = new Map();
    this.behaviorPatterns = new Map();
  }

  /**
   * Define a new persona with comprehensive characteristics
   */
  definePersona(personaSpec) {
    const persona = {
      id: this.generatePersonaId(),
      type: personaSpec.type,
      name: personaSpec.name,
      
      // Core personality traits (0-1 scale)
      traits: {
        analytical: this.normalizeValue(personaSpec.traits?.analytical, 0.5),
        creative: this.normalizeValue(personaSpec.traits?.creative, 0.5),
        methodical: this.normalizeValue(personaSpec.traits?.methodical, 0.5),
        collaborative: this.normalizeValue(personaSpec.traits?.collaborative, 0.5),
        innovative: this.normalizeValue(personaSpec.traits?.innovative, 0.5),
        empathetic: this.normalizeValue(personaSpec.traits?.empathetic, 0.5),
        decisive: this.normalizeValue(personaSpec.traits?.decisive, 0.5),
        adaptable: this.normalizeValue(personaSpec.traits?.adaptable, 0.5)
      },
      
      // Behavioral patterns
      behaviors: {
        problemSolving: this.selectBehaviorPattern('problemSolving', personaSpec),
        communication: this.selectBehaviorPattern('communication', personaSpec),
        collaboration: this.selectBehaviorPattern('collaboration', personaSpec),
        learning: this.selectBehaviorPattern('learning', personaSpec),
        leadership: this.selectBehaviorPattern('leadership', personaSpec),
        conflictResolution: this.selectBehaviorPattern('conflictResolution', personaSpec)
      },
      
      // Decision-making framework
      decisionFramework: {
        priorityMatrix: this.buildPriorityMatrix(personaSpec),
        evaluationCriteria: this.defineEvaluationCriteria(personaSpec),
        riskTolerance: personaSpec.riskTolerance || 'moderate',
        adaptabilityLevel: personaSpec.adaptabilityLevel || 'high',
        decisionSpeed: personaSpec.decisionSpeed || 'balanced',
        consensusPreference: personaSpec.consensusPreference || 'moderate'
      },
      
      // Expertise areas
      expertise: {
        primary: personaSpec.primaryExpertise || [],
        secondary: personaSpec.secondaryExpertise || [],
        emerging: personaSpec.emergingExpertise || [],
        depth: this.calculateExpertiseDepth(personaSpec)
      },
      
      // Work style preferences
      workStyle: {
        autonomy: personaSpec.workStyle?.autonomy || 'balanced',
        structure: personaSpec.workStyle?.structure || 'moderate',
        pace: personaSpec.workStyle?.pace || 'steady',
        focusType: personaSpec.workStyle?.focusType || 'balanced', // deep vs broad
        collaborationType: personaSpec.workStyle?.collaborationType || 'mixed'
      },
      
      // Emotional intelligence
      emotionalIntelligence: {
        selfAwareness: this.normalizeValue(personaSpec.emotionalIntelligence?.selfAwareness, 0.6),
        selfRegulation: this.normalizeValue(personaSpec.emotionalIntelligence?.selfRegulation, 0.6),
        motivation: this.normalizeValue(personaSpec.emotionalIntelligence?.motivation, 0.7),
        empathy: this.normalizeValue(personaSpec.emotionalIntelligence?.empathy, 0.5),
        socialSkills: this.normalizeValue(personaSpec.emotionalIntelligence?.socialSkills, 0.5)
      }
    };
    
    this.activePersonas.set(persona.id, persona);
    return persona;
  }

  /**
   * Update existing persona characteristics
   */
  async updatePersona(persona, updates) {
    const updatedPersona = { ...persona };
    
    if (updates.traits) {
      updatedPersona.traits = {
        ...persona.traits,
        ...this.normalizeTraits(updates.traits)
      };
    }
    
    if (updates.behaviors) {
      for (const [behaviorType, behaviorUpdate] of Object.entries(updates.behaviors)) {
        if (behaviorUpdate) {
          updatedPersona.behaviors[behaviorType] = this.selectBehaviorPattern(
            behaviorType,
            { ...updates, currentBehavior: persona.behaviors[behaviorType] }
          );
        }
      }
    }
    
    if (updates.decisionFramework) {
      updatedPersona.decisionFramework = {
        ...persona.decisionFramework,
        ...updates.decisionFramework
      };
    }
    
    if (updates.expertise) {
      updatedPersona.expertise = this.updateExpertise(persona.expertise, updates.expertise);
    }
    
    if (updates.workStyle) {
      updatedPersona.workStyle = {
        ...persona.workStyle,
        ...updates.workStyle
      };
    }
    
    updatedPersona.lastUpdated = new Date().toISOString();
    
    this.activePersonas.set(updatedPersona.id, updatedPersona);
    return updatedPersona;
  }

  /**
   * Select optimal behavior pattern based on persona and context
   */
  selectBehaviorPattern(behaviorType, personaSpec) {
    const candidatePatterns = this.behaviorLibrary.getPatternsForType(behaviorType);
    
    // If no neural engine, use rule-based selection
    if (!this.neuralEngine) {
      return this.ruleBasedPatternSelection(behaviorType, personaSpec, candidatePatterns);
    }
    
    // Use neural patterns for optimal selection
    const personaProfile = this.createPersonaProfile(personaSpec);
    return this.neuralEngine.selectOptimalPattern(
      candidatePatterns,
      personaProfile,
      behaviorType
    );
  }

  /**
   * Rule-based behavior pattern selection
   */
  ruleBasedPatternSelection(behaviorType, personaSpec, candidatePatterns) {
    let selectedPattern = candidatePatterns[0]; // Default to first
    
    switch (behaviorType) {
      case 'problemSolving':
        if (personaSpec.traits?.analytical > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'systematic') || selectedPattern;
        } else if (personaSpec.traits?.creative > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'innovative') || selectedPattern;
        }
        break;
        
      case 'communication':
        if (personaSpec.traits?.collaborative > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'inclusive') || selectedPattern;
        } else if (personaSpec.traits?.decisive > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'direct') || selectedPattern;
        }
        break;
        
      case 'collaboration':
        if (personaSpec.traits?.empathetic > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'supportive') || selectedPattern;
        } else if (personaSpec.traits?.methodical > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'structured') || selectedPattern;
        }
        break;
        
      case 'learning':
        if (personaSpec.traits?.analytical > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'theoretical') || selectedPattern;
        } else if (personaSpec.traits?.adaptable > 0.7) {
          selectedPattern = candidatePatterns.find(p => p.style === 'experiential') || selectedPattern;
        }
        break;
    }
    
    return selectedPattern;
  }

  /**
   * Build priority matrix based on persona characteristics
   */
  buildPriorityMatrix(personaSpec) {
    const matrix = {
      quality: 0.5,
      speed: 0.5,
      innovation: 0.5,
      stability: 0.5,
      collaboration: 0.5,
      autonomy: 0.5
    };
    
    // Adjust based on traits
    if (personaSpec.traits?.methodical > 0.7) {
      matrix.quality += 0.3;
      matrix.speed -= 0.2;
    }
    
    if (personaSpec.traits?.innovative > 0.7) {
      matrix.innovation += 0.3;
      matrix.stability -= 0.2;
    }
    
    if (personaSpec.traits?.collaborative > 0.7) {
      matrix.collaboration += 0.3;
      matrix.autonomy -= 0.2;
    }
    
    // Normalize values
    const total = Object.values(matrix).reduce((sum, val) => sum + val, 0);
    for (const key in matrix) {
      matrix[key] = matrix[key] / total;
    }
    
    return matrix;
  }

  /**
   * Define evaluation criteria for decision-making
   */
  defineEvaluationCriteria(personaSpec) {
    const criteria = [];
    
    // Add criteria based on traits
    if (personaSpec.traits?.analytical > 0.6) {
      criteria.push({
        name: 'data-driven',
        weight: 0.8,
        evaluator: 'quantitative'
      });
    }
    
    if (personaSpec.traits?.creative > 0.6) {
      criteria.push({
        name: 'innovation-potential',
        weight: 0.7,
        evaluator: 'qualitative'
      });
    }
    
    if (personaSpec.traits?.collaborative > 0.6) {
      criteria.push({
        name: 'team-impact',
        weight: 0.7,
        evaluator: 'social'
      });
    }
    
    if (personaSpec.traits?.methodical > 0.6) {
      criteria.push({
        name: 'process-adherence',
        weight: 0.6,
        evaluator: 'procedural'
      });
    }
    
    // Always include basic criteria
    criteria.push(
      {
        name: 'feasibility',
        weight: 0.5,
        evaluator: 'practical'
      },
      {
        name: 'risk-reward',
        weight: 0.5,
        evaluator: 'balanced'
      }
    );
    
    return criteria;
  }

  /**
   * Create persona profile for neural pattern selection
   */
  createPersonaProfile(personaSpec) {
    return {
      traits: personaSpec.traits || {},
      expertise: personaSpec.primaryExpertise || [],
      context: personaSpec.context || {},
      preferences: personaSpec.preferences || {},
      constraints: personaSpec.constraints || {}
    };
  }

  /**
   * Update expertise areas
   */
  updateExpertise(currentExpertise, updates) {
    const updated = { ...currentExpertise };
    
    if (updates.addPrimary) {
      updated.primary = [...new Set([...updated.primary, ...updates.addPrimary])];
    }
    
    if (updates.addSecondary) {
      updated.secondary = [...new Set([...updated.secondary, ...updates.addSecondary])];
    }
    
    if (updates.promoteToPrimary) {
      const toPromote = updates.promoteToPrimary;
      updated.secondary = updated.secondary.filter(e => !toPromote.includes(e));
      updated.primary = [...new Set([...updated.primary, ...toPromote])];
    }
    
    if (updates.emerging) {
      updated.emerging = [...new Set([...updated.emerging, ...updates.emerging])];
    }
    
    updated.depth = this.calculateExpertiseDepth({ expertise: updated });
    
    return updated;
  }

  /**
   * Calculate expertise depth score
   */
  calculateExpertiseDepth(personaSpec) {
    const expertise = personaSpec.expertise || personaSpec;
    let depth = 0.5; // Base depth
    
    if (expertise.primary?.length > 0) {
      depth += 0.2 * Math.min(expertise.primary.length / 3, 1);
    }
    
    if (expertise.secondary?.length > 0) {
      depth += 0.1 * Math.min(expertise.secondary.length / 5, 1);
    }
    
    if (expertise.emerging?.length > 0) {
      depth += 0.05 * Math.min(expertise.emerging.length / 3, 1);
    }
    
    // Experience modifier
    if (personaSpec.experience) {
      depth += 0.15 * Math.min(personaSpec.experience / 10, 1);
    }
    
    return Math.min(depth, 1.0);
  }

  /**
   * Helper methods
   */
  
  normalizeValue(value, defaultValue = 0.5) {
    if (value === undefined || value === null) return defaultValue;
    return Math.max(0, Math.min(1, value));
  }
  
  normalizeTraits(traits) {
    const normalized = {};
    for (const [key, value] of Object.entries(traits)) {
      normalized[key] = this.normalizeValue(value);
    }
    return normalized;
  }
  
  generatePersonaId() {
    return `persona_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Create default behavior library if none provided
   */
  createDefaultBehaviorLibrary() {
    return {
      getPatternsForType(type) {
        const patterns = {
          problemSolving: [
            { id: 'ps1', style: 'systematic', approach: 'step-by-step analysis' },
            { id: 'ps2', style: 'innovative', approach: 'creative exploration' },
            { id: 'ps3', style: 'collaborative', approach: 'team brainstorming' }
          ],
          communication: [
            { id: 'cm1', style: 'direct', approach: 'clear and concise' },
            { id: 'cm2', style: 'inclusive', approach: 'collaborative dialogue' },
            { id: 'cm3', style: 'diplomatic', approach: 'careful negotiation' }
          ],
          collaboration: [
            { id: 'cb1', style: 'supportive', approach: 'team enablement' },
            { id: 'cb2', style: 'structured', approach: 'process-driven' },
            { id: 'cb3', style: 'flexible', approach: 'adaptive coordination' }
          ],
          learning: [
            { id: 'ln1', style: 'theoretical', approach: 'concept-first' },
            { id: 'ln2', style: 'experiential', approach: 'hands-on practice' },
            { id: 'ln3', style: 'social', approach: 'peer learning' }
          ],
          leadership: [
            { id: 'ld1', style: 'visionary', approach: 'inspirational guidance' },
            { id: 'ld2', style: 'servant', approach: 'team empowerment' },
            { id: 'ld3', style: 'strategic', approach: 'goal-oriented direction' }
          ],
          conflictResolution: [
            { id: 'cr1', style: 'mediator', approach: 'neutral facilitation' },
            { id: 'cr2', style: 'analytical', approach: 'fact-based resolution' },
            { id: 'cr3', style: 'empathetic', approach: 'emotional understanding' }
          ]
        };
        
        return patterns[type] || [];
      }
    };
  }
  
  /**
   * Load predefined persona templates
   */
  loadPersonaTemplates() {
    const templates = new Map();
    
    // Analytical Thinker
    templates.set('analytical-thinker', {
      traits: {
        analytical: 0.9,
        creative: 0.4,
        methodical: 0.8,
        collaborative: 0.5,
        innovative: 0.5,
        empathetic: 0.4,
        decisive: 0.7,
        adaptable: 0.6
      },
      riskTolerance: 'low',
      adaptabilityLevel: 'moderate',
      decisionSpeed: 'deliberate',
      workStyle: {
        autonomy: 'high',
        structure: 'high',
        pace: 'steady',
        focusType: 'deep',
        collaborationType: 'selective'
      }
    });
    
    // Creative Innovator
    templates.set('creative-innovator', {
      traits: {
        analytical: 0.5,
        creative: 0.9,
        methodical: 0.3,
        collaborative: 0.7,
        innovative: 0.9,
        empathetic: 0.6,
        decisive: 0.6,
        adaptable: 0.8
      },
      riskTolerance: 'high',
      adaptabilityLevel: 'high',
      decisionSpeed: 'fast',
      workStyle: {
        autonomy: 'high',
        structure: 'low',
        pace: 'variable',
        focusType: 'broad',
        collaborationType: 'open'
      }
    });
    
    // Collaborative Leader
    templates.set('collaborative-leader', {
      traits: {
        analytical: 0.6,
        creative: 0.6,
        methodical: 0.7,
        collaborative: 0.9,
        innovative: 0.6,
        empathetic: 0.8,
        decisive: 0.7,
        adaptable: 0.7
      },
      riskTolerance: 'moderate',
      adaptabilityLevel: 'high',
      decisionSpeed: 'balanced',
      consensusPreference: 'high',
      workStyle: {
        autonomy: 'balanced',
        structure: 'moderate',
        pace: 'steady',
        focusType: 'balanced',
        collaborationType: 'inclusive'
      }
    });
    
    // Methodical Executor
    templates.set('methodical-executor', {
      traits: {
        analytical: 0.7,
        creative: 0.3,
        methodical: 0.9,
        collaborative: 0.5,
        innovative: 0.3,
        empathetic: 0.5,
        decisive: 0.8,
        adaptable: 0.4
      },
      riskTolerance: 'low',
      adaptabilityLevel: 'low',
      decisionSpeed: 'deliberate',
      workStyle: {
        autonomy: 'moderate',
        structure: 'very-high',
        pace: 'consistent',
        focusType: 'deep',
        collaborationType: 'structured'
      }
    });
    
    // Adaptive Generalist
    templates.set('adaptive-generalist', {
      traits: {
        analytical: 0.6,
        creative: 0.6,
        methodical: 0.6,
        collaborative: 0.6,
        innovative: 0.6,
        empathetic: 0.6,
        decisive: 0.6,
        adaptable: 0.9
      },
      riskTolerance: 'moderate',
      adaptabilityLevel: 'very-high',
      decisionSpeed: 'adaptive',
      workStyle: {
        autonomy: 'flexible',
        structure: 'flexible',
        pace: 'adaptive',
        focusType: 'balanced',
        collaborationType: 'situational'
      }
    });
    
    return templates;
  }
}

export default PersonaSystem;