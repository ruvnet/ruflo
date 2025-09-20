/**
 * Progress Store
 * 
 * Persistent storage for hierarchical progress data.
 * Supports both in-memory and file-based persistence.
 * 
 * @module ProgressStore
 */

import { promises as fs } from 'fs';
import path from 'path';

export class ProgressStore {
  constructor(options = {}) {
    this.options = {
      persistenceEnabled: true,
      storePath: './aime-progress',
      autoSaveInterval: 60000, // 1 minute
      compression: true,
      ...options
    };
    
    // In-memory storage
    this.missions = new Map();
    this.phases = new Map();
    this.tasks = new Map();
    this.subtasks = new Map();
    this.checkpoints = new Map();
    
    // Metadata
    this.metadata = {
      version: '1.0',
      createdAt: Date.now(),
      lastSaved: null,
      saveCount: 0
    };
    
    // Auto-save timer
    this.autoSaveTimer = null;
    
    // Initialize storage
    this.initialize();
  }
  
  /**
   * Initialize storage
   */
  async initialize() {
    if (this.options.persistenceEnabled) {
      try {
        // Create storage directory
        await fs.mkdir(this.options.storePath, { recursive: true });
        
        // Load existing data
        await this.load();
        
        // Start auto-save
        this.startAutoSave();
      } catch (error) {
        console.error('Failed to initialize progress store:', error);
      }
    }
  }
  
  /**
   * Store mission data
   */
  async storeMission(missionId, missionData) {
    this.missions.set(missionId, {
      ...missionData,
      lastUpdated: Date.now()
    });
    
    if (this.options.persistenceEnabled) {
      await this.saveEntity('missions', missionId, missionData);
    }
  }
  
  /**
   * Update mission data
   */
  async updateMission(missionId, updates) {
    const existing = this.missions.get(missionId);
    if (!existing) throw new Error(`Mission ${missionId} not found`);
    
    const updated = {
      ...existing,
      ...updates,
      lastUpdated: Date.now()
    };
    
    this.missions.set(missionId, updated);
    
    if (this.options.persistenceEnabled) {
      await this.saveEntity('missions', missionId, updated);
    }
    
    return updated;
  }
  
  /**
   * Get mission data
   */
  async getMission(missionId) {
    return this.missions.get(missionId);
  }
  
  /**
   * Store checkpoint
   */
  async storeCheckpoint(missionId, checkpoint) {
    if (!this.checkpoints.has(missionId)) {
      this.checkpoints.set(missionId, []);
    }
    
    const checkpoints = this.checkpoints.get(missionId);
    checkpoints.push({
      ...checkpoint,
      storedAt: Date.now()
    });
    
    // Keep only last 100 checkpoints
    if (checkpoints.length > 100) {
      checkpoints.shift();
    }
    
    if (this.options.persistenceEnabled) {
      await this.saveEntity('checkpoints', missionId, checkpoints);
    }
  }
  
  /**
   * Get checkpoints for mission
   */
  async getCheckpoints(missionId) {
    return this.checkpoints.get(missionId) || [];
  }
  
  /**
   * Save entity to file
   */
  async saveEntity(type, id, data) {
    try {
      const filename = path.join(this.options.storePath, `${type}_${id}.json`);
      const content = this.options.compression 
        ? JSON.stringify(data)
        : JSON.stringify(data, null, 2);
      
      await fs.writeFile(filename, content, 'utf8');
    } catch (error) {
      console.error(`Failed to save ${type} ${id}:`, error);
    }
  }
  
  /**
   * Load all data from storage
   */
  async load() {
    try {
      const files = await fs.readdir(this.options.storePath);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filepath = path.join(this.options.storePath, file);
        const content = await fs.readFile(filepath, 'utf8');
        const data = JSON.parse(content);
        
        // Parse filename to determine type and id
        const parts = file.replace('.json', '').split('_');
        const type = parts[0];
        const id = parts.slice(1).join('_');
        
        // Store in appropriate map
        switch (type) {
          case 'missions':
            this.missions.set(id, data);
            break;
          case 'phases':
            this.phases.set(id, data);
            break;
          case 'tasks':
            this.tasks.set(id, data);
            break;
          case 'subtasks':
            this.subtasks.set(id, data);
            break;
          case 'checkpoints':
            this.checkpoints.set(id, data);
            break;
          case 'metadata':
            this.metadata = { ...this.metadata, ...data };
            break;
        }
      }
      
      console.log(`Loaded ${files.length} entities from storage`);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }
  
  /**
   * Save all data to storage
   */
  async saveAll() {
    if (!this.options.persistenceEnabled) return;
    
    try {
      // Save missions
      for (const [id, data] of this.missions) {
        await this.saveEntity('missions', id, data);
      }
      
      // Save phases
      for (const [id, data] of this.phases) {
        await this.saveEntity('phases', id, data);
      }
      
      // Save tasks
      for (const [id, data] of this.tasks) {
        await this.saveEntity('tasks', id, data);
      }
      
      // Save subtasks
      for (const [id, data] of this.subtasks) {
        await this.saveEntity('subtasks', id, data);
      }
      
      // Save checkpoints
      for (const [id, data] of this.checkpoints) {
        await this.saveEntity('checkpoints', id, data);
      }
      
      // Save metadata
      this.metadata.lastSaved = Date.now();
      this.metadata.saveCount++;
      await this.saveEntity('metadata', 'store', this.metadata);
      
      console.log(`Saved all data to storage (${this.metadata.saveCount} saves)`);
    } catch (error) {
      console.error('Failed to save all data:', error);
    }
  }
  
