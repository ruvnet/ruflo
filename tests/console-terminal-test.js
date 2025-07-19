/**
 * Console Terminal Comprehensive Test Suite
 * Tests all functionality of the Gemini Code Console Terminal
 */

import puppeteer from 'puppeteer';
import { printSuccess, printError, printWarning, printInfo } from '../src/cli/utils.js';

class ConsoleTerminalTester {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = {
      passed: [],
      failed: [],
      warnings: []
    };
  }

  async init() {
    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.page = await this.browser.newPage();
      
      // Set viewport
      await this.page.setViewport({ width: 1280, height: 800 });
      
      // Navigate to console
      await this.page.goto('http://localhost:3002/console/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait for console to load
      await this.page.waitForSelector('.console-input', { timeout: 10000 });
      
      printSuccess('Console Terminal loaded successfully');
      this.addResult('passed', 'Console loads successfully');
      
    } catch (error) {
      this.addResult('failed', `Failed to initialize console: ${error.message}`);
      throw error;
    }
  }

  addResult(type, message) {
    this.results[type].push({
      message,
      timestamp: new Date().toISOString()
    });
  }

  async testCommandInput() {
    console.log('\n📝 Testing Command Input...');
    
    try {
      // Test help command
      await this.typeCommand('help');
      await this.page.waitForFunction(() => true, { timeout: 1000 }).catch(() => {});
      
      const helpOutput = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        return output ? output.textContent : '';
      });
      
      if (helpOutput.includes('Available commands:')) {
        this.addResult('passed', 'Help command displays command list');
      } else {
        this.addResult('failed', 'Help command did not display expected output');
      }
      
      // Test clear command
      await this.typeCommand('clear');
      await new Promise(r => setTimeout(r, 500));
      
      const clearedOutput = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        return output ? output.children.length : -1;
      });
      
      if (clearedOutput < 3) {
        this.addResult('passed', 'Clear command clears console');
      } else {
        this.addResult('failed', 'Clear command did not clear console');
      }
      
      // Test status command
      await this.typeCommand('status');
      await this.page.waitForFunction(() => true, { timeout: 1000 }).catch(() => {});
      
      const statusOutput = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        return output ? output.textContent : '';
      });
      
      if (statusOutput.includes('System Status')) {
        this.addResult('passed', 'Status command displays system status');
      } else {
        this.addResult('failed', 'Status command did not display expected output');
      }
      
      // Test invalid command
      await this.typeCommand('invalidcommand123');
      await new Promise(r => setTimeout(r, 500));
      
      const errorOutput = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        const lastEntry = output.lastElementChild;
        return lastEntry ? lastEntry.textContent : '';
      });
      
      if (errorOutput.includes('Unknown command') || errorOutput.includes('error')) {
        this.addResult('passed', 'Invalid commands show error message');
      } else {
        this.addResult('failed', 'Invalid command did not show error');
      }
      
    } catch (error) {
      this.addResult('failed', `Command input test failed: ${error.message}`);
    }
  }

  async testCommandHistory() {
    console.log('\n📜 Testing Command History...');
    
    try {
      // Clear console first
      await this.typeCommand('clear');
      await new Promise(r => setTimeout(r, 500));
      
      // Type several commands
      const testCommands = ['help', 'status', 'ls', 'pwd'];
      for (const cmd of testCommands) {
        await this.typeCommand(cmd);
        await new Promise(r => setTimeout(r, 300));
      }
      
      // Test UP arrow navigation
      await this.page.keyboard.press('ArrowUp');
      await new Promise(r => setTimeout(r, 100));
      
      const upValue = await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        return input ? input.value : '';
      });
      
      if (upValue === 'pwd') {
        this.addResult('passed', 'UP arrow navigates to previous command');
      } else {
        this.addResult('failed', 'UP arrow did not navigate history correctly');
      }
      
      // Test multiple UP arrows
      await this.page.keyboard.press('ArrowUp');
      await this.page.keyboard.press('ArrowUp');
      await new Promise(r => setTimeout(r, 100));
      
      const multiUpValue = await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        return input ? input.value : '';
      });
      
      if (multiUpValue === 'status') {
        this.addResult('passed', 'Multiple UP arrows navigate history correctly');
      } else {
        this.addResult('failed', 'Multiple UP arrows did not work correctly');
      }
      
      // Test DOWN arrow
      await this.page.keyboard.press('ArrowDown');
      await new Promise(r => setTimeout(r, 100));
      
      const downValue = await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        return input ? input.value : '';
      });
      
      if (downValue === 'ls') {
        this.addResult('passed', 'DOWN arrow navigates forward in history');
      } else {
        this.addResult('failed', 'DOWN arrow did not navigate correctly');
      }
      
    } catch (error) {
      this.addResult('failed', `Command history test failed: ${error.message}`);
    }
  }

  async testKeyboardShortcuts() {
    console.log('\n⌨️  Testing Keyboard Shortcuts...');
    
    try {
      // Test Ctrl+L clear
      await this.typeCommand('test message 1');
      await this.typeCommand('test message 2');
      await new Promise(r => setTimeout(r, 500));
      
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('l');
      await this.page.keyboard.up('Control');
      await new Promise(r => setTimeout(r, 500));
      
      const afterCtrlL = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        return output ? output.children.length : -1;
      });
      
      if (afterCtrlL < 3) {
        this.addResult('passed', 'Ctrl+L clears console');
      } else {
        this.addResult('failed', 'Ctrl+L did not clear console');
      }
      
      // Test Tab autocomplete (if implemented)
      await this.page.type('.console-input', 'hel');
      await this.page.keyboard.press('Tab');
      await new Promise(r => setTimeout(r, 200));
      
      const tabComplete = await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        return input ? input.value : '';
      });
      
      if (tabComplete === 'help' || tabComplete === 'hel') {
        if (tabComplete === 'help') {
          this.addResult('passed', 'Tab autocomplete works');
        } else {
          this.addResult('warnings', 'Tab autocomplete not implemented');
        }
      }
      
      // Test Ctrl+C interrupt
      await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        if (input) input.value = 'long running command';
      });
      
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('c');
      await this.page.keyboard.up('Control');
      await new Promise(r => setTimeout(r, 200));
      
      const afterCtrlC = await this.page.evaluate(() => {
        const input = document.querySelector('.console-input');
        return input ? input.value : 'not empty';
      });
      
      if (afterCtrlC === '') {
        this.addResult('passed', 'Ctrl+C clears current input');
      } else {
        this.addResult('warnings', 'Ctrl+C behavior not as expected');
      }
      
    } catch (error) {
      this.addResult('failed', `Keyboard shortcuts test failed: ${error.message}`);
    }
  }

  async testVisualFeatures() {
    console.log('\n🎨 Testing Visual Features...');
    
    try {
      // Test welcome message
      await this.page.reload();
      await this.page.waitForSelector('.console-output', { timeout: 10000 });
      await this.page.waitForFunction(() => true, { timeout: 1000 }).catch(() => {});
      
      const welcomePresent = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        return output ? output.textContent.includes('Welcome') || output.textContent.includes('Claude') : false;
      });
      
      if (welcomePresent) {
        this.addResult('passed', 'Welcome message displays correctly');
      } else {
        this.addResult('warnings', 'Welcome message not found');
      }
      
      // Test timestamps
      await this.typeCommand('echo test');
      await new Promise(r => setTimeout(r, 500));
      
      const hasTimestamp = await this.page.evaluate(() => {
        const entries = document.querySelectorAll('.console-entry');
        if (entries.length === 0) return false;
        const lastEntry = entries[entries.length - 1];
        return lastEntry.querySelector('.timestamp') !== null || 
               lastEntry.textContent.includes(':') ||
               lastEntry.querySelector('[class*="time"]') !== null;
      });
      
      if (hasTimestamp) {
        this.addResult('passed', 'Timestamps show for commands');
      } else {
        this.addResult('warnings', 'Timestamps not visible');
      }
      
      // Test color coding
      const hasColors = await this.page.evaluate(() => {
        const entries = document.querySelectorAll('.console-entry, .console-output > div');
        for (const entry of entries) {
          const style = window.getComputedStyle(entry);
          if (style.color !== 'rgb(0, 0, 0)' && style.color !== '') {
            return true;
          }
        }
        return false;
      });
      
      if (hasColors) {
        this.addResult('passed', 'Color coding for output types works');
      } else {
        this.addResult('warnings', 'Color coding not detected');
      }
      
      // Test auto-scroll
      for (let i = 0; i < 20; i++) {
        await this.typeCommand(`echo line ${i}`);
        await new Promise(r => setTimeout(r, 100));
      }
      
      const isScrolledDown = await this.page.evaluate(() => {
        const output = document.querySelector('.console-output');
        if (!output) return false;
        const tolerance = 50;
        return output.scrollTop + output.clientHeight >= output.scrollHeight - tolerance;
      });
      
      if (isScrolledDown) {
        this.addResult('passed', 'Auto-scroll behavior works correctly');
      } else {
        this.addResult('failed', 'Auto-scroll not working');
      }
      
    } catch (error) {
      this.addResult('failed', `Visual features test failed: ${error.message}`);
    }
  }

  async testStatusBar() {
    console.log('\n📊 Testing Status Bar...');
    
    try {
      // Check for status bar elements
      const statusElements = await this.page.evaluate(() => {
        const results = {};
        
        // Look for uptime
        const uptimeEl = document.querySelector('[id*="uptime"], [class*="uptime"], [data-uptime]');
        results.hasUptime = uptimeEl !== null;
        results.uptimeText = uptimeEl ? uptimeEl.textContent : '';
        
        // Look for agent count
        const agentEl = document.querySelector('[id*="agent"], [class*="agent"], [data-agents]');
        results.hasAgentCount = agentEl !== null;
        results.agentText = agentEl ? agentEl.textContent : '';
        
        // Look for message count
        const msgEl = document.querySelector('[id*="message"], [class*="message"], [data-messages]');
        results.hasMessageCount = msgEl !== null;
        results.messageText = msgEl ? msgEl.textContent : '';
        
        return results;
      });
      
      if (statusElements.hasUptime) {
        this.addResult('passed', 'Uptime counter present');
      } else {
        this.addResult('warnings', 'Uptime counter not found');
      }
      
      if (statusElements.hasAgentCount) {
        this.addResult('passed', 'Agent count display present');
      } else {
        this.addResult('warnings', 'Agent count display not found');
      }
      
      if (statusElements.hasMessageCount) {
        this.addResult('passed', 'Message count display present');
      } else {
        this.addResult('warnings', 'Message count display not found');
      }
      
      // Test if values update
      await new Promise(r => setTimeout(r, 2000));
      
      const updatedUptime = await this.page.evaluate(() => {
        const uptimeEl = document.querySelector('[id*="uptime"], [class*="uptime"], [data-uptime]');
        return uptimeEl ? uptimeEl.textContent : '';
      });
      
      if (updatedUptime !== statusElements.uptimeText && statusElements.uptimeText !== '') {
        this.addResult('passed', 'Uptime counter updates');
      } else if (statusElements.hasUptime) {
        this.addResult('warnings', 'Uptime counter may not be updating');
      }
      
    } catch (error) {
      this.addResult('failed', `Status bar test failed: ${error.message}`);
    }
  }

  async testHeaderButtons() {
    console.log('\n🔘 Testing Header Buttons...');
    
    try {
      // Test clear button
      await this.typeCommand('test1');
      await this.typeCommand('test2');
      await new Promise(r => setTimeout(r, 500));
      
      const clearButton = await this.page.$('#clearConsole') || await this.page.$('button[aria-label*="Clear"]');
      if (clearButton) {
        await clearButton.click();
        await new Promise(r => setTimeout(r, 500));
        
        const afterClear = await this.page.evaluate(() => {
          const output = document.querySelector('.console-output');
          return output ? output.children.length : -1;
        });
        
        if (afterClear < 3) {
          this.addResult('passed', 'Clear button functionality works');
        } else {
          this.addResult('failed', 'Clear button did not clear console');
        }
      } else {
        this.addResult('warnings', 'Clear button not found');
      }
      
      // Test fullscreen toggle
      const fullscreenButton = await this.page.$('#fullscreenToggle') || await this.page.$('button[aria-label*="Fullscreen"]');
      if (fullscreenButton) {
        await fullscreenButton.click();
        await new Promise(r => setTimeout(r, 500));
        
        const isFullscreen = await this.page.evaluate(() => {
          return document.fullscreenElement !== null || 
                 document.body.classList.contains('fullscreen') ||
                 document.documentElement.classList.contains('fullscreen');
        });
        
        if (isFullscreen) {
          this.addResult('passed', 'Fullscreen toggle works');
          // Exit fullscreen
          await fullscreenButton.click();
        } else {
          this.addResult('warnings', 'Fullscreen functionality may not be working');
        }
      } else {
        this.addResult('warnings', 'Fullscreen button not found');
      }
      
    } catch (error) {
      this.addResult('failed', `Header buttons test failed: ${error.message}`);
    }
  }

  async typeCommand(command) {
    // Clear input first
    await this.page.evaluate(() => {
      const input = document.querySelector('.console-input');
      if (input) input.value = '';
    });
    
    // Type command
    await this.page.type('.console-input', command);
    
    // Press Enter
    await this.page.keyboard.press('Enter');
  }

  async generateReport() {
    console.log('\n📋 Test Report Summary');
    console.log('='.repeat(50));
    
    const total = this.results.passed.length + this.results.failed.length + this.results.warnings.length;
    
    console.log(`✅ Passed: ${this.results.passed.length}/${total}`);
    console.log(`❌ Failed: ${this.results.failed.length}/${total}`);
    console.log(`⚠️  Warnings: ${this.results.warnings.length}/${total}`);
    
    if (this.results.passed.length > 0) {
      console.log('\n✅ Passed Tests:');
      this.results.passed.forEach(test => {
        console.log(`   - ${test.message}`);
      });
    }
    
    if (this.results.failed.length > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.failed.forEach(test => {
        console.log(`   - ${test.message}`);
      });
    }
    
    if (this.results.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.results.warnings.forEach(test => {
        console.log(`   - ${test.message}`);
      });
    }
    
    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total,
        passed: this.results.passed.length,
        failed: this.results.failed.length,
        warnings: this.results.warnings.length
      },
      results: this.results
    };
    
    return report;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      console.log('🚀 Starting Console Terminal Test Suite');
      console.log('='.repeat(50));
      
      await this.init();
      
      // Run all tests
      await this.testCommandInput();
      await this.testCommandHistory();
      await this.testKeyboardShortcuts();
      await this.testVisualFeatures();
      await this.testStatusBar();
      await this.testHeaderButtons();
      
      // Generate and display report
      const report = await this.generateReport();
      
      // Save report to file
      const fs = await import('fs/promises');
      await fs.writeFile(
        '/workspaces/gemini-flow/tests/console-terminal-test-report.json',
        JSON.stringify(report, null, 2)
      );
      
      console.log('\n📄 Detailed report saved to: tests/console-terminal-test-report.json');
      
    } catch (error) {
      printError(`Test suite failed: ${error.message}`);
      console.error(error);
    } finally {
      await this.cleanup();
    }
  }
}

// Run the test
const tester = new ConsoleTerminalTester();
tester.run();