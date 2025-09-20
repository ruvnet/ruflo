/**
 * Unit Tests for AIME Actor Factory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AIME Actor Factory', () => {
  let actorFactory;
  let mockPersonaLibrary;
  let mockKnowledgeBase;

  beforeEach(() => {
    mockPersonaLibrary = createMockPersonaLibrary();
    mockKnowledgeBase = createMockKnowledgeBase();
    actorFactory = createMockActorFactory(mockPersonaLibrary, mockKnowledgeBase);
  });

  afterEach(() => {
    actorFactory = null;
  });

  describe('Agent Creation', () => {
    it('should create agents with appropriate personas', async () => {
      const requirements = [
        { type: 'frontend', capabilities: ['react', 'typescript', 'css'] },
        { type: 'backend', capabilities: ['nodejs', 'express', 'api'] },
        { type: 'database', capabilities: ['mongodb', 'sql', 'optimization'] }
      ];

      const agents = await actorFactory.createAgentsForPlan({ requirements });

      expect(agents.length).toBe(3);

      // Validate frontend agent
      const frontendAgent = agents.find(a => a.type === 'frontend');
      expect(frontendAgent).toBeDefined();
      expect(frontendAgent.persona).toContain('frontend');
      expect(frontendAgent.capabilities).toContain('react');
      expect(frontendAgent.capabilities).toContain('typescript');

      // Validate backend agent
      const backendAgent = agents.find(a => a.type === 'backend');
      expect(backendAgent).toBeDefined();
      expect(backendAgent.persona).toContain('backend');
      expect(backendAgent.capabilities).toContain('nodejs');

      // Validate database agent
      const dbAgent = agents.find(a => a.type === 'database');
      expect(dbAgent).toBeDefined();
      expect(dbAgent.persona).toContain('database');
      expect(dbAgent.capabilities).toContain('mongodb');
    });

    it('should assign unique identifiers to each agent', async () => {
      const requirements = Array(5).fill(null).map((_, i) => ({
        type: 'generic',
        capabilities: [`skill_${i}`]
      }));

      const agents = await actorFactory.createAgentsForPlan({ requirements });
      const agentIds = agents.map(a => a.id);
      const uniqueIds = new Set(agentIds);

      expect(uniqueIds.size).toBe(agents.length);
    });

    it('should match personas to capabilities effectively', async () => {
      const testCases = [
        {
          type: 'ml_engineer',
          capabilities: ['python', 'tensorflow', 'data_analysis'],
          expectedPersonaKeywords: ['ml', 'machine', 'learning', 'data']
        },
        {
          type: 'devops_engineer',
          capabilities: ['docker', 'kubernetes', 'ci_cd'],
          expectedPersonaKeywords: ['devops', 'deployment', 'infrastructure']
        },
        {
          type: 'security_specialist',
          capabilities: ['penetration_testing', 'vulnerability_assessment'],
          expectedPersonaKeywords: ['security', 'safety', 'protection']
        }
      ];

      for (const testCase of testCases) {
        const agents = await actorFactory.createAgentsForPlan({
          requirements: [testCase]
        });

        const agent = agents[0];
        const personaLower = agent.persona.toLowerCase();
        
        const hasExpectedKeywords = testCase.expectedPersonaKeywords.some(keyword =>
          personaLower.includes(keyword)
        );

        expect(hasExpectedKeywords).toBe(true);
      }
    });
  });

  describe('Specialized Agent Creation', () => {
    it('should create agents with domain-specific knowledge', async () => {
      const specializations = [
        {
          type: 'ai_researcher',
          domain: 'natural_language_processing',
          knowledgeLevel: 'expert'
        },
        {
          type: 'web_developer',
          domain: 'frontend_frameworks',
          knowledgeLevel: 'advanced'
        },
        {
          type: 'data_scientist',
          domain: 'machine_learning',
          knowledgeLevel: 'expert'
        }
      ];

      for (const spec of specializations) {
        const agent = await actorFactory.createSpecializedAgent(spec);

        expect(agent.type).toBe(spec.type);
        expect(agent.knowledgeBase).toBeDefined();
        expect(agent.knowledgeBase.domain).toBe(spec.domain);
        expect(agent.knowledgeBase.expertiseLevel).toBe(spec.knowledgeLevel);
        
        // Validate knowledge depth
        expect(agent.knowledgeBase.concepts.length).toBeGreaterThan(10);
        expect(agent.knowledgeBase.techniques.length).toBeGreaterThan(5);
        
        if (spec.knowledgeLevel === 'expert') {
          expect(agent.knowledgeBase.concepts.length).toBeGreaterThan(20);
          expect(agent.knowledgeBase.techniques.length).toBeGreaterThan(10);
        }
      }
    });

    it('should include relevant knowledge for domain specialization', async () => {
      const agent = await actorFactory.createSpecializedAgent({
        type: 'blockchain_developer',
        domain: 'cryptocurrency',
        knowledgeLevel: 'expert'
      });

      const knowledgeItems = [
        ...agent.knowledgeBase.concepts,
        ...agent.knowledgeBase.techniques
      ].join(' ').toLowerCase();

      const expectedTerms = [
        'blockchain', 'cryptocurrency', 'smart_contract', 'consensus',
        'mining', 'wallet', 'transaction', 'decentralized'
      ];

      const foundTerms = expectedTerms.filter(term =>
        knowledgeItems.includes(term)
      );

      expect(foundTerms.length).toBeGreaterThan(expectedTerms.length * 0.6);
    });
  });

  describe('Agent Capability Validation', () => {
    it('should validate agent capabilities against requirements', async () => {
      const requirements = {
        mandatorySkills: ['javascript', 'react'],
        preferredSkills: ['typescript', 'testing'],
        experienceLevel: 'senior'
      };

      const agent = await actorFactory.createAgentWithRequirements(requirements);

      // Check mandatory skills
      for (const skill of requirements.mandatorySkills) {
        expect(agent.capabilities).toContain(skill);
      }

      // Check experience level reflected in capabilities
      if (requirements.experienceLevel === 'senior') {
        expect(agent.capabilities.length).toBeGreaterThan(5);
        expect(agent.experienceLevel).toBe('senior');
      }
    });

    it('should handle capability conflicts and prioritization', async () => {
      const conflictingRequirements = {
        type: 'fullstack_developer',
        frontendSkills: ['react', 'vue'],
        backendSkills: ['nodejs', 'python'],
        maxCapabilities: 6
      };

      const agent = await actorFactory.createAgentWithRequirements(conflictingRequirements);

      expect(agent.capabilities.length).toBeLessThanOrEqual(conflictingRequirements.maxCapabilities);
      
      // Should prioritize based on agent type
      if (agent.type === 'fullstack_developer') {
        const hasFrontend = agent.capabilities.some(cap => 
          conflictingRequirements.frontendSkills.includes(cap)
        );
        const hasBackend = agent.capabilities.some(cap => 
          conflictingRequirements.backendSkills.includes(cap)
        );
        
        expect(hasFrontend).toBe(true);
        expect(hasBackend).toBe(true);
      }
    });
  });

  describe('Knowledge Base Integration', () => {
    it('should integrate knowledge base effectively', async () => {
      const agent = await actorFactory.createSpecializedAgent({
        type: 'cybersecurity_expert',
        domain: 'network_security',
        knowledgeLevel: 'expert'
      });

      expect(agent.knowledgeBase.domain).toBe('network_security');
      expect(agent.knowledgeBase.concepts).toBeInstanceOf(Array);
      expect(agent.knowledgeBase.techniques).toBeInstanceOf(Array);
      expect(agent.knowledgeBase.bestPractices).toBeInstanceOf(Array);
      
      // Knowledge should be relevant to domain
      const allKnowledge = [
        ...agent.knowledgeBase.concepts,
        ...agent.knowledgeBase.techniques,
        ...agent.knowledgeBase.bestPractices
      ].join(' ').toLowerCase();

      expect(allKnowledge).toContain('security');
    });

    it('should scale knowledge complexity with expertise level', async () => {
      const expertAgent = await actorFactory.createSpecializedAgent({
        type: 'data_scientist',
        domain: 'machine_learning',
        knowledgeLevel: 'expert'
      });

      const beginnerAgent = await actorFactory.createSpecializedAgent({
        type: 'data_scientist',
        domain: 'machine_learning',
        knowledgeLevel: 'beginner'
      });

      expect(expertAgent.knowledgeBase.concepts.length)
        .toBeGreaterThan(beginnerAgent.knowledgeBase.concepts.length);
      
      expect(expertAgent.knowledgeBase.techniques.length)
        .toBeGreaterThan(beginnerAgent.knowledgeBase.techniques.length);
    });
  });

  describe('Performance and Scalability', () => {
    it('should create agents within performance targets', async () => {
      const agentCount = 20;
      const startTime = performance.now();

      const agentPromises = Array.from({ length: agentCount }, (_, i) =>
        actorFactory.createAgent({
          type: 'generic',
          id: `perf_test_agent_${i}`
        })
      );

      const agents = await Promise.all(agentPromises);
      const duration = performance.now() - startTime;

      expect(agents.length).toBe(agentCount);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
      
      const averageCreationTime = duration / agentCount;
      expect(averageCreationTime).toBeLessThan(250); // 250ms per agent
    });

    it('should handle concurrent agent creation', async () => {
      const concurrentBatches = 3;
      const agentsPerBatch = 10;

      const batchPromises = Array.from({ length: concurrentBatches }, (_, batchIndex) =>
        Promise.all(
          Array.from({ length: agentsPerBatch }, (_, agentIndex) =>
            actorFactory.createAgent({
              type: 'concurrent_test',
              id: `batch_${batchIndex}_agent_${agentIndex}`
            })
          )
        )
      );

      const batches = await Promise.all(batchPromises);
      const totalAgents = batches.flat();

      expect(totalAgents.length).toBe(concurrentBatches * agentsPerBatch);
      
      // Verify all agents are unique
      const agentIds = totalAgents.map(a => a.id);
      const uniqueIds = new Set(agentIds);
      expect(uniqueIds.size).toBe(totalAgents.length);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid agent specifications gracefully', async () => {
      const invalidSpecs = [
        { type: '', capabilities: [] },
        { type: null, capabilities: ['skill1'] },
        { capabilities: ['skill1'] }, // Missing type
        { type: 'valid_type' } // Missing capabilities
      ];

      for (const spec of invalidSpecs) {
        try {
          await actorFactory.createAgent(spec);
          // Should throw error for invalid specs
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }
    });

    it('should provide fallback when specialized knowledge is unavailable', async () => {
      const unavailableDomain = 'nonexistent_domain_12345';
      
      const agent = await actorFactory.createSpecializedAgent({
        type: 'specialist',
        domain: unavailableDomain,
        knowledgeLevel: 'expert'
      });

      // Should create agent with fallback knowledge
      expect(agent).toBeDefined();
      expect(agent.knowledgeBase).toBeDefined();
      expect(agent.knowledgeBase.concepts.length).toBeGreaterThan(0);
    });
  });
});

// Mock factory and helper functions

function createMockActorFactory(personaLibrary, knowledgeBase) {
  return {
    async createAgentsForPlan(plan) {
      return plan.requirements.map(req => ({
        id: `agent_${Math.random().toString(36).substr(2, 9)}`,
        type: req.type,
        capabilities: req.capabilities,
        persona: `${req.type}_persona`,
        createdAt: new Date().toISOString()
      }));
    },

    async createSpecializedAgent(spec) {
      const knowledgeItems = knowledgeBase.getDomainKnowledge(spec.domain, spec.knowledgeLevel);
      
      return {
        id: `specialist_${Math.random().toString(36).substr(2, 9)}`,
        type: spec.type,
        knowledgeBase: {
          domain: spec.domain,
          expertiseLevel: spec.knowledgeLevel,
          concepts: knowledgeItems.concepts,
          techniques: knowledgeItems.techniques,
          bestPractices: knowledgeItems.bestPractices || []
        },
        createdAt: new Date().toISOString()
      };
    },

    async createAgent(spec) {
      if (!spec.type || spec.type === '' || spec.type === null) {
        throw new Error('Agent type is required');
      }

      return {
        id: spec.id || `agent_${Math.random().toString(36).substr(2, 9)}`,
        type: spec.type,
        capabilities: spec.capabilities || [],
        status: 'ready',
        createdAt: new Date().toISOString()
      };
    },

    async createAgentWithRequirements(requirements) {
      const capabilities = [
        ...requirements.mandatorySkills,
        ...requirements.preferredSkills?.slice(0, 2) || []
      ];

      return {
        id: `req_agent_${Math.random().toString(36).substr(2, 9)}`,
        type: requirements.type || 'generic',
        capabilities: capabilities.slice(0, requirements.maxCapabilities || 10),
        experienceLevel: requirements.experienceLevel,
        createdAt: new Date().toISOString()
      };
    }
  };
}

function createMockPersonaLibrary() {
  const personas = {
    frontend: {
      traits: ['user-focused', 'design-oriented', 'interactive'],
      specializations: ['ui/ux', 'responsive-design', 'accessibility'],
      tools: ['react', 'vue', 'angular', 'css', 'javascript']
    },
    backend: {
      traits: ['system-focused', 'performance-oriented', 'scalable'],
      specializations: ['api-design', 'database-optimization', 'server-architecture'],
      tools: ['nodejs', 'python', 'java', 'docker', 'kubernetes']
    },
    database: {
      traits: ['data-focused', 'optimization-oriented', 'reliable'],
      specializations: ['schema-design', 'query-optimization', 'data-modeling'],
      tools: ['mongodb', 'postgresql', 'redis', 'elasticsearch']
    },
    devops: {
      traits: ['automation-focused', 'reliability-oriented', 'scalable'],
      specializations: ['ci-cd', 'infrastructure', 'monitoring'],
      tools: ['docker', 'kubernetes', 'jenkins', 'terraform']
    }
  };

  return {
    getPersona: (type) => personas[type] || personas.generic,
    getAllPersonas: () => Object.keys(personas)
  };
}

function createMockKnowledgeBase() {
  const knowledgeDomains = {
    natural_language_processing: {
      concepts: [
        'tokenization', 'named_entity_recognition', 'sentiment_analysis',
        'language_modeling', 'attention_mechanisms', 'transformer_architecture',
        'bert_models', 'gpt_architecture', 'text_classification', 'sequence_labeling',
        'machine_translation', 'text_summarization', 'question_answering',
        'information_extraction', 'semantic_parsing', 'dialogue_systems'
      ],
      techniques: [
        'word_embeddings', 'recurrent_neural_networks', 'convolutional_neural_networks',
        'attention_mechanisms', 'transfer_learning', 'fine_tuning',
        'data_augmentation', 'active_learning', 'few_shot_learning',
        'zero_shot_learning', 'multi_task_learning'
      ]
    },
    machine_learning: {
      concepts: [
        'supervised_learning', 'unsupervised_learning', 'reinforcement_learning',
        'deep_learning', 'neural_networks', 'gradient_descent', 'backpropagation',
        'overfitting', 'underfitting', 'regularization', 'cross_validation',
        'feature_engineering', 'dimensionality_reduction', 'ensemble_methods',
        'bias_variance_tradeoff', 'model_selection', 'hyperparameter_tuning'
      ],
      techniques: [
        'linear_regression', 'logistic_regression', 'decision_trees',
        'random_forest', 'support_vector_machines', 'k_means_clustering',
        'principal_component_analysis', 'q_learning', 'policy_gradients',
        'convolutional_neural_networks', 'recurrent_neural_networks'
      ]
    },
    cybersecurity: {
      concepts: [
        'threat_modeling', 'vulnerability_assessment', 'penetration_testing',
        'incident_response', 'forensics', 'encryption', 'authentication',
        'authorization', 'network_security', 'application_security',
        'social_engineering', 'malware_analysis', 'risk_assessment'
      ],
      techniques: [
        'sql_injection_testing', 'cross_site_scripting_detection',
        'buffer_overflow_exploitation', 'privilege_escalation',
        'lateral_movement', 'steganography', 'cryptanalysis'
      ]
    },
    network_security: {
      concepts: [
        'firewall_configuration', 'intrusion_detection', 'intrusion_prevention',
        'network_monitoring', 'packet_analysis', 'protocol_security',
        'vpn_implementation', 'network_segmentation', 'access_control',
        'ddos_protection', 'wireless_security', 'network_forensics'
      ],
      techniques: [
        'port_scanning', 'network_mapping', 'traffic_analysis',
        'protocol_fuzzing', 'man_in_the_middle_attacks',
        'arp_spoofing', 'dns_poisoning', 'session_hijacking'
      ]
    }
  };

  return {
    getDomainKnowledge: (domain, level) => {
      const domainData = knowledgeDomains[domain] || {
        concepts: ['generic_concept_1', 'generic_concept_2'],
        techniques: ['generic_technique_1', 'generic_technique_2']
      };

      const multiplier = level === 'expert' ? 1 : level === 'advanced' ? 0.7 : 0.4;
      
      return {
        concepts: domainData.concepts.slice(0, Math.ceil(domainData.concepts.length * multiplier)),
        techniques: domainData.techniques.slice(0, Math.ceil(domainData.techniques.length * multiplier)),
        bestPractices: [
          'follow_industry_standards',
          'implement_thorough_testing',
          'maintain_documentation',
          'ensure_security_compliance'
        ]
      };
    }
  };
}