import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
export class MemoryJobPersistence {
    jobs = new Map();
    async save(job) {
        this.jobs.set(job.job_id, {
            ...job
        });
    }
    async load(job_id) {
        const job = this.jobs.get(job_id);
        return job ? {
            ...job
        } : null;
    }
    async list(filter) {
        let jobs = Array.from(this.jobs.values());
        if (filter?.status) {
            jobs = jobs.filter((j)=>j.status === filter.status);
        }
        if (filter?.limit) {
            jobs = jobs.slice(0, filter.limit);
        }
        return jobs;
    }
    async delete(job_id) {
        this.jobs.delete(job_id);
    }
}
export class MCPAsyncJobManager extends EventEmitter {
    logger;
    config;
    jobs = new Map();
    executors = new Map();
    persistence;
    constructor(persistence, logger, config = {}){
        super(), this.logger = logger, this.config = config;
        this.persistence = persistence || new MemoryJobPersistence();
        this.config.maxJobs = this.config.maxJobs || 1000;
        this.config.jobTTL = this.config.jobTTL || 86400000;
        this.config.defaultPollInterval = this.config.defaultPollInterval || 5;
        setInterval(()=>this.cleanupExpiredJobs(), 3600000);
    }
    async submitJob(request, executor) {
        if (this.jobs.size >= this.config.maxJobs) {
            throw new Error('Job queue full. Please try again later.');
        }
        const existingJob = Array.from(this.jobs.values()).find((j)=>j.request_id === request.request_id && (j.status === 'queued' || j.status === 'running'));
        if (existingJob) {
            throw new Error(`Duplicate request_id: ${request.request_id}. Job already submitted.`);
        }
        const job = {
            request_id: request.request_id,
            job_id: uuidv4(),
            tool_id: request.tool_id,
            arguments: request.arguments,
            mode: request.mode,
            status: 'queued',
            progress: 0,
            context: request.context,
            created_at: new Date()
        };
        await this.persistence.save(job);
        this.jobs.set(job.job_id, job);
        this.logger.info('Job submitted', {
            job_id: job.job_id,
            request_id: job.request_id,
            tool_id: job.tool_id
        });
        this.executeJob(job, executor);
        return {
            request_id: job.request_id,
            job_id: job.job_id,
            status: 'in_progress',
            poll_after: this.config.defaultPollInterval
        };
    }
    async pollJob(job_id) {
        const job = await this.persistence.load(job_id);
        if (!job) {
            throw new Error(`Job not found: ${job_id}`);
        }
        const status = job.status === 'success' ? 'success' : job.status === 'error' ? 'error' : 'in_progress';
        const handle = {
            request_id: job.request_id,
            job_id: job.job_id,
            status,
            poll_after: status === 'in_progress' ? this.config.defaultPollInterval : 0
        };
        if (status === 'in_progress') {
            handle.progress = {
                percent: job.progress,
                message: job.progress_message
            };
        }
        return handle;
    }
    async resumeJob(job_id) {
        const job = await this.persistence.load(job_id);
        if (!job) {
            throw new Error(`Job not found: ${job_id}`);
        }
        const result = {
            request_id: job.request_id,
            status: job.status === 'success' ? 'success' : job.status === 'error' ? 'error' : 'in_progress',
            metadata: {}
        };
        if (job.status === 'success') {
            result.result = job.result;
            result.metadata.duration_ms = job.completed_at && job.started_at ? job.completed_at.getTime() - job.started_at.getTime() : undefined;
            result.metadata.tokens_used = job.tokens_used;
        } else if (job.status === 'error') {
            result.error = {
                code: 'EXECUTION_ERROR',
                message: job.error?.message || 'Job execution failed',
                details: job.error
            };
        } else {
            result.progress = {
                percent: job.progress,
                message: job.progress_message
            };
        }
        return result;
    }
    async cancelJob(job_id) {
        const job = this.jobs.get(job_id);
        if (!job) {
            return false;
        }
        if (job.status === 'success' || job.status === 'error') {
            return false;
        }
        if (job.abortController) {
            job.abortController.abort();
        }
        job.status = 'cancelled';
        job.completed_at = new Date();
        await this.persistence.save(job);
        this.emit('job:cancelled', job_id);
        this.logger.info('Job cancelled', {
            job_id
        });
        return true;
    }
    async listJobs(filter) {
        return await this.persistence.list(filter);
    }
    async executeJob(job, executor) {
        job.status = 'running';
        job.started_at = new Date();
        job.abortController = new AbortController();
        await this.persistence.save(job);
        this.emit('job:started', job.job_id);
        this.logger.info('Job started', {
            job_id: job.job_id,
            tool_id: job.tool_id
        });
        try {
            const onProgress = (percent, message)=>{
                job.progress = Math.min(100, Math.max(0, percent));
                job.progress_message = message;
                this.persistence.save(job).catch((err)=>this.logger.error('Failed to save progress', {
                        job_id: job.job_id,
                        error: err
                    }));
                this.emit('job:progress', job.job_id, job.progress, message);
            };
            if (job.abortController.signal.aborted) {
                throw new Error('Job cancelled before execution');
            }
            const result = await executor(job.arguments, onProgress);
            job.status = 'success';
            job.result = result;
            job.progress = 100;
            job.completed_at = new Date();
            await this.persistence.save(job);
            this.emit('job:completed', job.job_id, result);
            this.logger.info('Job completed', {
                job_id: job.job_id,
                duration_ms: job.completed_at.getTime() - job.started_at.getTime()
            });
        } catch (error) {
            job.status = 'error';
            job.error = {
                message: error.message,
                stack: error.stack,
                code: error.code
            };
            job.completed_at = new Date();
            await this.persistence.save(job);
            this.emit('job:failed', job.job_id, error);
            this.logger.error('Job failed', {
                job_id: job.job_id,
                error: error.message
            });
        }
    }
    async cleanupExpiredJobs() {
        const now = Date.now();
        const jobs = await this.persistence.list();
        let cleaned = 0;
        for (const job of jobs){
            const age = now - job.created_at.getTime();
            if (age > this.config.jobTTL && job.status !== 'running') {
                await this.persistence.delete(job.job_id);
                this.jobs.delete(job.job_id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.info('Cleaned up expired jobs', {
                count: cleaned
            });
        }
        return cleaned;
    }
    getMetrics() {
        const jobs = Array.from(this.jobs.values());
        return {
            total: jobs.length,
            byStatus: {
                queued: jobs.filter((j)=>j.status === 'queued').length,
                running: jobs.filter((j)=>j.status === 'running').length,
                success: jobs.filter((j)=>j.status === 'success').length,
                error: jobs.filter((j)=>j.status === 'error').length,
                cancelled: jobs.filter((j)=>j.status === 'cancelled').length
            },
            averageDuration: this.calculateAverageDuration(jobs)
        };
    }
    calculateAverageDuration(jobs) {
        const completed = jobs.filter((j)=>(j.status === 'success' || j.status === 'error') && j.started_at && j.completed_at);
        if (completed.length === 0) return 0;
        const total = completed.reduce((sum, j)=>sum + (j.completed_at.getTime() - j.started_at.getTime()), 0);
        return total / completed.length;
    }
}

//# sourceMappingURL=job-manager-mcp25.js.map