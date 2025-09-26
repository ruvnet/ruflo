import * as chalk from 'chalk';
export class ProgressReporter {
    progress;
    startTime;
    spinner = [
        '⠋',
        '⠙',
        '⠹',
        '⠸',
        '⠼',
        '⠴',
        '⠦',
        '⠧',
        '⠇',
        '⠏'
    ];
    spinnerIndex = 0;
    intervalId = null;
    constructor(){
        this.progress = {
            total: 0,
            completed: 0,
            current: '',
            phase: 'analyzing',
            errors: 0,
            warnings: 0
        };
        this.startTime = new Date();
    }
    start(phase, message) {
        this.progress.phase = phase;
        this.progress.current = message;
        this.startTime = new Date();
        console.log(chalk.bold(`\n🚀 Starting ${phase}...`));
        this.startSpinner();
    }
    update(phase, message, completed, total) {
        this.progress.phase = phase;
        this.progress.current = message;
        if (completed !== undefined) {
            this.progress.completed = completed;
        }
        if (total !== undefined) {
            this.progress.total = total;
        }
        this.updateDisplay();
    }
    complete(message) {
        this.stopSpinner();
        const duration = new Date().getTime() - this.startTime.getTime();
        const seconds = (duration / 1000).toFixed(2);
        console.log(chalk.green(`\n✅ ${message}`));
        console.log(chalk.gray(`   Completed in ${seconds}s`));
        if (this.progress.warnings > 0) {
            console.log(chalk.yellow(`   ${this.progress.warnings} warnings`));
        }
        if (this.progress.errors > 0) {
            console.log(chalk.red(`   ${this.progress.errors} errors`));
        }
    }
    error(message) {
        this.stopSpinner();
        console.log(chalk.red(`\n❌ ${message}`));
        this.progress.errors++;
    }
    warning(message) {
        console.log(chalk.yellow(`⚠️  ${message}`));
        this.progress.warnings++;
    }
    info(message) {
        console.log(chalk.blue(`ℹ️  ${message}`));
    }
    startSpinner() {
        this.intervalId = setInterval(()=>{
            this.spinnerIndex = (this.spinnerIndex + 1) % this.spinner.length;
            this.updateDisplay();
        }, 100);
    }
    stopSpinner() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        process.stdout.write('\r\x1b[K');
    }
    updateDisplay() {
        const spinner = this.spinner[this.spinnerIndex];
        const phase = this.getPhaseDisplay();
        const progress = this.getProgressDisplay();
        const message = `${spinner} ${phase} ${progress} ${this.progress.current}`;
        process.stdout.write('\r\x1b[K' + message);
    }
    getPhaseDisplay() {
        const phases = {
            analyzing: chalk.blue('📊 Analyzing'),
            'backing-up': chalk.yellow('💾 Backing up'),
            migrating: chalk.green('🔄 Migrating'),
            validating: chalk.cyan('✅ Validating'),
            complete: chalk.green('✅ Complete')
        };
        return phases[this.progress.phase] || chalk.gray('⏳ Processing');
    }
    getProgressDisplay() {
        if (this.progress.total > 0) {
            const percentage = Math.round(this.progress.completed / this.progress.total * 100);
            const progressBar = this.createProgressBar(percentage);
            return `${progressBar} ${this.progress.completed}/${this.progress.total} (${percentage}%)`;
        }
        return '';
    }
    createProgressBar(percentage, width = 20) {
        const filled = Math.round(percentage / 100 * width);
        const empty = width - filled;
        const filledBar = '█'.repeat(filled);
        const emptyBar = '░'.repeat(empty);
        return chalk.green(filledBar) + chalk.gray(emptyBar);
    }
    setTotal(total) {
        this.progress.total = total;
    }
    increment(message) {
        this.progress.completed++;
        if (message) {
            this.progress.current = message;
        }
        this.updateDisplay();
    }
    getProgress() {
        return {
            ...this.progress
        };
    }
}

//# sourceMappingURL=progress-reporter.js.map