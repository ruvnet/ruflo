"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var vscode_bridge_exports = {};
__export(vscode_bridge_exports, {
  createCapturedTerminal: () => createCapturedTerminal,
  disposeTerminalBridge: () => disposeTerminalBridge,
  executeTerminalCommand: () => executeTerminalCommand,
  getTerminalById: () => getTerminalById,
  initializeTerminalBridge: () => initializeTerminalBridge
});
module.exports = __toCommonJS(vscode_bridge_exports);
var vscode = __toESM(require("vscode"), 1);
const terminalOutputProcessors = /* @__PURE__ */ new Map();
const activeTerminals = /* @__PURE__ */ new Map();
const terminalWriteEmulators = /* @__PURE__ */ new Map();
function initializeTerminalBridge(context) {
  globalThis.vscode = vscode;
  globalThis.registerTerminalOutputProcessor = (terminalId, processor) => {
    terminalOutputProcessors.set(terminalId, processor);
  };
  const originalCreateTerminal = vscode.window.createTerminal;
  vscode.window.createTerminal = function(options) {
    const terminal = originalCreateTerminal.call(vscode.window, options);
    const writeEmulator = new vscode.EventEmitter();
    terminalWriteEmulators.set(terminal, writeEmulator);
    const match = options.name?.match(/Claude-Flow Terminal ([\w-]+)/);
    if (match) {
      const terminalId = match[1];
      activeTerminals.set(terminalId, terminal);
      captureTerminalOutput(terminal, terminalId);
    }
    return terminal;
  };
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [id, term] of activeTerminals.entries()) {
        if (term === terminal) {
          activeTerminals.delete(id);
          terminalOutputProcessors.delete(id);
          break;
        }
      }
      const emulator = terminalWriteEmulators.get(terminal);
      if (emulator) {
        emulator.dispose();
        terminalWriteEmulators.delete(terminal);
      }
    })
  );
}
__name(initializeTerminalBridge, "initializeTerminalBridge");
function captureTerminalOutput(terminal, terminalId) {
  const originalSendText = terminal.sendText;
  terminal.sendText = function(text, addNewLine) {
    originalSendText.call(terminal, text, addNewLine);
    const processor = terminalOutputProcessors.get(terminalId);
    if (processor && text) {
      processor(text + (addNewLine !== false ? "\n" : ""));
    }
  };
  if ("onDidWriteData" in terminal) {
    const writeDataEvent = terminal.onDidWriteData;
    if (writeDataEvent) {
      writeDataEvent((data) => {
        const processor = terminalOutputProcessors.get(terminalId);
        if (processor) {
          processor(data);
        }
      });
    }
  }
  setupTerminalRenderer(terminal, terminalId);
}
__name(captureTerminalOutput, "captureTerminalOutput");
function setupTerminalRenderer(terminal, terminalId) {
  if (vscode.window.registerTerminalProfileProvider) {
    let lastOutput = "";
    const checkOutput = setInterval(() => {
      if (!activeTerminals.has(terminalId)) {
        clearInterval(checkOutput);
      }
    }, 100);
  }
}
__name(setupTerminalRenderer, "setupTerminalRenderer");
async function createCapturedTerminal(name, shellPath, shellArgs) {
  const writeEmulator = new vscode.EventEmitter();
  const terminal = vscode.window.createTerminal({
    name,
    shellPath,
    shellArgs
  });
  terminalWriteEmulators.set(terminal, writeEmulator);
  return {
    terminal,
    onData: writeEmulator.event
  };
}
__name(createCapturedTerminal, "createCapturedTerminal");
async function executeTerminalCommand(terminal, command, timeout = 3e4) {
  return new Promise((resolve, reject) => {
    const writeEmulator = terminalWriteEmulators.get(terminal);
    if (!writeEmulator) {
      reject(new Error("No write emulator for terminal"));
      return;
    }
    let output = "";
    const marker = `__COMMAND_COMPLETE_${Date.now()}__`;
    const disposable = writeEmulator.event((data) => {
      output += data;
      if (output.includes(marker)) {
        disposable.dispose();
        const result = output.substring(0, output.indexOf(marker));
        resolve(result);
      }
    });
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error("Command timeout"));
    }, timeout);
    terminal.sendText(`${command} && echo "${marker}"`);
    writeEmulator.event(() => {
      if (output.includes(marker)) {
        clearTimeout(timer);
      }
    });
  });
}
__name(executeTerminalCommand, "executeTerminalCommand");
function getTerminalById(terminalId) {
  return activeTerminals.get(terminalId);
}
__name(getTerminalById, "getTerminalById");
function disposeTerminalBridge() {
  for (const terminal of activeTerminals.values()) {
    terminal.dispose();
  }
  activeTerminals.clear();
  terminalOutputProcessors.clear();
  for (const emulator of terminalWriteEmulators.values()) {
    emulator.dispose();
  }
  terminalWriteEmulators.clear();
}
__name(disposeTerminalBridge, "disposeTerminalBridge");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createCapturedTerminal,
  disposeTerminalBridge,
  executeTerminalCommand,
  getTerminalById,
  initializeTerminalBridge
});
//# sourceMappingURL=vscode-bridge.js.map
