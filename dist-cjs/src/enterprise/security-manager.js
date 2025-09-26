import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
export class SecurityManager extends EventEmitter {
    scans = new Map();
    policies = new Map();
    incidents = new Map();
    vulnerabilityDatabases = new Map();
    securityPath;
    logger;
    config;
    constructor(securityPath = './security', logger, config){
        super();
        this.securityPath = securityPath;
        this.logger = logger || new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        });
        this.config = config || ConfigManager.getInstance();
    }
    async initialize() {
        try {
            await mkdir(this.securityPath, {
                recursive: true
            });
            await mkdir(join(this.securityPath, 'scans'), {
                recursive: true
            });
            await mkdir(join(this.securityPath, 'policies'), {
                recursive: true
            });
            await mkdir(join(this.securityPath, 'incidents'), {
                recursive: true
            });
            await mkdir(join(this.securityPath, 'reports'), {
                recursive: true
            });
            await mkdir(join(this.securityPath, 'databases'), {
                recursive: true
            });
            await this.loadConfigurations();
            await this.initializeDefaultPolicies();
            await this.initializeVulnerabilityDatabases();
            this.logger.info('Security Manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Security Manager', {
                error
            });
            throw error;
        }
    }
    async createSecurityScan(scanData) {
        const scan = {
            id: `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: scanData.name,
            type: scanData.type,
            status: 'pending',
            projectId: scanData.projectId,
            target: scanData.target,
            configuration: {
                scanner: this.getDefaultScanner(scanData.type),
                rules: [],
                excludes: [],
                severity: [
                    'critical',
                    'high',
                    'medium',
                    'low'
                ],
                formats: [
                    'json',
                    'html'
                ],
                outputPath: join(this.securityPath, 'reports'),
                ...scanData.configuration
            },
            results: [],
            metrics: {
                totalFindings: 0,
                criticalFindings: 0,
                highFindings: 0,
                mediumFindings: 0,
                lowFindings: 0,
                falsePositives: 0,
                suppressed: 0,
                scanDuration: 0,
                filesScanned: 0,
                linesScanned: 0
            },
            compliance: {
                frameworks: [],
                requirements: [],
                overallScore: 0,
                passedChecks: 0,
                failedChecks: 0
            },
            remediation: {
                autoFixAvailable: [],
                manualReview: [],
                recommendations: []
            },
            schedule: scanData.schedule,
            notifications: {
                channels: [],
                thresholds: {
                    critical: 1,
                    high: 5,
                    medium: 10
                }
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'system',
            auditLog: []
        };
        this.addAuditEntry(scan, 'system', 'scan_created', 'scan', {
            scanId: scan.id,
            scanName: scan.name,
            scanType: scan.type
        });
        this.scans.set(scan.id, scan);
        await this.saveScan(scan);
        this.emit('scan:created', scan);
        this.logger.info(`Security scan created: ${scan.name} (${scan.id})`);
        return scan;
    }
    async executeScan(scanId) {
        const scan = this.scans.get(scanId);
        if (!scan) {
            throw new Error(`Scan not found: ${scanId}`);
        }
        if (scan.status !== 'pending') {
            throw new Error(`Scan ${scanId} is not in pending status`);
        }
        scan.status = 'running';
        scan.updatedAt = new Date();
        this.addAuditEntry(scan, 'system', 'scan_started', 'scan', {
            scanId,
            target: scan.target
        });
        await this.saveScan(scan);
        this.emit('scan:started', scan);
        try {
            const startTime = Date.now();
            const findings = await this.executeScanEngine(scan);
            const endTime = Date.now();
            scan.metrics.scanDuration = endTime - startTime;
            scan.results = findings;
            scan.status = 'completed';
            this.calculateScanMetrics(scan);
            await this.runComplianceChecks(scan);
            await this.generateRemediationRecommendations(scan);
            await this.checkNotificationThresholds(scan);
            scan.updatedAt = new Date();
            this.addAuditEntry(scan, 'system', 'scan_completed', 'scan', {
                scanId,
                duration: scan.metrics.scanDuration,
                findingsCount: scan.results.length
            });
            await this.saveScan(scan);
            this.emit('scan:completed', scan);
            this.logger.info(`Security scan completed: ${scan.name} (${scan.id}) - ${scan.results.length} findings`);
        } catch (error) {
            scan.status = 'failed';
            scan.updatedAt = new Date();
            this.addAuditEntry(scan, 'system', 'scan_failed', 'scan', {
                scanId,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.saveScan(scan);
            this.emit('scan:failed', {
                scan,
                error
            });
            this.logger.error(`Security scan failed: ${scan.name} (${scanId})`, {
                error
            });
            throw error;
        }
    }
    async createSecurityIncident(incidentData) {
        const incident = {
            id: `incident-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: incidentData.title,
            description: incidentData.description,
            severity: incidentData.severity,
            status: 'open',
            type: incidentData.type,
            source: incidentData.source,
            affected: {
                systems: [],
                data: [],
                users: [],
                ...incidentData.affected
            },
            timeline: {
                detected: new Date(),
                reported: new Date(),
                acknowledged: new Date()
            },
            response: {
                assignedTo: [],
                actions: [],
                communications: [],
                lessons: []
            },
            evidence: {
                logs: [],
                files: [],
                screenshots: [],
                forensics: []
            },
            impact: {
                confidentiality: 'none',
                integrity: 'none',
                availability: 'none'
            },
            rootCause: {
                primary: '',
                contributing: [],
                analysis: ''
            },
            remediation: {
                immediate: [],
                shortTerm: [],
                longTerm: [],
                preventive: []
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'system',
            auditLog: []
        };
        this.addAuditEntry(incident, 'system', 'incident_created', 'incident', {
            incidentId: incident.id,
            severity: incident.severity,
            type: incident.type
        });
        this.incidents.set(incident.id, incident);
        await this.saveIncident(incident);
        await this.autoAssignIncident(incident);
        if (incident.severity === 'critical' || incident.severity === 'high') {
            await this.sendIncidentNotification(incident);
        }
        this.emit('incident:created', incident);
        this.logger.info(`Security incident created: ${incident.title} (${incident.id})`);
        return incident;
    }
    async updateIncident(incidentId, updates, userId = 'system') {
        const incident = this.incidents.get(incidentId);
        if (!incident) {
            throw new Error(`Incident not found: ${incidentId}`);
        }
        const oldStatus = incident.status;
        Object.assign(incident, updates);
        incident.updatedAt = new Date();
        if (updates.status && updates.status !== oldStatus) {
            this.updateIncidentTimeline(incident, updates.status);
        }
        this.addAuditEntry(incident, userId, 'incident_updated', 'incident', {
            incidentId,
            changes: Object.keys(updates),
            oldStatus,
            newStatus: incident.status
        });
        await this.saveIncident(incident);
        this.emit('incident:updated', {
            incident,
            updates
        });
        this.logger.info(`Security incident updated: ${incident.title} (${incidentId})`);
        return incident;
    }
    async runComplianceAssessment(frameworks, scope) {
        const checks = [];
        for (const framework of frameworks){
            const frameworkChecks = await this.runFrameworkChecks(framework, scope);
            checks.push(...frameworkChecks);
        }
        this.logger.info(`Compliance assessment completed: ${checks.length} checks across ${frameworks.length} frameworks`);
        this.emit('compliance:assessed', {
            frameworks,
            checks,
            scope
        });
        return checks;
    }
    async createSecurityPolicy(policyData) {
        const policy = {
            id: `policy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: policyData.name,
            description: policyData.description,
            type: policyData.type,
            version: '1.0.0',
            status: 'draft',
            rules: policyData.rules.map((rule)=>({
                    id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    ...rule
                })),
            enforcement: {
                level: 'warning',
                exceptions: [],
                approvers: [],
                ...policyData.enforcement
            },
            applicability: {
                projects: [],
                environments: [],
                resources: [],
                ...policyData.applicability
            },
            schedule: {
                reviewFrequency: 'annually',
                nextReview: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                reviewer: 'security-team'
            },
            metrics: {
                violations: 0,
                compliance: 100,
                exceptions: 0
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'system'
        };
        this.policies.set(policy.id, policy);
        await this.savePolicy(policy);
        this.emit('policy:created', policy);
        this.logger.info(`Security policy created: ${policy.name} (${policy.id})`);
        return policy;
    }
    async getSecurityMetrics(filters) {
        let scans = Array.from(this.scans.values());
        let incidents = Array.from(this.incidents.values());
        if (filters) {
            if (filters.timeRange) {
                scans = scans.filter((s)=>s.createdAt >= filters.timeRange.start && s.createdAt <= filters.timeRange.end);
                incidents = incidents.filter((i)=>i.createdAt >= filters.timeRange.start && i.createdAt <= filters.timeRange.end);
            }
            if (filters.projectId) {
                scans = scans.filter((s)=>s.projectId === filters.projectId);
            }
        }
        const scanMetrics = {
            total: scans.length,
            completed: scans.filter((s)=>s.status === 'completed').length,
            failed: scans.filter((s)=>s.status === 'failed').length,
            inProgress: scans.filter((s)=>s.status === 'running').length,
            byType: this.groupBy(scans, 'type'),
            averageDuration: scans.length > 0 ? scans.reduce((sum, s)=>sum + s.metrics.scanDuration, 0) / scans.length : 0
        };
        const allFindings = scans.flatMap((s)=>s.results);
        const findingMetrics = {
            total: allFindings.length,
            open: allFindings.filter((f)=>f.status === 'open').length,
            resolved: allFindings.filter((f)=>f.status === 'resolved').length,
            suppressed: allFindings.filter((f)=>f.status === 'suppressed').length,
            bySeverity: this.groupBy(allFindings, 'severity'),
            byCategory: this.groupBy(allFindings, 'category'),
            meanTimeToResolution: this.calculateMTTR(allFindings)
        };
        const allComplianceChecks = scans.flatMap((s)=>s.compliance.requirements);
        const complianceFrameworks = {};
        for (const check of allComplianceChecks){
            if (!complianceFrameworks[check.framework]) {
                complianceFrameworks[check.framework] = {
                    total: 0,
                    passed: 0,
                    failed: 0,
                    score: 0
                };
            }
            complianceFrameworks[check.framework].total++;
            if (check.status === 'passed') {
                complianceFrameworks[check.framework].passed++;
            } else if (check.status === 'failed') {
                complianceFrameworks[check.framework].failed++;
            }
        }
        for(const framework in complianceFrameworks){
            const fw = complianceFrameworks[framework];
            fw.score = fw.total > 0 ? fw.passed / fw.total * 100 : 0;
        }
        const overallComplianceScore = Object.values(complianceFrameworks).length > 0 ? Object.values(complianceFrameworks).reduce((sum, fw)=>sum + fw.score, 0) / Object.values(complianceFrameworks).length : 0;
        const incidentMetrics = {
            total: incidents.length,
            open: incidents.filter((i)=>i.status === 'open' || i.status === 'investigating').length,
            resolved: incidents.filter((i)=>i.status === 'resolved' || i.status === 'closed').length,
            bySeverity: this.groupBy(incidents, 'severity'),
            meanTimeToDetection: this.calculateMTTD(incidents),
            meanTimeToResponse: this.calculateMTTResponse(incidents),
            meanTimeToResolution: this.calculateIncidentMTTR(incidents)
        };
        const policies = Array.from(this.policies.values());
        const policyMetrics = {
            total: policies.length,
            active: policies.filter((p)=>p.status === 'active').length,
            violations: policies.reduce((sum, p)=>sum + p.metrics.violations, 0),
            compliance: policies.length > 0 ? policies.reduce((sum, p)=>sum + p.metrics.compliance, 0) / policies.length : 0
        };
        return {
            scans: scanMetrics,
            findings: findingMetrics,
            compliance: {
                frameworks: complianceFrameworks,
                overallScore: overallComplianceScore,
                trending: 'stable'
            },
            incidents: incidentMetrics,
            policies: policyMetrics,
            trends: {
                findingsTrend: [],
                complianceTrend: [],
                incidentsTrend: []
            }
        };
    }
    async loadConfigurations() {
        try {
            const scanFiles = await readdir(join(this.securityPath, 'scans'));
            for (const file of scanFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.securityPath, 'scans', file), 'utf-8');
                const scan = JSON.parse(content);
                this.scans.set(scan.id, scan);
            }
            const policyFiles = await readdir(join(this.securityPath, 'policies'));
            for (const file of policyFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.securityPath, 'policies', file), 'utf-8');
                const policy = JSON.parse(content);
                this.policies.set(policy.id, policy);
            }
            const incidentFiles = await readdir(join(this.securityPath, 'incidents'));
            for (const file of incidentFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.securityPath, 'incidents', file), 'utf-8');
                const incident = JSON.parse(content);
                this.incidents.set(incident.id, incident);
            }
            this.logger.info(`Loaded ${this.scans.size} scans, ${this.policies.size} policies, ${this.incidents.size} incidents`);
        } catch (error) {
            this.logger.warn('Failed to load some security configurations', {
                error
            });
        }
    }
    async initializeDefaultPolicies() {
        const defaultPolicies = [
            {
                name: 'Critical Vulnerability Policy',
                description: 'Immediate action required for critical vulnerabilities',
                type: 'scanning',
                rules: [
                    {
                        name: 'Critical CVSS Score',
                        description: 'Alert on vulnerabilities with CVSS score >= 9.0',
                        condition: 'cvss.score >= 9.0',
                        action: 'alert',
                        severity: 'critical',
                        parameters: {
                            threshold: 9.0
                        },
                        enabled: true
                    }
                ],
                enforcement: {
                    level: 'blocking',
                    exceptions: [],
                    approvers: [
                        'security-lead'
                    ]
                }
            },
            {
                name: 'Secret Detection Policy',
                description: 'Detect exposed secrets and credentials',
                type: 'scanning',
                rules: [
                    {
                        name: 'API Key Detection',
                        description: 'Detect exposed API keys',
                        condition: 'category == "secret" && type == "api-key"',
                        action: 'deny',
                        severity: 'high',
                        parameters: {},
                        enabled: true
                    }
                ]
            }
        ];
        for (const policyData of defaultPolicies){
            if (!Array.from(this.policies.values()).some((p)=>p.name === policyData.name)) {
                await this.createSecurityPolicy(policyData);
            }
        }
    }
    async initializeVulnerabilityDatabases() {
        const databases = [
            {
                id: 'nvd',
                name: 'National Vulnerability Database',
                type: 'nvd',
                url: 'https://nvd.nist.gov/feeds/json/cve/1.1/',
                updateFrequency: 'daily',
                lastUpdate: new Date(),
                status: 'active',
                configuration: {}
            },
            {
                id: 'github-advisories',
                name: 'GitHub Security Advisories',
                type: 'github',
                url: 'https://api.github.com/advisories',
                updateFrequency: 'daily',
                lastUpdate: new Date(),
                status: 'active',
                configuration: {}
            }
        ];
        for (const db of databases){
            this.vulnerabilityDatabases.set(db.id, db);
        }
    }
    getDefaultScanner(type) {
        const scanners = {
            vulnerability: 'trivy',
            dependency: 'npm-audit',
            'code-quality': 'sonarqube',
            secrets: 'gitleaks',
            compliance: 'inspec',
            infrastructure: 'checkov',
            container: 'clair'
        };
        return scanners[type] || 'generic';
    }
    async executeScanEngine(scan) {
        const findings = [];
        switch(scan.configuration.scanner){
            case 'trivy':
                return this.executeTrivyScan(scan);
            case 'npm-audit':
                return this.executeNpmAuditScan(scan);
            case 'gitleaks':
                return this.executeGitleaksScan(scan);
            case 'checkov':
                return this.executeCheckovScan(scan);
            default:
                return this.executeGenericScan(scan);
        }
    }
    async executeTrivyScan(scan) {
        return new Promise((resolve, reject)=>{
            const findings = [];
            const mockFindings = [
                {
                    id: `finding-${Date.now()}-1`,
                    title: 'CVE-2023-12345: Remote Code Execution in libxml2',
                    description: 'A buffer overflow vulnerability in libxml2 allows remote code execution',
                    severity: 'critical',
                    category: 'vulnerability',
                    cve: 'CVE-2023-12345',
                    cvss: {
                        score: 9.8,
                        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
                        version: '3.1'
                    },
                    location: {
                        file: 'package-lock.json',
                        line: 125,
                        component: 'libxml2@2.9.10'
                    },
                    evidence: {
                        snippet: '"libxml2": "2.9.10"',
                        context: 'Dependency declaration',
                        references: [
                            'https://nvd.nist.gov/vuln/detail/CVE-2023-12345'
                        ]
                    },
                    impact: 'Remote attackers could execute arbitrary code',
                    remediation: {
                        description: 'Update libxml2 to version 2.9.14 or later',
                        effort: 'low',
                        priority: 'critical',
                        autoFixable: true,
                        steps: [
                            'npm update libxml2'
                        ],
                        references: [
                            'https://github.com/GNOME/libxml2/releases'
                        ]
                    },
                    status: 'open',
                    tags: [
                        'cve',
                        'rce',
                        'dependency'
                    ],
                    metadata: {},
                    firstSeen: new Date(),
                    lastSeen: new Date(),
                    occurrences: 1
                }
            ];
            setTimeout(()=>{
                resolve(mockFindings);
            }, 2000);
        });
    }
    async executeNpmAuditScan(scan) {
        return new Promise((resolve, reject)=>{
            const command = 'npm';
            const args = [
                'audit',
                '--json'
            ];
            const child = spawn(command, args, {
                cwd: scan.target.path,
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (data)=>{
                stdout += data.toString();
            });
            child.stderr?.on('data', (data)=>{
                stderr += data.toString();
            });
            child.on('close', (code)=>{
                try {
                    const auditResult = JSON.parse(stdout);
                    const findings = this.parseNpmAuditResults(auditResult);
                    resolve(findings);
                } catch (error) {
                    reject(new Error(`Failed to parse npm audit results: ${error instanceof Error ? error.message : String(error)}`));
                }
            });
            child.on('error', (error)=>{
                reject(error);
            });
        });
    }
    async executeGitleaksScan(scan) {
        return [
            {
                id: `finding-${Date.now()}-2`,
                title: 'Exposed AWS Access Key',
                description: 'AWS access key found in source code',
                severity: 'high',
                category: 'secret',
                location: {
                    file: 'config/aws.js',
                    line: 12,
                    column: 20
                },
                evidence: {
                    snippet: 'const accessKey = "AKIA123456789..."',
                    context: 'Hardcoded AWS credentials'
                },
                impact: 'Unauthorized access to AWS resources',
                remediation: {
                    description: 'Remove hardcoded credentials and use environment variables or IAM roles',
                    effort: 'medium',
                    priority: 'high',
                    autoFixable: false,
                    steps: [
                        'Remove hardcoded credentials',
                        'Use environment variables',
                        'Rotate compromised keys'
                    ],
                    references: [
                        'https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html'
                    ]
                },
                status: 'open',
                tags: [
                    'secret',
                    'aws',
                    'credentials'
                ],
                metadata: {},
                firstSeen: new Date(),
                lastSeen: new Date(),
                occurrences: 1
            }
        ];
    }
    async executeCheckovScan(scan) {
        return [];
    }
    async executeGenericScan(scan) {
        return [];
    }
    parseNpmAuditResults(auditResult) {
        const findings = [];
        if (auditResult.vulnerabilities) {
            for (const [packageName, vulnData] of Object.entries(auditResult.vulnerabilities)){
                const vuln = vulnData;
                findings.push({
                    id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: `${vuln.severity} vulnerability in ${packageName}`,
                    description: vuln.title || 'Vulnerability detected',
                    severity: vuln.severity,
                    category: 'vulnerability',
                    cve: vuln.cve,
                    location: {
                        file: 'package.json',
                        component: packageName
                    },
                    evidence: {
                        snippet: `"${packageName}": "${vuln.range}"`,
                        references: vuln.url ? [
                            vuln.url
                        ] : []
                    },
                    impact: vuln.overview || 'Security vulnerability',
                    remediation: {
                        description: vuln.recommendation || 'Update to a secure version',
                        effort: 'low',
                        priority: vuln.severity === 'info' ? 'low' : vuln.severity,
                        autoFixable: true,
                        steps: [
                            `npm update ${packageName}`
                        ],
                        references: vuln.url ? [
                            vuln.url
                        ] : []
                    },
                    status: 'open',
                    tags: [
                        'npm',
                        'dependency'
                    ],
                    metadata: {
                        packageName,
                        range: vuln.range
                    },
                    firstSeen: new Date(),
                    lastSeen: new Date(),
                    occurrences: 1
                });
            }
        }
        return findings;
    }
    calculateScanMetrics(scan) {
        const findings = scan.results;
        scan.metrics.totalFindings = findings.length;
        scan.metrics.criticalFindings = findings.filter((f)=>f.severity === 'critical').length;
        scan.metrics.highFindings = findings.filter((f)=>f.severity === 'high').length;
        scan.metrics.mediumFindings = findings.filter((f)=>f.severity === 'medium').length;
        scan.metrics.lowFindings = findings.filter((f)=>f.severity === 'low').length;
        scan.metrics.falsePositives = findings.filter((f)=>f.status === 'false-positive').length;
        scan.metrics.suppressed = findings.filter((f)=>f.status === 'suppressed').length;
    }
    async runComplianceChecks(scan) {
        const frameworks = [
            'SOC2',
            'GDPR',
            'PCI-DSS'
        ];
        for (const framework of frameworks){
            const checks = await this.runFrameworkChecks(framework, {
                projectId: scan.projectId
            });
            scan.compliance.requirements.push(...checks);
        }
        scan.compliance.frameworks = frameworks;
        scan.compliance.passedChecks = scan.compliance.requirements.filter((r)=>r.status === 'passed').length;
        scan.compliance.failedChecks = scan.compliance.requirements.filter((r)=>r.status === 'failed').length;
        scan.compliance.overallScore = scan.compliance.requirements.length > 0 ? scan.compliance.passedChecks / scan.compliance.requirements.length * 100 : 0;
    }
    async runFrameworkChecks(framework, scope) {
        const mockChecks = [
            {
                id: `check-${Date.now()}-1`,
                framework,
                control: 'CC6.1',
                description: 'Encryption in transit',
                status: 'passed',
                severity: 'high',
                evidence: 'TLS 1.2+ configured',
                lastChecked: new Date()
            },
            {
                id: `check-${Date.now()}-2`,
                framework,
                control: 'CC6.7',
                description: 'Encryption at rest',
                status: 'failed',
                severity: 'medium',
                remediation: 'Enable database encryption',
                lastChecked: new Date()
            }
        ];
        return mockChecks;
    }
    async generateRemediationRecommendations(scan) {
        const autoFixable = scan.results.filter((f)=>f.remediation.autoFixable);
        const manualReview = scan.results.filter((f)=>!f.remediation.autoFixable);
        scan.remediation.autoFixAvailable = autoFixable;
        scan.remediation.manualReview = manualReview;
        scan.remediation.recommendations = [
            {
                id: `rec-${Date.now()}-1`,
                title: 'Implement Automated Dependency Updates',
                description: 'Set up automated dependency updates to reduce vulnerability exposure',
                category: 'vulnerability-management',
                priority: 'high',
                effort: 'medium',
                impact: 'Reduces time to patch vulnerabilities',
                implementation: {
                    steps: [
                        'Configure Dependabot or Renovate',
                        'Set up automated testing pipeline',
                        'Enable auto-merge for low-risk updates'
                    ],
                    tools: [
                        'Dependabot',
                        'Renovate',
                        'GitHub Actions'
                    ],
                    timeEstimate: '2-4 hours',
                    cost: 'Free'
                },
                references: [
                    'https://docs.github.com/en/code-security/dependabot',
                    'https://renovatebot.com/'
                ],
                applicableFrameworks: [
                    'SOC2',
                    'ISO27001'
                ]
            }
        ];
    }
    async checkNotificationThresholds(scan) {
        const thresholds = scan.notifications.thresholds;
        if (scan.metrics.criticalFindings >= thresholds.critical || scan.metrics.highFindings >= thresholds.high || scan.metrics.mediumFindings >= thresholds.medium) {
            await this.sendScanNotification(scan);
        }
    }
    async sendScanNotification(scan) {
        const message = `Security scan '${scan.name}' completed with ${scan.metrics.totalFindings} findings (${scan.metrics.criticalFindings} critical, ${scan.metrics.highFindings} high)`;
        this.emit('notification:scan', {
            scan,
            message,
            severity: scan.metrics.criticalFindings > 0 ? 'critical' : scan.metrics.highFindings > 0 ? 'high' : 'medium'
        });
        this.logger.warn(message);
    }
    async autoAssignIncident(incident) {
        const assignmentRules = {
            critical: [
                'security-lead',
                'ciso'
            ],
            high: [
                'security-team'
            ],
            medium: [
                'security-analyst'
            ],
            low: [
                'security-analyst'
            ]
        };
        incident.response.assignedTo = assignmentRules[incident.severity] || [
            'security-team'
        ];
    }
    async sendIncidentNotification(incident) {
        const message = `SECURITY INCIDENT: ${incident.title} (${incident.severity.toUpperCase()})`;
        this.emit('notification:incident', {
            incident,
            message,
            urgency: incident.severity === 'critical' ? 'immediate' : 'high'
        });
        this.logger.error(message);
    }
    updateIncidentTimeline(incident, newStatus) {
        const now = new Date();
        switch(newStatus){
            case 'investigating':
                incident.timeline.acknowledged = now;
                break;
            case 'contained':
                incident.timeline.contained = now;
                break;
            case 'resolved':
                incident.timeline.resolved = now;
                break;
            case 'closed':
                incident.timeline.closed = now;
                break;
        }
    }
    async saveScan(scan) {
        const filePath = join(this.securityPath, 'scans', `${scan.id}.json`);
        await writeFile(filePath, JSON.stringify(scan, null, 2));
    }
    async savePolicy(policy) {
        const filePath = join(this.securityPath, 'policies', `${policy.id}.json`);
        await writeFile(filePath, JSON.stringify(policy, null, 2));
    }
    async saveIncident(incident) {
        const filePath = join(this.securityPath, 'incidents', `${incident.id}.json`);
        await writeFile(filePath, JSON.stringify(incident, null, 2));
    }
    addAuditEntry(target, userId, action, targetType, details) {
        const entry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            userId,
            action,
            target: targetType,
            details
        };
        target.auditLog.push(entry);
    }
    groupBy(array, key) {
        return array.reduce((groups, item)=>{
            const value = String(item[key]);
            groups[value] = (groups[value] || 0) + 1;
            return groups;
        }, {});
    }
    calculateMTTR(findings) {
        const resolvedFindings = findings.filter((f)=>f.status === 'resolved' && f.firstSeen && f.lastSeen);
        if (resolvedFindings.length === 0) return 0;
        const totalTime = resolvedFindings.reduce((sum, f)=>sum + (f.lastSeen.getTime() - f.firstSeen.getTime()), 0);
        return totalTime / resolvedFindings.length;
    }
    calculateMTTD(incidents) {
        const detectedIncidents = incidents.filter((i)=>i.timeline.detected && i.timeline.reported);
        if (detectedIncidents.length === 0) return 0;
        const totalTime = detectedIncidents.reduce((sum, i)=>sum + (i.timeline.reported.getTime() - i.timeline.detected.getTime()), 0);
        return totalTime / detectedIncidents.length;
    }
    calculateMTTResponse(incidents) {
        const respondedIncidents = incidents.filter((i)=>i.timeline.reported && i.timeline.acknowledged);
        if (respondedIncidents.length === 0) return 0;
        const totalTime = respondedIncidents.reduce((sum, i)=>sum + (i.timeline.acknowledged.getTime() - i.timeline.reported.getTime()), 0);
        return totalTime / respondedIncidents.length;
    }
    calculateIncidentMTTR(incidents) {
        const resolvedIncidents = incidents.filter((i)=>i.timeline.reported && i.timeline.resolved);
        if (resolvedIncidents.length === 0) return 0;
        const totalTime = resolvedIncidents.reduce((sum, i)=>sum + (i.timeline.resolved.getTime() - i.timeline.reported.getTime()), 0);
        return totalTime / resolvedIncidents.length;
    }
}

//# sourceMappingURL=security-manager.js.map