export class TerminalEmulator {
    constructor(outputElement, inputElement){
        this.outputElement = outputElement;
        this.inputElement = inputElement;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 1000;
        this.maxOutputLines = 1000;
        this.currentPrompt = 'claude-flow>';
        this.isLocked = false;
        this.commands = [
            'help',
            'clear',
            'status',
            'connect',
            'disconnect',
            'claude-flow',
            'swarm',
            'init',
            'config',
            'memory',
            'tools',
            'agents',
            'benchmark',
            'sparc'
        ];
        this.ansiColors = {
            30: '#000000',
            31: '#ff5555',
            32: '#50fa7b',
            33: '#f1fa8c',
            34: '#bd93f9',
            35: '#ff79c6',
            36: '#8be9fd',
            37: '#f8f8f2',
            90: '#6272a4',
            91: '#ff6e6e',
            92: '#69ff94',
            93: '#ffffa5',
            94: '#d6acff',
            95: '#ff92df',
            96: '#a4ffff',
            97: '#ffffff'
        };
        this.setupInputHandlers();
        this.setupScrollBehavior();
    }
    write(content, type = 'output', timestamp = true) {
        const entry = this.createOutputEntry(content, type, timestamp);
        this.outputElement.appendChild(entry);
        this.limitOutputLines();
        this.scrollToBottom();
        return entry;
    }
    writeLine(content, type = 'output', timestamp = true) {
        return this.write(content + '\n', type, timestamp);
    }
    writeCommand(command) {
        return this.write(`${this.currentPrompt} ${command}`, 'command', true);
    }
    writeError(message) {
        return this.writeLine(`Error: ${message}`, 'error');
    }
    writeSuccess(message) {
        return this.writeLine(message, 'success');
    }
    writeWarning(message) {
        return this.writeLine(`Warning: ${message}`, 'warning');
    }
    writeInfo(message) {
        return this.writeLine(message, 'info');
    }
    writeHTML(html, type = 'output') {
        const entry = document.createElement('div');
        entry.className = 'output-entry';
        entry.innerHTML = html;
        if (type) {
            entry.classList.add(`output-${type}`);
        }
        this.outputElement.appendChild(entry);
        this.limitOutputLines();
        this.scrollToBottom();
        return entry;
    }
    clear() {
        this.outputElement.innerHTML = '';
        this.showWelcomeMessage();
    }
    showWelcomeMessage() {
        const existingWelcome = this.outputElement.querySelector('.welcome-message');
        if (existingWelcome) {
            return;
        }
        const welcome = document.createElement('div');
        welcome.className = 'welcome-message';
        welcome.innerHTML = `
      <div class="ascii-art">╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     🌊 Claude Flow v2.0.0                                ║
║                                                           ║
║     Welcome to the web-based swarm orchestration         ║
║     Type 'help' for available commands                   ║
║     Use Ctrl+L to clear console                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝</div>
    `;
        this.outputElement.appendChild(welcome);
    }
    setPrompt(prompt) {
        this.currentPrompt = prompt;
        const promptElement = document.getElementById('promptText');
        if (promptElement) {
            promptElement.textContent = prompt;
        }
    }
    setLocked(locked) {
        this.isLocked = locked;
        this.inputElement.disabled = locked;
        if (locked) {
            this.inputElement.placeholder = 'Processing...';
        } else {
            this.inputElement.placeholder = 'Enter command...';
            this.inputElement.focus();
        }
    }
    focus() {
        if (!this.isLocked) {
            this.inputElement.focus();
        }
    }
    getInput() {
        return this.inputElement.value;
    }
    setInput(value) {
        this.inputElement.value = value;
    }
    clearInput() {
        this.inputElement.value = '';
    }
    addToHistory(command) {
        if (command.trim() && this.history[this.history.length - 1] !== command) {
            this.history.push(command);
            if (this.history.length > this.maxHistorySize) {
                this.history.shift();
            }
        }
        this.historyIndex = -1;
    }
    navigateHistory(direction) {
        if (this.history.length === 0) return;
        if (direction === 'up') {
            if (this.historyIndex === -1) {
                this.historyIndex = this.history.length - 1;
            } else if (this.historyIndex > 0) {
                this.historyIndex--;
            }
        } else if (direction === 'down') {
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
            } else {
                this.historyIndex = -1;
            }
        }
        if (this.historyIndex === -1) {
            this.setInput('');
        } else {
            this.setInput(this.history[this.historyIndex]);
        }
    }
    createOutputEntry(content, type, timestamp) {
        const entry = document.createElement('div');
        entry.className = 'output-entry';
        const line = document.createElement('div');
        line.className = 'output-line';
        if (timestamp && this.shouldShowTimestamp()) {
            const timeElement = document.createElement('span');
            timeElement.className = 'output-timestamp';
            timeElement.textContent = this.formatTimestamp(new Date());
            line.appendChild(timeElement);
        }
        const contentElement = document.createElement('span');
        contentElement.className = `output-content ${type}`;
        if (typeof content === 'string' && content.includes('\x1b[')) {
            contentElement.innerHTML = this.processAnsiCodes(content);
        } else {
            contentElement.textContent = content;
        }
        line.appendChild(contentElement);
        entry.appendChild(line);
        return entry;
    }
    processAnsiCodes(text) {
        return text.replace(/\x1b\[(\d+)m/g, (match, code)=>{
            if (code === '0' || code === '00') {
                return '</span>';
            }
            const color = this.ansiColors[code];
            if (color) {
                return `<span style="color: ${color}">`;
            }
            return '';
        }).replace(/\x1b\[[\d;]*m/g, '') + '</span>';
    }
    formatTimestamp(date) {
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    shouldShowTimestamp() {
        const showTimestamps = localStorage.getItem('console_show_timestamps');
        return showTimestamps !== 'false';
    }
    limitOutputLines() {
        const entries = this.outputElement.querySelectorAll('.output-entry');
        if (entries.length > this.maxOutputLines) {
            const excessCount = entries.length - this.maxOutputLines;
            for(let i = 0; i < excessCount; i++){
                if (entries[i] && !entries[i].classList.contains('welcome-message')) {
                    entries[i].remove();
                }
            }
        }
    }
    scrollToBottom(smooth = false) {
        if (this.shouldAutoScroll()) {
            if (smooth) {
                this.outputElement.scrollTo({
                    top: this.outputElement.scrollHeight,
                    behavior: 'smooth'
                });
            } else {
                this.outputElement.scrollTop = this.outputElement.scrollHeight;
            }
        }
    }
    shouldAutoScroll() {
        const autoScroll = localStorage.getItem('console_auto_scroll');
        return autoScroll !== 'false';
    }
    setupInputHandlers() {
        this.inputElement.addEventListener('keydown', (event)=>{
            if (this.isLocked) {
                event.preventDefault();
                return;
            }
            switch(event.key){
                case 'Enter':
                    event.preventDefault();
                    this.handleEnter();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.navigateHistory('up');
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.navigateHistory('down');
                    break;
                case 'Tab':
                    event.preventDefault();
                    this.handleTab();
                    break;
                case 'l':
                    if (event.ctrlKey) {
                        event.preventDefault();
                        this.clear();
                    }
                    break;
                case 'c':
                    if (event.ctrlKey) {
                        event.preventDefault();
                        this.handleInterrupt();
                    }
                    break;
            }
        });
        this.inputElement.addEventListener('input', ()=>{
            if (!this.isLocked) {
                this.handleInput();
            }
        });
    }
    handleEnter() {
        const command = this.getInput().trim();
        if (command) {
            this.addToHistory(command);
            this.writeCommand(command);
            this.clearInput();
            this.emit('command', command);
        }
    }
    handleTab() {
        const input = this.getInput();
        const matches = this.commands.filter((cmd)=>cmd.startsWith(input));
        if (matches.length === 1) {
            this.setInput(matches[0] + ' ');
        } else if (matches.length > 1) {
            this.writeLine(`Available commands: ${matches.join(', ')}`, 'info');
        }
    }
    handleInput() {
        this.emit('input_change', this.getInput());
    }
    handleInterrupt() {
        this.writeLine('^C', 'warning');
        this.clearInput();
        this.emit('interrupt');
    }
    setupScrollBehavior() {
        let isUserScrolling = false;
        let scrollTimeout;
        let lastScrollTop = 0;
        this.outputElement.addEventListener('scroll', ()=>{
            const currentScrollTop = this.outputElement.scrollTop;
            const maxScrollTop = this.outputElement.scrollHeight - this.outputElement.clientHeight;
            if (currentScrollTop < lastScrollTop && currentScrollTop < maxScrollTop - 10) {
                isUserScrolling = true;
                this.showScrollIndicator();
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(()=>{
                    const newScrollTop = this.outputElement.scrollTop;
                    const newMaxScrollTop = this.outputElement.scrollHeight - this.outputElement.clientHeight;
                    if (newScrollTop >= newMaxScrollTop - 50) {
                        isUserScrolling = false;
                        this.hideScrollIndicator();
                    }
                }, 3000);
            } else if (currentScrollTop >= maxScrollTop - 10) {
                isUserScrolling = false;
                this.hideScrollIndicator();
                clearTimeout(scrollTimeout);
            }
            lastScrollTop = currentScrollTop;
        });
        const originalShouldAutoScroll = this.shouldAutoScroll;
        this.shouldAutoScroll = ()=>{
            return originalShouldAutoScroll.call(this) && !isUserScrolling;
        };
        this.isUserScrolling = ()=>isUserScrolling;
        this.resumeAutoScroll = ()=>{
            isUserScrolling = false;
            this.hideScrollIndicator();
            this.scrollToBottom(true);
        };
    }
    showScrollIndicator() {
        let indicator = document.getElementById('scrollIndicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'scrollIndicator';
            indicator.className = 'scroll-indicator';
            indicator.innerHTML = `
        <span class="scroll-text">Auto-scroll paused</span>
        <button class="scroll-resume-btn" onclick="window.claudeConsole.terminal.resumeAutoScroll()">
          ↓ Resume
        </button>
      `;
            const consoleContainer = this.outputElement.closest('.console-container');
            if (consoleContainer) {
                consoleContainer.appendChild(indicator);
            } else {
                document.body.appendChild(indicator);
            }
        }
        indicator.style.display = 'flex';
    }
    hideScrollIndicator() {
        const indicator = document.getElementById('scrollIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    async streamText(text, delay = 10) {
        const entry = this.createOutputEntry('', 'output', true);
        this.outputElement.appendChild(entry);
        const contentElement = entry.querySelector('.output-content');
        for(let i = 0; i < text.length; i++){
            contentElement.textContent += text[i];
            this.scrollToBottom();
            if (delay > 0) {
                await new Promise((resolve)=>setTimeout(resolve, delay));
            }
        }
        return entry;
    }
    on(event, callback) {
        if (!this.eventListeners) {
            this.eventListeners = new Map();
        }
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    emit(event, data) {
        if (!this.eventListeners || !this.eventListeners.has(event)) {
            return;
        }
        this.eventListeners.get(event).forEach((callback)=>{
            try {
                callback(data);
            } catch (error) {
                console.error('Error in terminal event listener:', error);
            }
        });
    }
    setMaxLines(maxLines) {
        this.maxOutputLines = Math.max(100, Math.min(10000, maxLines));
        this.limitOutputLines();
    }
    getStats() {
        const entries = this.outputElement.querySelectorAll('.output-entry');
        return {
            totalLines: entries.length,
            historySize: this.history.length,
            isLocked: this.isLocked,
            currentPrompt: this.currentPrompt
        };
    }
    exportHistory() {
        const entries = Array.from(this.outputElement.querySelectorAll('.output-entry'));
        return entries.map((entry)=>{
            const timestamp = entry.querySelector('.output-timestamp')?.textContent || '';
            const content = entry.querySelector('.output-content')?.textContent || '';
            const type = entry.querySelector('.output-content')?.className.split(' ').find((c)=>c.startsWith('output-')) || '';
            return {
                timestamp,
                content,
                type
            };
        });
    }
    importHistory(history) {
        this.clear();
        history.forEach(({ timestamp, content, type })=>{
            this.write(content, type.replace('output-', ''), false);
        });
    }
}

//# sourceMappingURL=terminal-emulator.js.map