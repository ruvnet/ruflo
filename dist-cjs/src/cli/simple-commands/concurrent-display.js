export class ConcurrentDisplay {
    constructor(agents = [], options = {}){
        this.agents = new Map();
        this.options = {
            maxWidth: Math.min(process.stdout.columns || 80, 80),
            updateInterval: 100,
            showTools: true,
            showTimers: true,
            ...options
        };
        agents.forEach((agent)=>{
            this.agents.set(agent.id, {
                ...agent,
                status: 'pending',
                currentTool: null,
                lastActivity: '',
                startTime: null,
                events: 0,
                progress: 0
            });
        });
        this.displayBuffer = [];
        this.lastRender = Date.now();
        this.spinnerFrames = [
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
        this.spinnerIndex = 0;
    }
    start() {
        process.stdout.write('\x1B[2J\x1B[H\x1B[?25l');
        this.interval = setInterval(()=>{
            this.render();
        }, this.options.updateInterval);
        process.on('exit', ()=>{
            process.stdout.write('\x1B[?25h');
            this.stop();
        });
        process.on('SIGINT', ()=>{
            this.stop();
            process.exit(0);
        });
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        process.stdout.write('\x1B[?25h');
    }
    updateAgent(agentId, updates) {
        const agent = this.agents.get(agentId);
        if (agent) {
            Object.assign(agent, updates);
            if (updates.status === 'active' && !agent.startTime) {
                agent.startTime = Date.now();
            }
        }
    }
    addActivity(agentId, activity, tool = null) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.lastActivity = activity.substring(0, 50) + (activity.length > 50 ? '...' : '');
            agent.currentTool = tool;
            agent.events++;
            if (activity.includes('completed') || activity.includes('finished')) {
                agent.progress = 100;
            } else if (agent.progress < 90) {
                agent.progress = Math.min(agent.progress + 5, 90);
            }
        }
    }
    render() {
        const now = Date.now();
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
        const spinner = this.spinnerFrames[this.spinnerIndex];
        process.stdout.write('\x1B[2J\x1B[H');
        this.renderHeader();
        this.renderAgentPanels(spinner);
        this.renderFooter();
        this.lastRender = now;
    }
    renderHeader() {
        const width = this.options.maxWidth;
        process.stdout.write('╔' + '═'.repeat(width - 2) + '╗\n');
        process.stdout.write('║' + this.center('🤖 CONCURRENT AGENTS', width - 2) + '║\n');
        process.stdout.write('╠' + '═'.repeat(width - 2) + '╣\n');
    }
    renderAgentPanels(spinner) {
        const agentArray = Array.from(this.agents.values());
        const columns = Math.min(2, agentArray.length);
        const columnWidth = Math.floor((this.options.maxWidth - 4) / columns) - 2;
        const rows = Math.ceil(agentArray.length / columns);
        for(let row = 0; row < rows; row++){
            let line = '║ ';
            for(let col = 0; col < columns; col++){
                const agentIndex = row * columns + col;
                if (agentIndex < agentArray.length) {
                    const agent = agentArray[agentIndex];
                    line += this.renderAgentPanel(agent, columnWidth, spinner);
                    if (col < columns - 1) line += ' │ ';
                } else {
                    line += ' '.repeat(columnWidth);
                    if (col < columns - 1) line += ' │ ';
                }
            }
            line += ' ║';
            process.stdout.write(line + '\n');
            if (row < rows - 1) {
                let separator = '║ ';
                for(let col = 0; col < columns; col++){
                    separator += '─'.repeat(columnWidth);
                    if (col < columns - 1) separator += ' │ ';
                }
                separator += ' ║';
                process.stdout.write(separator + '\n');
            }
        }
    }
    renderAgentPanel(agent, width, spinner) {
        const lines = [];
        const icon = this.getAgentIcon(agent.type);
        const statusIcon = this.getStatusIcon(agent.status, spinner);
        const shortName = agent.name.length > 20 ? agent.name.substring(0, 17) + '...' : agent.name;
        const header = `${icon} ${shortName}`;
        lines.push(this.truncate(`${statusIcon} ${header}`, width));
        const status = this.getStatusText(agent.status);
        const elapsed = agent.startTime ? this.formatDuration(Date.now() - agent.startTime) : '--:--';
        lines.push(this.truncate(`${status} │ ${elapsed}`, width));
        if (agent.status === 'active') {
            const compactBar = this.renderCompactProgressBar(agent.progress, width - 10);
            lines.push(this.truncate(`[${compactBar}] ${agent.progress}%`, width));
        } else {
            lines.push(' '.repeat(width));
        }
        if (agent.lastActivity) {
            const shortActivity = agent.lastActivity.length > 25 ? agent.lastActivity.substring(0, 22) + '...' : agent.lastActivity;
            lines.push(this.truncate(`→ ${shortActivity}`, width));
        } else {
            lines.push(this.truncate('→ Waiting...', width));
        }
        lines.push(this.truncate(`Events: ${agent.events}`, width));
        while(lines.length < 5){
            lines.push(' '.repeat(width));
        }
        return lines.join('\n║ ').split('\n').map((l)=>l.substring(2)).join('\n║ ');
    }
    renderFooter() {
        const width = this.options.maxWidth;
        const agents = Array.from(this.agents.values());
        const active = agents.filter((a)=>a.status === 'active').length;
        const completed = agents.filter((a)=>a.status === 'completed').length;
        const failed = agents.filter((a)=>a.status === 'failed').length;
        const total = agents.length;
        process.stdout.write('╠' + '═'.repeat(width - 2) + '╣\n');
        const progress = total > 0 ? Math.floor((completed + failed) / total * 100) : 0;
        const summary = `📊 ${progress}% │ ⚡${active} │ ✅${completed} │ ❌${failed}`;
        process.stdout.write('║' + this.center(summary, width - 2) + '║\n');
        process.stdout.write('╚' + '═'.repeat(width - 2) + '╝\n');
    }
    getAgentIcon(type) {
        const icons = {
            'search': '🔍',
            'foundation': '🏗️',
            'refinement': '🔧',
            'ensemble': '🎯',
            'validation': '✅',
            'coordinator': '🎮',
            'researcher': '🔬',
            'coder': '💻',
            'optimizer': '⚡',
            'architect': '🏛️',
            'tester': '🧪'
        };
        return icons[type] || '🤖';
    }
    getStatusIcon(status, spinner) {
        switch(status){
            case 'active':
                return spinner;
            case 'completed':
                return '✅';
            case 'failed':
                return '❌';
            case 'pending':
                return '⏳';
            default:
                return '•';
        }
    }
    getStatusText(status) {
        switch(status){
            case 'active':
                return 'Running';
            case 'completed':
                return 'Complete';
            case 'failed':
                return 'Failed';
            case 'pending':
                return 'Waiting';
            default:
                return status;
        }
    }
    renderProgressBar(progress, width) {
        const barWidth = Math.min(20, width - 10);
        const filled = Math.floor(progress / 100 * barWidth);
        const empty = barWidth - filled;
        return `[${'\u2588'.repeat(filled)}${'░'.repeat(empty)}] ${progress}%`;
    }
    renderCompactProgressBar(progress, maxWidth) {
        const barWidth = Math.min(10, maxWidth);
        const filled = Math.floor(progress / 100 * barWidth);
        const empty = barWidth - filled;
        return '\u2588'.repeat(filled) + '░'.repeat(empty);
    }
    truncate(text, width) {
        if (text.length <= width) {
            return text.padEnd(width);
        }
        return text.substring(0, width - 3) + '...';
    }
    center(text, width) {
        const padding = Math.max(0, width - text.length);
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    }
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
}
export function createConcurrentDisplay(agents, options = {}) {
    return new ConcurrentDisplay(agents, options);
}

//# sourceMappingURL=concurrent-display.js.map