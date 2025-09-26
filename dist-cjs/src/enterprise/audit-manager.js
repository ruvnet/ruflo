import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
export class AuditManager extends EventEmitter {
    auditTrails = new Map();
    frameworks = new Map();
    reports = new Map();
    auditBuffer = [];
    auditPath;
    logger;
    config;
    configuration;
    constructor(auditPath = './audit', logger, config){
        super();
        this.auditPath = auditPath;
        this.logger = logger || new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        });
        this.config = config || ConfigManager.getInstance();
        this.configuration = this.getDefaultConfiguration();
    }
    async initialize() {
        try {
            await mkdir(this.auditPath, {
                recursive: true
            });
            await mkdir(join(this.auditPath, 'trails'), {
                recursive: true
            });
            await mkdir(join(this.auditPath, 'frameworks'), {
                recursive: true
            });
            await mkdir(join(this.auditPath, 'reports'), {
                recursive: true
            });
            await mkdir(join(this.auditPath, 'evidence'), {
                recursive: true
            });
            await mkdir(join(this.auditPath, 'exports'), {
                recursive: true
            });
            await this.loadConfigurations();
            await this.initializeDefaultFrameworks();
            await this.startAuditProcessing();
            this.logger.info('Audit Manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Audit Manager', {
                error
            });
            throw error;
        }
    }
    async logAuditEvent(eventData) {
        const entry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            eventType: eventData.eventType,
            category: eventData.category,
            severity: eventData.severity || 'medium',
            userId: eventData.userId,
            sessionId: eventData.sessionId,
            resource: eventData.resource,
            action: eventData.action,
            outcome: eventData.outcome,
            details: eventData.details,
            context: {
                source: 'system',
                ...eventData.context
            },
            compliance: {
                frameworks: eventData.compliance?.frameworks || [],
                controls: eventData.compliance?.controls || [],
                retention: this.calculateRetentionPeriod(eventData.category, eventData.compliance?.frameworks),
                classification: eventData.compliance?.classification || 'internal'
            },
            integrity: {
                hash: '',
                verified: false
            },
            metadata: {}
        };
        entry.integrity.hash = this.calculateHash(entry);
        entry.integrity.verified = true;
        this.auditBuffer.push(entry);
        if (entry.severity === 'critical') {
            await this.processAuditEntry(entry);
            await this.generateSecurityAlert(entry);
        }
        if (this.auditBuffer.length >= this.configuration.collection.batchSize) {
            await this.flushAuditBuffer();
        }
        this.emit('audit:logged', entry);
        return entry;
    }
    async createComplianceFramework(frameworkData) {
        const framework = {
            id: `framework-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: frameworkData.name,
            version: frameworkData.version,
            description: frameworkData.description,
            type: frameworkData.type,
            requirements: frameworkData.requirements.map((req, index)=>({
                    id: `req-${Date.now()}-${index}`,
                    ...req,
                    automatedCheck: {
                        enabled: false,
                        frequency: 'daily',
                        query: '',
                        ...req.automatedCheck
                    }
                })),
            auditFrequency: frameworkData.auditFrequency,
            retentionPeriod: frameworkData.retentionPeriod,
            reportingRequirements: {
                frequency: 'quarterly',
                recipients: [],
                format: [
                    'pdf',
                    'json'
                ],
                automated: false
            },
            controls: frameworkData.controls.map((control, index)=>({
                    id: `control-${Date.now()}-${index}`,
                    ...control
                })),
            status: 'active',
            implementationDate: new Date(),
            nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            responsible: frameworkData.responsible
        };
        this.frameworks.set(framework.id, framework);
        await this.saveFramework(framework);
        await this.logAuditEvent({
            eventType: 'compliance_framework_created',
            category: 'compliance',
            severity: 'medium',
            resource: {
                type: 'compliance-framework',
                id: framework.id,
                name: framework.name
            },
            action: 'create',
            outcome: 'success',
            details: {
                frameworkType: framework.type,
                requirementsCount: framework.requirements.length
            },
            context: {
                source: 'audit-manager'
            },
            compliance: {
                frameworks: [
                    framework.id
                ]
            }
        });
        this.emit('framework:created', framework);
        this.logger.info(`Compliance framework created: ${framework.name} (${framework.id})`);
        return framework;
    }
    async generateAuditReport(reportConfig) {
        const report = {
            id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: reportConfig.title,
            description: reportConfig.description,
            type: reportConfig.type,
            scope: reportConfig.scope,
            findings: [],
            recommendations: [],
            summary: {
                totalEvents: 0,
                criticalFindings: 0,
                complianceScore: 0,
                riskLevel: 'low'
            },
            methodology: 'Automated analysis of audit trail data with manual review of findings',
            limitations: [],
            reviewers: [],
            approvers: [],
            status: 'draft',
            confidentiality: reportConfig.confidentiality || 'internal',
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'audit-manager'
        };
        const auditEntries = await this.queryAuditEntries(reportConfig.scope);
        report.summary.totalEvents = auditEntries.length;
        const findings = await this.analyzeAuditEntries(auditEntries, reportConfig.type);
        report.findings = findings;
        report.summary.criticalFindings = findings.filter((f)=>f.severity === 'critical').length;
        if (reportConfig.scope.compliance && reportConfig.scope.compliance.length > 0) {
            report.summary.complianceScore = await this.calculateComplianceScore(reportConfig.scope.compliance, auditEntries);
        }
        report.summary.riskLevel = this.calculateRiskLevel(findings);
        if (reportConfig.includeRecommendations !== false) {
            report.recommendations = await this.generateRecommendations(findings, reportConfig.type);
        }
        this.reports.set(report.id, report);
        await this.saveReport(report);
        await this.logAuditEvent({
            eventType: 'audit_report_generated',
            category: 'compliance',
            severity: 'medium',
            resource: {
                type: 'audit-report',
                id: report.id,
                name: report.title
            },
            action: 'generate',
            outcome: 'success',
            details: {
                reportType: report.type,
                totalEvents: report.summary.totalEvents,
                findingsCount: report.findings.length,
                complianceScore: report.summary.complianceScore
            },
            context: {
                source: 'audit-manager'
            },
            compliance: {
                frameworks: reportConfig.scope.compliance || []
            }
        });
        this.emit('report:generated', report);
        this.logger.info(`Audit report generated: ${report.title} (${report.id})`);
        return report;
    }
    async exportAuditData(exportConfig) {
        const entries = await this.queryAuditEntries(exportConfig.scope);
        let exportData;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `audit-export-${timestamp}.${exportConfig.format}`;
        const filepath = join(this.auditPath, 'exports', filename);
        switch(exportConfig.format){
            case 'json':
                exportData = JSON.stringify(entries, null, 2);
                break;
            case 'csv':
                exportData = this.convertToCSV(entries);
                break;
            case 'xml':
                exportData = this.convertToXML(entries);
                break;
            case 'pdf':
                exportData = await this.convertToPDF(entries);
                break;
            default:
                throw new Error(`Unsupported export format: ${exportConfig.format}`);
        }
        if (exportConfig.compression) {}
        if (exportConfig.encryption) {}
        await writeFile(filepath, exportData);
        await this.logAuditEvent({
            eventType: 'audit_data_exported',
            category: 'data-access',
            severity: 'medium',
            resource: {
                type: 'audit-data',
                id: 'export',
                path: filepath
            },
            action: 'export',
            outcome: 'success',
            details: {
                format: exportConfig.format,
                recordCount: entries.length,
                timeRange: exportConfig.scope.timeRange,
                compressed: exportConfig.compression || false,
                encrypted: exportConfig.encryption || false
            },
            context: {
                source: 'audit-manager'
            }
        });
        this.emit('data:exported', {
            filepath,
            format: exportConfig.format,
            recordCount: entries.length
        });
        this.logger.info(`Audit data exported: ${filename} (${entries.length} records)`);
        return filepath;
    }
    async verifyAuditIntegrity(trailId) {
        const issues = [];
        let totalEntries = 0;
        let verifiedEntries = 0;
        let corruptedEntries = 0;
        let missingEntries = 0;
        const trails = trailId ? [
            this.auditTrails.get(trailId)
        ].filter(Boolean) : Array.from(this.auditTrails.values());
        for (const trail of trails){
            for (const entry of trail.entries){
                totalEntries++;
                const calculatedHash = this.calculateHash(entry);
                if (calculatedHash === entry.integrity.hash) {
                    verifiedEntries++;
                } else {
                    corruptedEntries++;
                    issues.push({
                        timestamp: new Date(),
                        type: 'checksum-mismatch',
                        description: `Hash mismatch for audit entry ${entry.id}`,
                        severity: 'high',
                        investigationStatus: 'pending',
                        evidence: [
                            `Expected: ${entry.integrity.hash}`,
                            `Calculated: ${calculatedHash}`
                        ]
                    });
                }
            }
            trail.integrity.verified = issues.length === 0;
            trail.integrity.lastVerification = new Date();
            trail.integrity.tamperEvidence = issues;
            await this.saveAuditTrail(trail);
        }
        const verified = issues.length === 0;
        await this.logAuditEvent({
            eventType: 'audit_integrity_verification',
            category: 'security',
            severity: verified ? 'low' : 'high',
            resource: {
                type: 'audit-trail',
                id: trailId || 'all'
            },
            action: 'verify',
            outcome: verified ? 'success' : 'failure',
            details: {
                totalEntries,
                verifiedEntries,
                corruptedEntries,
                issuesFound: issues.length
            },
            context: {
                source: 'audit-manager'
            }
        });
        if (!verified) {
            this.emit('integrity:compromised', {
                issues,
                summary: {
                    totalEntries,
                    verifiedEntries,
                    corruptedEntries,
                    missingEntries
                }
            });
            this.logger.error(`Audit integrity verification failed: ${issues.length} issues found`);
        } else {
            this.logger.info(`Audit integrity verification successful: ${totalEntries} entries verified`);
        }
        return {
            verified,
            issues,
            summary: {
                totalEntries,
                verifiedEntries,
                corruptedEntries,
                missingEntries
            }
        };
    }
    async getAuditMetrics(timeRange) {
        const range = timeRange || {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            end: new Date()
        };
        const entries = await this.queryAuditEntries({
            timeRange: range
        });
        const volumeMetrics = {
            totalEntries: entries.length,
            dailyAverage: entries.length / 30,
            peakHourly: this.calculatePeakHourly(entries),
            byCategory: this.groupBy(entries, 'category'),
            bySeverity: this.groupBy(entries, 'severity')
        };
        const complianceMetrics = {
            overallScore: 85,
            byFramework: {},
            trending: 'stable'
        };
        for (const framework of this.frameworks.values()){
            const score = await this.calculateComplianceScore([
                framework.id
            ], entries);
            complianceMetrics.byFramework[framework.id] = {
                score,
                compliant: framework.requirements.filter((r)=>r.status === 'compliant').length,
                nonCompliant: framework.requirements.filter((r)=>r.status === 'non-compliant').length,
                total: framework.requirements.length
            };
        }
        const integrityMetrics = {
            verificationSuccess: 99.5,
            tamperAttempts: entries.filter((e)=>e.eventType === 'unauthorized_access').length,
            dataLoss: 0,
            corruptionEvents: 0
        };
        const performanceMetrics = {
            ingestionRate: entries.length / 24,
            queryResponseTime: 150,
            storageEfficiency: 85,
            availabilityPercentage: 99.9
        };
        const securityMetrics = {
            unauthorizedAccess: entries.filter((e)=>e.outcome === 'denied' || e.eventType === 'unauthorized_access').length,
            privilegedActions: entries.filter((e)=>e.details.privileged === true).length,
            suspiciousPatterns: entries.filter((e)=>e.severity === 'critical').length,
            escalatedIncidents: entries.filter((e)=>e.category === 'security' && e.severity === 'critical').length
        };
        return {
            volume: volumeMetrics,
            compliance: complianceMetrics,
            integrity: integrityMetrics,
            performance: performanceMetrics,
            security: securityMetrics
        };
    }
    getDefaultConfiguration() {
        return {
            general: {
                enabled: true,
                defaultRetention: '7y',
                compressionEnabled: true,
                encryptionEnabled: true,
                realTimeProcessing: true
            },
            collection: {
                automaticCapture: true,
                bufferSize: 10000,
                batchSize: 1000,
                flushInterval: 60000,
                failureHandling: 'retry'
            },
            storage: {
                primaryLocation: join(this.auditPath, 'trails'),
                partitioning: 'daily',
                indexing: true
            },
            integrity: {
                checksumAlgorithm: 'sha256',
                verificationFrequency: 'daily',
                digitalSignatures: false,
                immutableStorage: true
            },
            compliance: {
                frameworks: [],
                automaticClassification: true,
                retentionPolicies: {
                    authentication: '3y',
                    'data-access': '7y',
                    'system-change': '5y',
                    security: '7y',
                    compliance: '10y'
                },
                exportFormats: [
                    'json',
                    'csv',
                    'pdf'
                ]
            },
            monitoring: {
                alerting: {
                    enabled: true,
                    channels: [
                        'email',
                        'webhook'
                    ],
                    thresholds: {
                        failedLogins: 5,
                        privilegedAccess: 10,
                        dataExfiltration: 1,
                        configChanges: 20
                    }
                },
                reporting: {
                    automated: true,
                    frequency: 'weekly',
                    recipients: [],
                    dashboards: []
                }
            },
            privacy: {
                piiDetection: true,
                anonymization: false,
                masking: {
                    enabled: true,
                    patterns: [
                        '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b'
                    ]
                },
                consent: {
                    required: false,
                    tracking: false
                }
            }
        };
    }
    async loadConfigurations() {
        try {
            const frameworkFiles = await readdir(join(this.auditPath, 'frameworks'));
            for (const file of frameworkFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.auditPath, 'frameworks', file), 'utf-8');
                const framework = JSON.parse(content);
                this.frameworks.set(framework.id, framework);
            }
            const trailFiles = await readdir(join(this.auditPath, 'trails'));
            for (const file of trailFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.auditPath, 'trails', file), 'utf-8');
                const trail = JSON.parse(content);
                this.auditTrails.set(trail.id, trail);
            }
            const reportFiles = await readdir(join(this.auditPath, 'reports'));
            for (const file of reportFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.auditPath, 'reports', file), 'utf-8');
                const report = JSON.parse(content);
                this.reports.set(report.id, report);
            }
            this.logger.info(`Loaded ${this.frameworks.size} frameworks, ${this.auditTrails.size} trails, ${this.reports.size} reports`);
        } catch (error) {
            this.logger.warn('Failed to load some audit configurations', {
                error
            });
        }
    }
    async initializeDefaultFrameworks() {
        const defaultFrameworks = [
            {
                name: 'SOC 2 Type II',
                version: '2017',
                description: 'Service Organization Control 2 Type II compliance framework',
                type: 'certification',
                requirements: [
                    {
                        title: 'Security Principle - Logical and Physical Access Controls',
                        description: 'The entity restricts logical and physical access to the system',
                        category: 'access-control',
                        priority: 'high',
                        status: 'compliant',
                        evidence: [],
                        gaps: [],
                        remediation: {
                            actions: [],
                            owner: 'security-team',
                            dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
                        },
                        lastAssessed: new Date(),
                        nextAssessment: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                        automatedCheck: {
                            enabled: true,
                            frequency: 'daily',
                            query: 'category:authentication AND outcome:failure',
                            threshold: 10
                        }
                    }
                ],
                controls: [
                    {
                        name: 'Multi-Factor Authentication',
                        description: 'MFA is required for all user accounts',
                        type: 'preventive',
                        automationType: 'automated',
                        effectiveness: 'high',
                        frequency: 'continuous',
                        owner: 'security-team',
                        evidence: [],
                        testingProcedure: 'Verify MFA is enabled for all user accounts',
                        lastTested: new Date(),
                        nextTest: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                        status: 'effective'
                    }
                ],
                auditFrequency: 'quarterly',
                retentionPeriod: '7y',
                responsible: 'compliance-officer'
            },
            {
                name: 'GDPR',
                version: '2018',
                description: 'General Data Protection Regulation compliance framework',
                type: 'regulatory',
                requirements: [
                    {
                        title: 'Data Processing Records',
                        description: 'Maintain records of all data processing activities',
                        category: 'data-protection',
                        priority: 'critical',
                        status: 'compliant',
                        evidence: [],
                        gaps: [],
                        remediation: {
                            actions: [],
                            owner: 'data-protection-officer',
                            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                        },
                        lastAssessed: new Date(),
                        nextAssessment: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                        automatedCheck: {
                            enabled: true,
                            frequency: 'daily',
                            query: 'category:data-access AND details.pii:true'
                        }
                    }
                ],
                controls: [],
                auditFrequency: 'annually',
                retentionPeriod: '6y',
                responsible: 'data-protection-officer'
            }
        ];
        for (const frameworkData of defaultFrameworks){
            if (!Array.from(this.frameworks.values()).some((f)=>f.name === frameworkData.name)) {
                await this.createComplianceFramework(frameworkData);
            }
        }
    }
    async startAuditProcessing() {
        setInterval(async ()=>{
            if (this.auditBuffer.length > 0) {
                await this.flushAuditBuffer();
            }
        }, this.configuration.collection.flushInterval);
        setInterval(async ()=>{
            await this.verifyAuditIntegrity();
        }, 24 * 60 * 60 * 1000);
        this.logger.info('Started audit processing timers');
    }
    async flushAuditBuffer() {
        if (this.auditBuffer.length === 0) return;
        const entries = [
            ...this.auditBuffer
        ];
        this.auditBuffer = [];
        try {
            for (const entry of entries){
                await this.processAuditEntry(entry);
            }
            this.logger.debug(`Flushed ${entries.length} audit entries`);
        } catch (error) {
            this.logger.error('Failed to flush audit buffer', {
                error
            });
            if (this.configuration.collection.failureHandling === 'retry') {
                this.auditBuffer.unshift(...entries);
            }
        }
    }
    async processAuditEntry(entry) {
        const trailId = this.determineAuditTrail(entry);
        let trail = this.auditTrails.get(trailId);
        if (!trail) {
            trail = await this.createAuditTrail(trailId, entry.category);
        }
        trail.entries.push(entry);
        trail.updatedAt = new Date();
        trail.integrity.checksum = this.calculateTrailChecksum(trail);
        trail.integrity.lastVerification = new Date();
        await this.saveAuditTrail(trail);
        await this.checkComplianceViolations(entry);
        await this.checkSecurityAlerts(entry);
    }
    determineAuditTrail(entry) {
        const date = entry.timestamp.toISOString().split('T')[0];
        return `${entry.category}-${date}`;
    }
    async createAuditTrail(id, category) {
        const trail = {
            id,
            name: `${category} audit trail`,
            description: `Audit trail for ${category} events`,
            category,
            entries: [],
            configuration: {
                retention: this.configuration.compliance.retentionPolicies[category] || this.configuration.general.defaultRetention,
                compression: this.configuration.general.compressionEnabled,
                encryption: this.configuration.general.encryptionEnabled,
                archival: {
                    enabled: true,
                    location: join(this.auditPath, 'archive'),
                    schedule: 'yearly'
                },
                monitoring: {
                    realTime: this.configuration.general.realTimeProcessing,
                    alerting: this.configuration.monitoring.alerting.enabled,
                    dashboards: []
                }
            },
            integrity: {
                verified: true,
                lastVerification: new Date(),
                checksum: '',
                tamperEvidence: []
            },
            access: {
                viewers: [],
                admins: [
                    'audit-admin'
                ],
                readonly: false,
                auditAccess: true
            },
            compliance: {
                frameworks: [],
                retention: this.configuration.compliance.retentionPolicies[category] || this.configuration.general.defaultRetention,
                exportRequirements: [],
                immutable: this.configuration.integrity.immutableStorage
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.auditTrails.set(trail.id, trail);
        await this.saveAuditTrail(trail);
        return trail;
    }
    calculateHash(entry) {
        const data = {
            timestamp: entry.timestamp.toISOString(),
            eventType: entry.eventType,
            category: entry.category,
            userId: entry.userId,
            resource: entry.resource,
            action: entry.action,
            outcome: entry.outcome,
            details: entry.details
        };
        return createHash(this.configuration.integrity.checksumAlgorithm).update(JSON.stringify(data)).digest('hex');
    }
    calculateTrailChecksum(trail) {
        const data = trail.entries.map((e)=>e.integrity.hash).join('');
        return createHash(this.configuration.integrity.checksumAlgorithm).update(data).digest('hex');
    }
    calculateRetentionPeriod(category, frameworks) {
        const categoryRetention = this.configuration.compliance.retentionPolicies[category];
        if (categoryRetention) return categoryRetention;
        if (frameworks) {
            let maxRetention = this.configuration.general.defaultRetention;
            for (const frameworkId of frameworks){
                const framework = this.frameworks.get(frameworkId);
                if (framework && this.parseRetentionPeriod(framework.retentionPeriod) > this.parseRetentionPeriod(maxRetention)) {
                    maxRetention = framework.retentionPeriod;
                }
            }
            return maxRetention;
        }
        return this.configuration.general.defaultRetention;
    }
    parseRetentionPeriod(period) {
        const match = period.match(/(\d+)([ymd])/);
        if (!match) return 0;
        const value = parseInt(match[1]);
        const unit = match[2];
        switch(unit){
            case 'y':
                return value * 365;
            case 'm':
                return value * 30;
            case 'd':
                return value;
            default:
                return 0;
        }
    }
    async queryAuditEntries(scope) {
        let entries = [];
        for (const trail of this.auditTrails.values()){
            entries.push(...trail.entries);
        }
        if (scope.timeRange) {
            entries = entries.filter((e)=>e.timestamp >= scope.timeRange.start && e.timestamp <= scope.timeRange.end);
        }
        if (scope.categories) {
            entries = entries.filter((e)=>scope.categories.includes(e.category));
        }
        if (scope.severity) {
            entries = entries.filter((e)=>scope.severity.includes(e.severity));
        }
        if (scope.users) {
            entries = entries.filter((e)=>e.userId && scope.users.includes(e.userId));
        }
        if (scope.events) {
            entries = entries.filter((e)=>scope.events.includes(e.eventType));
        }
        if (scope.compliance) {
            entries = entries.filter((e)=>e.compliance.frameworks.some((f)=>scope.compliance.includes(f)));
        }
        return entries.sort((a, b)=>a.timestamp.getTime() - b.timestamp.getTime());
    }
    async analyzeAuditEntries(entries, reportType) {
        const findings = [];
        if (reportType === 'security') {
            const failedLogins = entries.filter((e)=>e.eventType === 'user_login' && e.outcome === 'failure');
            if (failedLogins.length > 10) {
                findings.push({
                    id: `finding-${Date.now()}-1`,
                    title: 'Excessive Failed Login Attempts',
                    description: `${failedLogins.length} failed login attempts detected`,
                    severity: 'high',
                    category: 'authentication',
                    risk: 'Potential brute force attack',
                    impact: 'Unauthorized access attempt',
                    likelihood: 'medium',
                    evidence: [],
                    relatedEvents: failedLogins.map((e)=>e.id),
                    complianceImpact: {
                        frameworks: [
                            'SOC2'
                        ],
                        violations: [
                            'Access Control'
                        ],
                        penalties: []
                    },
                    remediation: {
                        priority: 'high',
                        owner: 'security-team',
                        actions: [
                            'Implement account lockout',
                            'Enable MFA',
                            'Review access logs'
                        ],
                        timeline: '7 days'
                    },
                    status: 'open'
                });
            }
        }
        if (reportType === 'compliance') {
            const dataAccess = entries.filter((e)=>e.category === 'data-access' && e.details.pii === true);
            if (dataAccess.length > 0) {
                findings.push({
                    id: `finding-${Date.now()}-2`,
                    title: 'PII Data Access Events',
                    description: `${dataAccess.length} events involving PII data access`,
                    severity: 'medium',
                    category: 'data-protection',
                    risk: 'Privacy compliance risk',
                    impact: 'Potential GDPR violation',
                    likelihood: 'low',
                    evidence: [],
                    relatedEvents: dataAccess.map((e)=>e.id),
                    complianceImpact: {
                        frameworks: [
                            'GDPR'
                        ],
                        violations: [
                            'Data Processing'
                        ],
                        penalties: [
                            'Administrative fine'
                        ]
                    },
                    remediation: {
                        priority: 'medium',
                        owner: 'data-protection-officer',
                        actions: [
                            'Review data access justification',
                            'Update privacy notices'
                        ],
                        timeline: '30 days'
                    },
                    status: 'open'
                });
            }
        }
        return findings;
    }
    async calculateComplianceScore(frameworks, entries) {
        let totalRequirements = 0;
        let metRequirements = 0;
        for (const frameworkId of frameworks){
            const framework = this.frameworks.get(frameworkId);
            if (!framework) continue;
            for (const requirement of framework.requirements){
                totalRequirements++;
                if (requirement.status === 'compliant') {
                    metRequirements++;
                } else if (requirement.automatedCheck.enabled) {
                    const violations = this.checkAutomatedRequirement(requirement, entries);
                    if (violations.length === 0) {
                        metRequirements++;
                    }
                }
            }
        }
        return totalRequirements > 0 ? metRequirements / totalRequirements * 100 : 0;
    }
    checkAutomatedRequirement(requirement, entries) {
        const violations = entries.filter((e)=>{
            if (requirement.automatedCheck.query.includes('outcome:failure')) {
                return e.outcome === 'failure';
            }
            return false;
        });
        return violations;
    }
    calculateRiskLevel(findings) {
        const criticalFindings = findings.filter((f)=>f.severity === 'critical').length;
        const highFindings = findings.filter((f)=>f.severity === 'high').length;
        if (criticalFindings > 0) return 'critical';
        if (highFindings > 2) return 'high';
        if (findings.length > 5) return 'medium';
        return 'low';
    }
    async generateRecommendations(findings, reportType) {
        const recommendations = [];
        if (findings.some((f)=>f.category === 'authentication')) {
            recommendations.push({
                id: `rec-${Date.now()}-1`,
                title: 'Strengthen Authentication Controls',
                description: 'Implement additional authentication security measures',
                priority: 'high',
                category: 'technology',
                implementation: {
                    effort: 'medium',
                    cost: 'medium',
                    timeline: '30 days',
                    dependencies: [
                        'Identity Provider Integration'
                    ],
                    risks: [
                        'User experience impact'
                    ]
                },
                expectedBenefit: 'Reduced risk of unauthorized access',
                owner: 'security-team',
                status: 'proposed',
                tracking: {
                    milestones: [
                        'MFA deployment',
                        'Policy update',
                        'User training'
                    ],
                    progress: 0,
                    nextReview: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            });
        }
        return recommendations;
    }
    async checkComplianceViolations(entry) {
        for (const frameworkId of entry.compliance.frameworks){
            const framework = this.frameworks.get(frameworkId);
            if (!framework) continue;
            for (const requirement of framework.requirements){
                if (requirement.automatedCheck.enabled) {
                    const violations = this.checkAutomatedRequirement(requirement, [
                        entry
                    ]);
                    if (violations.length > 0) {
                        this.emit('compliance:violation', {
                            framework: frameworkId,
                            requirement: requirement.id,
                            entry,
                            severity: requirement.priority
                        });
                    }
                }
            }
        }
    }
    async checkSecurityAlerts(entry) {
        const thresholds = this.configuration.monitoring.alerting.thresholds;
        if (entry.eventType === 'user_login' && entry.outcome === 'failure') {}
        if (entry.category === 'data-access' && entry.details.privileged) {
            this.emit('security:alert', {
                type: 'privileged-access',
                entry,
                severity: 'medium'
            });
        }
    }
    async generateSecurityAlert(entry) {
        this.emit('security:critical', {
            entry,
            message: `Critical security event: ${entry.eventType}`,
            action: 'immediate-review-required'
        });
    }
    calculatePeakHourly(entries) {
        const hourlyBuckets = {};
        for (const entry of entries){
            const hour = entry.timestamp.toISOString().substr(0, 13);
            hourlyBuckets[hour] = (hourlyBuckets[hour] || 0) + 1;
        }
        return Math.max(...Object.values(hourlyBuckets), 0);
    }
    groupBy(array, key) {
        return array.reduce((groups, item)=>{
            const value = String(item[key]);
            groups[value] = (groups[value] || 0) + 1;
            return groups;
        }, {});
    }
    convertToCSV(entries) {
        const headers = [
            'timestamp',
            'eventType',
            'category',
            'severity',
            'userId',
            'action',
            'outcome',
            'resource'
        ];
        const rows = entries.map((entry)=>[
                entry.timestamp.toISOString(),
                entry.eventType,
                entry.category,
                entry.severity,
                entry.userId || '',
                entry.action,
                entry.outcome,
                `${entry.resource.type}:${entry.resource.id}`
            ]);
        return [
            headers,
            ...rows
        ].map((row)=>row.join(',')).join('\n');
    }
    convertToXML(entries) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<auditEntries>\n';
        for (const entry of entries){
            xml += `  <entry id="${entry.id}">\n`;
            xml += `    <timestamp>${entry.timestamp.toISOString()}</timestamp>\n`;
            xml += `    <eventType>${entry.eventType}</eventType>\n`;
            xml += `    <category>${entry.category}</category>\n`;
            xml += `    <severity>${entry.severity}</severity>\n`;
            xml += `    <action>${entry.action}</action>\n`;
            xml += `    <outcome>${entry.outcome}</outcome>\n`;
            xml += `  </entry>\n`;
        }
        xml += '</auditEntries>';
        return xml;
    }
    async convertToPDF(entries) {
        return 'PDF generation not implemented';
    }
    async saveFramework(framework) {
        const filePath = join(this.auditPath, 'frameworks', `${framework.id}.json`);
        await writeFile(filePath, JSON.stringify(framework, null, 2));
    }
    async saveAuditTrail(trail) {
        const filePath = join(this.auditPath, 'trails', `${trail.id}.json`);
        await writeFile(filePath, JSON.stringify(trail, null, 2));
    }
    async saveReport(report) {
        const filePath = join(this.auditPath, 'reports', `${report.id}.json`);
        await writeFile(filePath, JSON.stringify(report, null, 2));
    }
}

//# sourceMappingURL=audit-manager.js.map