"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var vscode_exports = {};
__export(vscode_exports, {
  VSCodeAdapter: () => VSCodeAdapter
});
module.exports = __toCommonJS(vscode_exports);
var import_os = require("os");
var import_errors = require("../../utils/errors.js");
var import_helpers = require("../../utils/helpers.js");
class VSCodeTerminalWrapper {
  constructor(vscodeApi, shellType, logger) {
    this.vscodeApi = vscodeApi;
    this.shellType = shellType;
    this.logger = logger;
    this.id = (0, import_helpers.generateId)("vscode-term");
    this.commandMarker = `__CLAUDE_FLOW_${this.id}__`;
  }
  static {
    __name(this, "VSCodeTerminalWrapper");
  }
  id;
  pid;
  vscodeTerminal;
  outputBuffer = "";
  commandMarker;
  outputDeferred = (0, import_helpers.createDeferred)();
  isDisposed = false;
  async initialize() {
    try {
      const shellPath = this.getShellPath();
      const terminalOptions = {
        name: `Claude-Flow Terminal ${this.id}`,
        shellArgs: this.getShellArgs(),
        env: {
          CLAUDE_FLOW_TERMINAL: "true",
          CLAUDE_FLOW_TERMINAL_ID: this.id,
          PS1: "$ "
          // Simple prompt
        }
      };
      if (shellPath !== void 0) {
        terminalOptions.shellPath = shellPath;
      }
      this.vscodeTerminal = this.vscodeApi.window.createTerminal(terminalOptions);
      const processId = await this.vscodeTerminal.processId;
      if (processId !== void 0) {
        this.pid = processId;
      }
      this.vscodeTerminal.show(true);
      await this.waitForReady();
      this.logger.debug("VSCode terminal initialized", { id: this.id, pid: this.pid });
    } catch (error) {
      throw new import_errors.TerminalError("Failed to create VSCode terminal", { error });
    }
  }
  async executeCommand(command) {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new import_errors.TerminalError("Terminal is not alive");
    }
    try {
      this.outputBuffer = "";
      this.outputDeferred = (0, import_helpers.createDeferred)();
      const markedCommand = `${command} && echo "${this.commandMarker}"`;
      this.vscodeTerminal.sendText(markedCommand, true);
      const output = await (0, import_helpers.timeout)(this.outputDeferred.promise, 3e4, "Command execution timeout");
      return output;
    } catch (error) {
      throw new import_errors.TerminalError("Failed to execute command", { command, error });
    }
  }
  async write(data) {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new import_errors.TerminalError("Terminal is not alive");
    }
    this.vscodeTerminal.sendText(data, false);
  }
  async read() {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new import_errors.TerminalError("Terminal is not alive");
    }
    const output = this.outputBuffer;
    this.outputBuffer = "";
    return output;
  }
  isAlive() {
    return !this.isDisposed && this.vscodeTerminal !== void 0;
  }
  async kill() {
    if (this.vscodeTerminal && !this.isDisposed) {
      try {
        this.vscodeTerminal.sendText("exit", true);
        await (0, import_helpers.delay)(500);
        this.vscodeTerminal.dispose();
        this.isDisposed = true;
      } catch (error) {
        this.logger.warn("Error killing VSCode terminal", { id: this.id, error });
      }
    }
  }
  /**
   * Process terminal output (called by extension)
   */
  processOutput(data) {
    this.outputBuffer += data;
    const markerIndex = this.outputBuffer.indexOf(this.commandMarker);
    if (markerIndex !== -1) {
      const output = this.outputBuffer.substring(0, markerIndex).trim();
      this.outputBuffer = this.outputBuffer.substring(markerIndex + this.commandMarker.length).trim();
      this.outputDeferred.resolve(output);
    }
  }
  getShellPath() {
    switch (this.shellType) {
      case "bash":
        return "/bin/bash";
      case "zsh":
        return "/bin/zsh";
      case "powershell":
        return (0, import_os.platform)() === "win32" ? "powershell.exe" : "pwsh";
      case "cmd":
        return (0, import_os.platform)() === "win32" ? "cmd.exe" : void 0;
      default:
        return void 0;
    }
  }
  getShellArgs() {
    switch (this.shellType) {
      case "bash":
        return ["--norc", "--noprofile"];
      case "zsh":
        return ["--no-rcs"];
      case "powershell":
        return ["-NoProfile", "-NonInteractive"];
      case "cmd":
        return ["/Q"];
      default:
        return [];
    }
  }
  async waitForReady() {
    this.vscodeTerminal.sendText('echo "READY"', true);
    const startTime = Date.now();
    while (Date.now() - startTime < 5e3) {
      if (this.outputBuffer.includes("READY")) {
        this.outputBuffer = "";
        return;
      }
      await (0, import_helpers.delay)(100);
    }
    throw new import_errors.TerminalError("Terminal failed to become ready");
  }
}
class VSCodeAdapter {
  constructor(logger) {
    this.logger = logger;
    this.shellType = this.detectShell();
  }
  static {
    __name(this, "VSCodeAdapter");
  }
  terminals = /* @__PURE__ */ new Map();
  vscodeApi;
  shellType;
  terminalCloseListener;
  async initialize() {
    this.logger.info("Initializing VSCode terminal adapter");
    if (!this.isVSCodeExtensionContext()) {
      throw new import_errors.TerminalError("Not running in VSCode extension context");
    }
    this.vscodeApi = globalThis.vscode;
    if (!this.vscodeApi) {
      throw new import_errors.TerminalError("VSCode API not available");
    }
    this.terminalCloseListener = this.vscodeApi.window.onDidCloseTerminal((terminal) => {
      for (const [id, wrapper] of this.terminals.entries()) {
        if (wrapper.vscodeTerminal === terminal) {
          this.logger.info("VSCode terminal closed", { id });
          this.terminals.delete(id);
          break;
        }
      }
    });
    this.logger.info("VSCode terminal adapter initialized");
  }
  async shutdown() {
    this.logger.info("Shutting down VSCode terminal adapter");
    if (this.terminalCloseListener) {
      this.terminalCloseListener.dispose();
    }
    const terminals = Array.from(this.terminals.values());
    await Promise.all(terminals.map((term) => term.kill()));
    this.terminals.clear();
  }
  async createTerminal() {
    if (!this.vscodeApi) {
      throw new import_errors.TerminalError("VSCode API not initialized");
    }
    const terminal = new VSCodeTerminalWrapper(this.vscodeApi, this.shellType, this.logger);
    await terminal.initialize();
    this.terminals.set(terminal.id, terminal);
    const outputProcessor = globalThis.registerTerminalOutputProcessor;
    if (outputProcessor) {
      outputProcessor(terminal.id, (data) => terminal.processOutput(data));
    }
    return terminal;
  }
  async destroyTerminal(terminal) {
    await terminal.kill();
    this.terminals.delete(terminal.id);
  }
  isVSCodeExtensionContext() {
    return typeof globalThis.vscode !== "undefined" && typeof globalThis.vscode.window !== "undefined";
  }
  detectShell() {
    const osplatform = (0, import_os.platform)();
    if (osplatform === "win32") {
      const comspec = process.env.COMSPEC;
      if (comspec?.toLowerCase().includes("powershell")) {
        return "powershell";
      }
      return "cmd";
    } else {
      const shell = process.env.SHELL;
      if (shell) {
        const shellName = shell.split("/").pop();
        if (shellName && ["bash", "zsh", "fish", "sh"].includes(shellName)) {
          return shellName;
        }
      }
      return "bash";
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VSCodeAdapter
});
//# sourceMappingURL=vscode.js.map
