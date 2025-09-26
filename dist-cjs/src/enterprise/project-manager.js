import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
export class ProjectManager extends EventEmitter {
    projects = new Map();
    projectsPath;
    logger;
    config;
    constructor(projectsPath = './projects', logger, config){
        super();
        this.projectsPath = projectsPath;
        this.logger = logger || new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        });
        this.config = config || ConfigManager.getInstance();
    }
    async initialize() {
        try {
            await mkdir(this.projectsPath, {
                recursive: true
            });
            await this.loadProjects();
            this.logger.info('Project Manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Project Manager', {
                error
            });
            throw error;
        }
    }
    async createProject(projectData) {
        const project = {
            id: projectData.id || `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: projectData.name || 'Unnamed Project',
            description: projectData.description || '',
            type: projectData.type || 'custom',
            status: 'planning',
            priority: projectData.priority || 'medium',
            owner: projectData.owner || 'system',
            stakeholders: projectData.stakeholders || [],
            phases: projectData.phases || [],
            budget: projectData.budget || {
                total: 0,
                spent: 0,
                remaining: 0,
                currency: 'USD'
            },
            timeline: {
                plannedStart: projectData.timeline?.plannedStart || new Date(),
                plannedEnd: projectData.timeline?.plannedEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                actualStart: projectData.timeline?.actualStart,
                actualEnd: projectData.timeline?.actualEnd
            },
            tags: projectData.tags || [],
            metadata: projectData.metadata || {},
            createdAt: new Date(),
            updatedAt: new Date(),
            auditLog: [],
            collaboration: {
                teamMembers: [],
                communication: [],
                sharedResources: []
            },
            qualityGates: [],
            complianceRequirements: []
        };
        this.addAuditEntry(project, 'system', 'project_created', 'project', {
            projectId: project.id,
            projectName: project.name
        });
        this.projects.set(project.id, project);
        await this.saveProject(project);
        this.emit('project:created', project);
        this.logger.info(`Project created: ${project.name} (${project.id})`);
        return project;
    }
    async updateProject(projectId, updates) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const updatedProject = {
            ...project,
            ...updates,
            updatedAt: new Date()
        };
        this.addAuditEntry(updatedProject, 'system', 'project_updated', 'project', {
            projectId,
            changes: Object.keys(updates)
        });
        this.projects.set(projectId, updatedProject);
        await this.saveProject(updatedProject);
        this.emit('project:updated', updatedProject);
        this.logger.info(`Project updated: ${project.name} (${projectId})`);
        return updatedProject;
    }
    async deleteProject(projectId, userId = 'system') {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        this.addAuditEntry(project, userId, 'project_deleted', 'project', {
            projectId,
            projectName: project.name
        });
        this.projects.delete(projectId);
        const archivePath = join(this.projectsPath, 'archived');
        await mkdir(archivePath, {
            recursive: true
        });
        await writeFile(join(archivePath, `${projectId}.json`), JSON.stringify(project, null, 2));
        this.emit('project:deleted', {
            projectId,
            project
        });
        this.logger.info(`Project archived: ${project.name} (${projectId})`);
    }
    async getProject(projectId) {
        return this.projects.get(projectId) || null;
    }
    async listProjects(filters) {
        let projects = Array.from(this.projects.values());
        if (filters) {
            if (filters.status) {
                projects = projects.filter((p)=>p.status === filters.status);
            }
            if (filters.type) {
                projects = projects.filter((p)=>p.type === filters.type);
            }
            if (filters.priority) {
                projects = projects.filter((p)=>p.priority === filters.priority);
            }
            if (filters.owner) {
                projects = projects.filter((p)=>p.owner === filters.owner);
            }
            if (filters.tags && filters.tags.length > 0) {
                projects = projects.filter((p)=>filters.tags.some((tag)=>p.tags.includes(tag)));
            }
        }
        return projects.sort((a, b)=>new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    async addPhase(projectId, phase) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const newPhase = {
            id: `phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...phase
        };
        project.phases.push(newPhase);
        project.updatedAt = new Date();
        this.addAuditEntry(project, 'system', 'phase_added', 'phase', {
            projectId,
            phaseId: newPhase.id,
            phaseName: newPhase.name
        });
        await this.saveProject(project);
        this.emit('phase:added', {
            project,
            phase: newPhase
        });
        return newPhase;
    }
    async updatePhase(projectId, phaseId, updates) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const phaseIndex = project.phases.findIndex((p)=>p.id === phaseId);
        if (phaseIndex === -1) {
            throw new Error(`Phase not found: ${phaseId}`);
        }
        const updatedPhase = {
            ...project.phases[phaseIndex],
            ...updates
        };
        project.phases[phaseIndex] = updatedPhase;
        project.updatedAt = new Date();
        this.addAuditEntry(project, 'system', 'phase_updated', 'phase', {
            projectId,
            phaseId,
            changes: Object.keys(updates)
        });
        await this.saveProject(project);
        this.emit('phase:updated', {
            project,
            phase: updatedPhase
        });
        return updatedPhase;
    }
    async addTeamMember(projectId, member) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        project.collaboration.teamMembers.push(member);
        project.updatedAt = new Date();
        this.addAuditEntry(project, 'system', 'team_member_added', 'team', {
            projectId,
            memberId: member.id,
            memberName: member.name
        });
        await this.saveProject(project);
        this.emit('team:member_added', {
            project,
            member
        });
    }
    async removeTeamMember(projectId, memberId) {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const memberIndex = project.collaboration.teamMembers.findIndex((m)=>m.id === memberId);
        if (memberIndex === -1) {
            throw new Error(`Team member not found: ${memberId}`);
        }
        const member = project.collaboration.teamMembers[memberIndex];
        project.collaboration.teamMembers.splice(memberIndex, 1);
        project.updatedAt = new Date();
        this.addAuditEntry(project, 'system', 'team_member_removed', 'team', {
            projectId,
            memberId,
            memberName: member.name
        });
        await this.saveProject(project);
        this.emit('team:member_removed', {
            project,
            memberId
        });
    }
    async getProjectMetrics(projectId) {
        const projects = projectId ? [
            this.projects.get(projectId)
        ].filter(Boolean) : Array.from(this.projects.values());
        const totalProjects = projects.length;
        const activeProjects = projects.filter((p)=>p.status === 'active').length;
        const completedProjects = projects.filter((p)=>p.status === 'completed').length;
        const completedProjectsWithDuration = projects.filter((p)=>p.status === 'completed' && p.timeline.actualStart && p.timeline.actualEnd);
        const averageProjectDuration = completedProjectsWithDuration.length > 0 ? completedProjectsWithDuration.reduce((sum, p)=>{
            const duration = p.timeline.actualEnd.getTime() - p.timeline.actualStart.getTime();
            return sum + duration / (1000 * 60 * 60 * 24);
        }, 0) / completedProjectsWithDuration.length : 0;
        const budgetVariance = projects.reduce((sum, p)=>{
            if (p.budget.total > 0) {
                return sum + (p.budget.spent - p.budget.total) / p.budget.total;
            }
            return sum;
        }, 0) / Math.max(projects.length, 1);
        const resourceUtilization = projects.reduce((sum, p)=>{
            const totalResources = p.phases.reduce((phaseSum, phase)=>phaseSum + phase.resources.length, 0);
            const utilizedResources = p.phases.reduce((phaseSum, phase)=>phaseSum + phase.resources.filter((r)=>r.availability > 0).length, 0);
            return sum + (totalResources > 0 ? utilizedResources / totalResources : 0);
        }, 0) / Math.max(projects.length, 1);
        const qualityScore = projects.reduce((sum, p)=>{
            const phaseQuality = p.phases.reduce((phaseSum, phase)=>{
                const metrics = phase.qualityMetrics;
                return phaseSum + (metrics.testCoverage + metrics.codeQuality + metrics.documentation + metrics.securityScore) / 4;
            }, 0) / Math.max(p.phases.length, 1);
            return sum + phaseQuality;
        }, 0) / Math.max(projects.length, 1);
        return {
            totalProjects,
            activeProjects,
            completedProjects,
            averageProjectDuration,
            budgetVariance,
            resourceUtilization,
            qualityScore,
            riskScore: 0,
            teamProductivity: 0,
            customerSatisfaction: 0
        };
    }
    async generateReport(projectId, type, userId = 'system') {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }
        const report = {
            id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            projectId,
            type,
            title: `${type.toUpperCase()} Report - ${project.name}`,
            summary: '',
            details: {},
            recommendations: [],
            generatedAt: new Date(),
            generatedBy: userId,
            format: 'json',
            recipients: []
        };
        switch(type){
            case 'status':
                report.summary = `Project ${project.name} is currently ${project.status}`;
                report.details = {
                    status: project.status,
                    progress: this.calculateProjectProgress(project),
                    phases: project.phases.map((p)=>({
                            name: p.name,
                            status: p.status,
                            completion: p.completionPercentage
                        })),
                    timeline: project.timeline,
                    nextMilestones: this.getUpcomingMilestones(project)
                };
                break;
            case 'financial':
                report.summary = `Budget utilization: ${(project.budget.spent / project.budget.total * 100).toFixed(1)}%`;
                report.details = {
                    budget: project.budget,
                    costBreakdown: this.calculateCostBreakdown(project),
                    variance: project.budget.spent - project.budget.total,
                    projectedCost: this.projectFinalCost(project)
                };
                break;
            case 'quality':
                const qualityMetrics = this.calculateQualityMetrics(project);
                report.summary = `Overall quality score: ${qualityMetrics.overall.toFixed(1)}%`;
                report.details = {
                    qualityMetrics,
                    qualityGates: project.qualityGates,
                    recommendations: this.generateQualityRecommendations(project)
                };
                break;
            case 'risk':
                const risks = this.getAllRisks(project);
                report.summary = `${risks.filter((r)=>r.status === 'open').length} open risks identified`;
                report.details = {
                    risks,
                    riskMatrix: this.generateRiskMatrix(risks),
                    mitigation: this.generateRiskMitigation(risks)
                };
                break;
            case 'resource':
                report.summary = `${project.collaboration.teamMembers.length} team members, ${this.getTotalResources(project)} resources allocated`;
                report.details = {
                    teamMembers: project.collaboration.teamMembers,
                    resourceAllocation: this.calculateResourceAllocation(project),
                    utilization: this.calculateResourceUtilization(project),
                    capacity: this.calculateCapacity(project)
                };
                break;
            case 'compliance':
                const compliance = this.calculateComplianceStatus(project);
                report.summary = `${compliance.compliant} of ${compliance.total} requirements met`;
                report.details = {
                    requirements: project.complianceRequirements,
                    status: compliance,
                    gaps: this.identifyComplianceGaps(project),
                    recommendations: this.generateComplianceRecommendations(project)
                };
                break;
        }
        this.addAuditEntry(project, userId, 'report_generated', 'report', {
            projectId,
            reportId: report.id,
            reportType: type
        });
        this.emit('report:generated', {
            project,
            report
        });
        return report;
    }
    async loadProjects() {
        try {
            const files = await readdir(this.projectsPath);
            const projectFiles = files.filter((f)=>f.endsWith('.json') && !f.startsWith('.'));
            for (const file of projectFiles){
                try {
                    const content = await readFile(join(this.projectsPath, file), 'utf-8');
                    const project = JSON.parse(content);
                    this.projects.set(project.id, project);
                } catch (error) {
                    this.logger.error(`Failed to load project file: ${file}`, {
                        error
                    });
                }
            }
            this.logger.info(`Loaded ${this.projects.size} projects`);
        } catch (error) {
            this.logger.error('Failed to load projects', {
                error
            });
        }
    }
    async saveProject(project) {
        const filePath = join(this.projectsPath, `${project.id}.json`);
        await writeFile(filePath, JSON.stringify(project, null, 2));
    }
    addAuditEntry(project, userId, action, target, details) {
        const entry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            userId,
            action,
            target,
            details
        };
        project.auditLog.push(entry);
    }
    calculateProjectProgress(project) {
        if (project.phases.length === 0) return 0;
        const totalProgress = project.phases.reduce((sum, phase)=>sum + phase.completionPercentage, 0);
        return totalProgress / project.phases.length;
    }
    getUpcomingMilestones(project) {
        const allMilestones = project.phases.flatMap((p)=>p.milestones);
        const now = new Date();
        return allMilestones.filter((m)=>m.status === 'pending' && m.targetDate > now).sort((a, b)=>a.targetDate.getTime() - b.targetDate.getTime()).slice(0, 5);
    }
    calculateCostBreakdown(project) {
        const breakdown = {};
        for (const phase of project.phases){
            for (const resource of phase.resources){
                const category = resource.type;
                const cost = resource.cost.amount;
                breakdown[category] = (breakdown[category] || 0) + cost;
            }
        }
        return breakdown;
    }
    projectFinalCost(project) {
        const progress = this.calculateProjectProgress(project);
        if (progress === 0) return project.budget.total;
        return project.budget.spent / progress * 100;
    }
    calculateQualityMetrics(project) {
        const allMetrics = project.phases.map((p)=>p.qualityMetrics);
        if (allMetrics.length === 0) {
            return {
                overall: 0,
                testCoverage: 0,
                codeQuality: 0,
                documentation: 0,
                securityScore: 0
            };
        }
        const averages = {
            testCoverage: allMetrics.reduce((sum, m)=>sum + m.testCoverage, 0) / allMetrics.length,
            codeQuality: allMetrics.reduce((sum, m)=>sum + m.codeQuality, 0) / allMetrics.length,
            documentation: allMetrics.reduce((sum, m)=>sum + m.documentation, 0) / allMetrics.length,
            securityScore: allMetrics.reduce((sum, m)=>sum + m.securityScore, 0) / allMetrics.length
        };
        const overall = (averages.testCoverage + averages.codeQuality + averages.documentation + averages.securityScore) / 4;
        return {
            overall,
            ...averages
        };
    }
    generateQualityRecommendations(project) {
        const recommendations = [];
        const metrics = this.calculateQualityMetrics(project);
        if (metrics.testCoverage < 80) {
            recommendations.push('Increase test coverage to at least 80%');
        }
        if (metrics.codeQuality < 70) {
            recommendations.push('Improve code quality through refactoring and code reviews');
        }
        if (metrics.documentation < 60) {
            recommendations.push('Enhance documentation coverage for better maintainability');
        }
        if (metrics.securityScore < 85) {
            recommendations.push('Address security vulnerabilities and implement security best practices');
        }
        return recommendations;
    }
    getAllRisks(project) {
        return project.phases.flatMap((p)=>p.risks);
    }
    generateRiskMatrix(risks) {
        const matrix = {
            low: {
                low: 0,
                medium: 0,
                high: 0
            },
            medium: {
                low: 0,
                medium: 0,
                high: 0
            },
            high: {
                low: 0,
                medium: 0,
                high: 0
            }
        };
        for (const risk of risks){
            if (risk.status === 'open') {
                matrix[risk.probability][risk.impact]++;
            }
        }
        return matrix;
    }
    generateRiskMitigation(risks) {
        const openRisks = risks.filter((r)=>r.status === 'open');
        const highPriorityRisks = openRisks.filter((r)=>r.probability === 'high' && r.impact === 'high' || r.probability === 'high' && r.impact === 'medium' || r.probability === 'medium' && r.impact === 'high');
        return {
            totalRisks: risks.length,
            openRisks: openRisks.length,
            highPriorityRisks: highPriorityRisks.length,
            mitigationActions: highPriorityRisks.map((r)=>({
                    risk: r.description,
                    mitigation: r.mitigation,
                    assignedTo: r.assignedTo
                }))
        };
    }
    getTotalResources(project) {
        return project.phases.reduce((sum, phase)=>sum + phase.resources.length, 0);
    }
    calculateResourceAllocation(project) {
        const allocation = {};
        for (const phase of project.phases){
            for (const resource of phase.resources){
                allocation[resource.type] = (allocation[resource.type] || 0) + 1;
            }
        }
        return allocation;
    }
    calculateResourceUtilization(project) {
        const utilization = {};
        for (const phase of project.phases){
            for (const resource of phase.resources){
                utilization[resource.type] = (utilization[resource.type] || 0) + resource.availability;
            }
        }
        return utilization;
    }
    calculateCapacity(project) {
        const teamSize = project.collaboration.teamMembers.length;
        const totalAvailability = project.collaboration.teamMembers.reduce((sum, member)=>sum + member.availability, 0);
        return {
            teamSize,
            totalAvailability,
            averageAvailability: teamSize > 0 ? totalAvailability / teamSize : 0
        };
    }
    calculateComplianceStatus(project) {
        const requirements = project.complianceRequirements;
        const total = requirements.length;
        const compliant = requirements.filter((r)=>r.status === 'compliant').length;
        const inProgress = requirements.filter((r)=>r.status === 'in-progress').length;
        const nonCompliant = requirements.filter((r)=>r.status === 'non-compliant').length;
        return {
            total,
            compliant,
            inProgress,
            nonCompliant,
            compliancePercentage: total > 0 ? compliant / total * 100 : 0
        };
    }
    identifyComplianceGaps(project) {
        return project.complianceRequirements.filter((r)=>r.status === 'not-started' || r.status === 'non-compliant');
    }
    generateComplianceRecommendations(project) {
        const gaps = this.identifyComplianceGaps(project);
        const recommendations = [];
        for (const gap of gaps){
            recommendations.push(`Address ${gap.framework} requirement: ${gap.name} (Due: ${gap.dueDate.toLocaleDateString()})`);
        }
        return recommendations;
    }
}

//# sourceMappingURL=project-manager.js.map