  /**
   * Start auto-save timer
   */
  startAutoSave() {
    if (this.autoSaveTimer) return;
    
    this.autoSaveTimer = setInterval(() => {
      this.saveAll().catch(error => {
        console.error('Auto-save failed:', error);
      });
    }, this.options.autoSaveInterval);
  }
  
  /**
   * Stop auto-save timer
   */
  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
  
  /**
   * Export data for backup
   */
  async export() {
    const data = {
      version: this.metadata.version,
      exportedAt: Date.now(),
      missions: Object.fromEntries(this.missions),
      phases: Object.fromEntries(this.phases),
      tasks: Object.fromEntries(this.tasks),
      subtasks: Object.fromEntries(this.subtasks),
      checkpoints: Object.fromEntries(this.checkpoints),
      metadata: this.metadata
    };
    
    return data;
  }
  
  /**
   * Import data from backup
   */
  async import(data) {
    if (data.version !== this.metadata.version) {
      console.warn(`Version mismatch: ${data.version} vs ${this.metadata.version}`);
    }
    
    // Clear existing data
    this.missions.clear();
    this.phases.clear();
    this.tasks.clear();
    this.subtasks.clear();
    this.checkpoints.clear();
    
    // Import new data
    if (data.missions) {
      for (const [id, mission] of Object.entries(data.missions)) {
        this.missions.set(id, mission);
      }
    }
    
    if (data.phases) {
      for (const [id, phase] of Object.entries(data.phases)) {
        this.phases.set(id, phase);
      }
    }
    
    if (data.tasks) {
      for (const [id, task] of Object.entries(data.tasks)) {
        this.tasks.set(id, task);
      }
    }
    
    if (data.subtasks) {
      for (const [id, subtask] of Object.entries(data.subtasks)) {
        this.subtasks.set(id, subtask);
      }
    }
    
    if (data.checkpoints) {
      for (const [id, checkpoints] of Object.entries(data.checkpoints)) {
        this.checkpoints.set(id, checkpoints);
      }
    }
    
    // Update metadata
    this.metadata = {
      ...this.metadata,
      importedAt: Date.now(),
      importedFrom: data.exportedAt
    };
    
    // Save imported data
    await this.saveAll();
    
    return {
      missionsImported: this.missions.size,
      phasesImported: this.phases.size,
      tasksImported: this.tasks.size,
      subtasksImported: this.subtasks.size,
      checkpointsImported: this.checkpoints.size
    };
  }
  
  /**
   * Get storage statistics
   */
  getStatistics() {
    return {
      missions: this.missions.size,
      phases: this.phases.size,
      tasks: this.tasks.size,
      subtasks: this.subtasks.size,
      checkpoints: this.checkpoints.size,
      totalEntities: this.missions.size + this.phases.size + 
                     this.tasks.size + this.subtasks.size,
      metadata: this.metadata
    };
  }
  
  /**
   * Query entities by criteria
   */
  async query(type, criteria) {
    let collection;
    switch (type) {
      case 'missions':
        collection = this.missions;
        break;
      case 'phases':
        collection = this.phases;
        break;
      case 'tasks':
        collection = this.tasks;
        break;
      case 'subtasks':
        collection = this.subtasks;
        break;
      default:
        throw new Error(`Unknown entity type: ${type}`);
    }
    
    const results = [];
    
    for (const [id, entity] of collection) {
      let matches = true;
      
      for (const [key, value] of Object.entries(criteria)) {
        if (key.includes('.')) {
          // Handle nested properties
          const keys = key.split('.');
          let current = entity;
          for (const k of keys) {
            current = current?.[k];
          }
          if (current !== value) {
            matches = false;
            break;
          }
        } else {
          if (entity[key] !== value) {
            matches = false;
            break;
          }
        }
      }
      
      if (matches) {
        results.push({ id, ...entity });
      }
    }
    
    return results;
  }
  
  /**
   * Clean up old data
   */
  async cleanup(olderThan = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const cutoff = Date.now() - olderThan;
    let cleaned = 0;
    
    // Clean completed missions
    for (const [id, mission] of this.missions) {
      if (mission.status === 'completed' && 
          mission.metadata?.completedAt < cutoff) {
        this.missions.delete(id);
        
        // Also clean related data
        for (const [phaseId, phase] of this.phases) {
          if (phase.missionId === id) {
            this.phases.delete(phaseId);
            
            // Clean tasks
            for (const [taskId, task] of this.tasks) {
              if (task.phaseId === phaseId) {
                this.tasks.delete(taskId);
                
                // Clean subtasks
                for (const [subtaskId, subtask] of this.subtasks) {
                  if (subtask.taskId === taskId) {
                    this.subtasks.delete(subtaskId);
                  }
                }
              }
            }
          }
        }
        
        // Clean checkpoints
        this.checkpoints.delete(id);
        
        cleaned++;
      }
    }
    
    // Save after cleanup
    if (cleaned > 0) {
      await this.saveAll();
    }
    
    return cleaned;
  }
  
  /**
   * Close store and save data
   */
  async close() {
    this.stopAutoSave();
    await this.saveAll();
  }
}