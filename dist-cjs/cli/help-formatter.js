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
var help_formatter_exports = {};
__export(help_formatter_exports, {
  HelpFormatter: () => HelpFormatter
});
module.exports = __toCommonJS(help_formatter_exports);
class HelpFormatter {
  static {
    __name(this, "HelpFormatter");
  }
  static INDENT = "    ";
  static COLUMN_GAP = 2;
  static MIN_DESCRIPTION_COLUMN = 25;
  /**
   * Format main command help
   */
  static formatHelp(info) {
    const sections = [];
    sections.push(this.formatSection("NAME", [`${info.name} - ${info.description}`]));
    if (info.usage) {
      sections.push(this.formatSection("SYNOPSIS", [info.usage]));
    }
    if (info.commands && info.commands.length > 0) {
      sections.push(this.formatSection("COMMANDS", this.formatCommands(info.commands)));
    }
    if (info.options && info.options.length > 0) {
      sections.push(this.formatSection("OPTIONS", this.formatOptions(info.options)));
    }
    if (info.globalOptions && info.globalOptions.length > 0) {
      sections.push(this.formatSection("GLOBAL OPTIONS", this.formatOptions(info.globalOptions)));
    }
    if (info.examples && info.examples.length > 0) {
      sections.push(this.formatSection("EXAMPLES", info.examples));
    }
    if (info.commands && info.commands.length > 0) {
      sections.push(`Run '${info.name} <command> --help' for more information on a command.`);
    }
    return sections.join("\n\n");
  }
  /**
   * Format error message with usage hint
   */
  static formatError(error, command, usage) {
    const lines = [`Error: ${error}`, ""];
    if (usage) {
      lines.push(`Usage: ${usage}`);
    }
    lines.push(`Try '${command} --help' for more information.`);
    return lines.join("\n");
  }
  /**
   * Format validation error with valid options
   */
  static formatValidationError(value, paramName, validOptions, command) {
    return this.formatError(
      `'${value}' is not a valid ${paramName}. Valid options are: ${validOptions.join(", ")}.`,
      command
    );
  }
  static formatSection(title, content) {
    return `${title}
${content.map((line) => `${this.INDENT}${line}`).join("\n")}`;
  }
  static formatCommands(commands) {
    const maxNameLength = Math.max(
      this.MIN_DESCRIPTION_COLUMN,
      ...commands.map((cmd) => {
        const nameLength = cmd.name.length;
        const aliasLength = cmd.aliases ? ` (${cmd.aliases.join(", ")})`.length : 0;
        return nameLength + aliasLength;
      })
    );
    return commands.map((cmd) => {
      let name = cmd.name;
      if (cmd.aliases && cmd.aliases.length > 0) {
        name += ` (${cmd.aliases.join(", ")})`;
      }
      const padding = " ".repeat(maxNameLength - name.length + this.COLUMN_GAP);
      return `${name}${padding}${cmd.description}`;
    });
  }
  static formatOptions(options) {
    const maxFlagsLength = Math.max(
      this.MIN_DESCRIPTION_COLUMN,
      ...options.map((opt) => opt.flags.length)
    );
    return options.map((opt) => {
      const padding = " ".repeat(maxFlagsLength - opt.flags.length + this.COLUMN_GAP);
      let description = opt.description;
      if (opt.defaultValue !== void 0) {
        description += ` [default: ${opt.defaultValue}]`;
      }
      if (opt.validValues && opt.validValues.length > 0) {
        const validValuesLine = " ".repeat(maxFlagsLength + this.COLUMN_GAP) + `Valid: ${opt.validValues.join(", ")}`;
        return `${opt.flags}${padding}${description}
${this.INDENT}${validValuesLine}`;
      }
      return `${opt.flags}${padding}${description}`;
    });
  }
  /**
   * Strip ANSI color codes and emojis from text
   */
  static stripFormatting(text) {
    text = text.replace(/\x1b\[[0-9;]*m/g, "");
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{1F000}-\u{1F6FF}]|[\u{1F680}-\u{1F6FF}]/gu;
    text = text.replace(emojiPattern, "").trim();
    text = text.replace(/\s+/g, " ");
    return text;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HelpFormatter
});
//# sourceMappingURL=help-formatter.js.map
