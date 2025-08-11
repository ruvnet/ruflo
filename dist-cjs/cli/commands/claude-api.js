"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var claude_api_exports = {};
__export(claude_api_exports, {
  claudeApiCommand: () => claudeApiCommand
});
module.exports = __toCommonJS(claude_api_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_commander = require("commander");
var import_config_manager = require("../../config/config-manager.js");
var import_claude_client = require("../../api/claude-client.js");
var import_logger = require("../../core/logger.js");
var import_error_handler = require("../../utils/error-handler.js");
const claudeApiCommand = new import_commander.Command().name("claude-api").description("Manage Claude API configuration and test connectivity").action(() => {
  claudeApiCommand.help();
});
claudeApiCommand.command("configure").description("Configure Claude API settings").option("--api-key <key>", "Claude API key").option("--model <model>", "Claude model to use").option("--temperature <temp>", "Temperature (0.0-1.0)", parseFloat).option("--max-tokens <tokens>", "Maximum tokens", parseInt).option("--interactive", "Interactive configuration").action(async (options) => {
  try {
    const configManager = import_config_manager.ConfigManager.getInstance();
    let config = configManager.getClaudeConfig();
    if (options.interactive) {
      console.log(import_chalk.default.blue("\u{1F916} Claude API Configuration"));
      console.log("Configure your Claude API settings.\n");
      const answers = await import_inquirer.default.prompt([
        {
          type: "input",
          name: "apiKey",
          message: "Enter your Claude API key:",
          default: config.apiKey || process.env.ANTHROPIC_API_KEY,
          validate: (input) => input ? true : "API key is required"
        },
        {
          type: "list",
          name: "model",
          message: "Select Claude model:",
          choices: [
            { name: "Claude 3 Opus (Most capable)", value: "claude-3-opus-20240229" },
            { name: "Claude 3 Sonnet (Balanced)", value: "claude-3-sonnet-20240229" },
            { name: "Claude 3 Haiku (Fastest)", value: "claude-3-haiku-20240307" },
            { name: "Claude 2.1", value: "claude-2.1" },
            { name: "Claude 2.0", value: "claude-2.0" },
            { name: "Claude Instant 1.2", value: "claude-instant-1.2" }
          ],
          default: config.model || "claude-3-sonnet-20240229"
        },
        {
          type: "input",
          name: "temperature",
          message: "Temperature (0.0-1.0):",
          default: config.temperature?.toString() || "0.7",
          validate: (input) => {
            const num = parseFloat(input);
            return num >= 0 && num <= 1 ? true : "Temperature must be between 0.0 and 1.0";
          },
          filter: (input) => parseFloat(input)
        },
        {
          type: "input",
          name: "maxTokens",
          message: "Maximum tokens:",
          default: config.maxTokens?.toString() || "4096",
          validate: (input) => {
            const num = parseInt(input);
            return num > 0 && num <= 1e5 ? true : "Max tokens must be between 1 and 100000";
          },
          filter: (input) => parseInt(input)
        }
      ]);
      config = { ...config, ...answers };
    } else {
      if (options.apiKey)
        config.apiKey = options.apiKey;
      if (options.model)
        config.model = options.model;
      if (options.temperature !== void 0)
        config.temperature = options.temperature;
      if (options.maxTokens !== void 0)
        config.maxTokens = options.maxTokens;
    }
    configManager.setClaudeConfig(config);
    await configManager.save();
    console.log(import_chalk.default.green("\u2705 Claude API configuration saved"));
    console.log(import_chalk.default.gray(`Model: ${config.model}`));
    console.log(import_chalk.default.gray(`Temperature: ${config.temperature}`));
    console.log(import_chalk.default.gray(`Max tokens: ${config.maxTokens}`));
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Failed to configure Claude API:"), (0, import_error_handler.getErrorMessage)(error));
    process.exit(1);
  }
});
claudeApiCommand.command("test").description("Test Claude API connectivity").option("--model <model>", "Model to test").option("--temperature <temp>", "Temperature for test", parseFloat).option(
  "--prompt <prompt>",
  "Test prompt",
  "Hello, Claude! Please respond with a brief greeting."
).action(async (options) => {
  try {
    const configManager = import_config_manager.ConfigManager.getInstance();
    if (!configManager.isClaudeAPIConfigured()) {
      console.error(import_chalk.default.red('\u274C Claude API not configured. Run "claude-api configure" first.'));
      process.exit(1);
    }
    console.log(import_chalk.default.blue("\u{1F9EA} Testing Claude API connectivity..."));
    const logger = new import_logger.Logger({ level: "info", format: "text", destination: "console" });
    const client = new import_claude_client.ClaudeAPIClient(logger, configManager);
    const testOptions = {};
    if (options.model)
      testOptions.model = options.model;
    if (options.temperature !== void 0)
      testOptions.temperature = options.temperature;
    const start = Date.now();
    const response = await client.complete(options.prompt, testOptions);
    const duration = Date.now() - start;
    console.log(import_chalk.default.green("\u2705 Claude API test successful!"));
    console.log(import_chalk.default.gray(`Duration: ${duration}ms`));
    console.log(import_chalk.default.cyan("\nResponse:"));
    console.log(response);
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Claude API test failed:"), (0, import_error_handler.getErrorMessage)(error));
    process.exit(1);
  }
});
claudeApiCommand.command("status").description("Show Claude API configuration status").action(async () => {
  try {
    const configManager = import_config_manager.ConfigManager.getInstance();
    const config = configManager.getClaudeConfig();
    const isConfigured = configManager.isClaudeAPIConfigured();
    console.log(import_chalk.default.blue("\u{1F916} Claude API Status\n"));
    if (isConfigured) {
      console.log(import_chalk.default.green("\u2705 Configured"));
      console.log(import_chalk.default.gray(`Model: ${config.model || "claude-3-sonnet-20240229"}`));
      console.log(import_chalk.default.gray(`Temperature: ${config.temperature ?? 0.7}`));
      console.log(import_chalk.default.gray(`Max tokens: ${config.maxTokens || 4096}`));
      console.log(import_chalk.default.gray(`API key: ${config.apiKey ? "***masked***" : "Not set"}`));
      if (process.env.ANTHROPIC_API_KEY && !config.apiKey) {
        console.log(
          import_chalk.default.yellow("\u26A0\uFE0F  Using API key from ANTHROPIC_API_KEY environment variable")
        );
      }
    } else {
      console.log(import_chalk.default.red("\u274C Not configured"));
      console.log(import_chalk.default.gray('Run "claude-api configure" to set up Claude API.'));
    }
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Failed to get status:"), (0, import_error_handler.getErrorMessage)(error));
    process.exit(1);
  }
});
claudeApiCommand.command("models").description("List available Claude models").action(() => {
  console.log(import_chalk.default.blue("\u{1F4CB} Available Claude Models\n"));
  const models = [
    {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      description: "Most capable model, best for complex tasks",
      contextWindow: "200K tokens"
    },
    {
      id: "claude-3-sonnet-20240229",
      name: "Claude 3 Sonnet",
      description: "Balanced performance and speed",
      contextWindow: "200K tokens"
    },
    {
      id: "claude-3-haiku-20240307",
      name: "Claude 3 Haiku",
      description: "Fastest model, best for simple tasks",
      contextWindow: "200K tokens"
    },
    {
      id: "claude-2.1",
      name: "Claude 2.1",
      description: "Previous generation, enhanced capabilities",
      contextWindow: "200K tokens"
    },
    {
      id: "claude-2.0",
      name: "Claude 2.0",
      description: "Previous generation model",
      contextWindow: "100K tokens"
    },
    {
      id: "claude-instant-1.2",
      name: "Claude Instant 1.2",
      description: "Fast, cost-effective model",
      contextWindow: "100K tokens"
    }
  ];
  models.forEach((model) => {
    console.log(import_chalk.default.cyan(`${model.name} (${model.id})`));
    console.log(import_chalk.default.gray(`  ${model.description}`));
    console.log(import_chalk.default.gray(`  Context: ${model.contextWindow}
`));
  });
});
claudeApiCommand.command("update").description("Update specific Claude API settings").option("--model <model>", "Update model").option("--temperature <temp>", "Update temperature", parseFloat).option("--max-tokens <tokens>", "Update max tokens", parseInt).action(async (options) => {
  try {
    const configManager = import_config_manager.ConfigManager.getInstance();
    if (!configManager.isClaudeAPIConfigured()) {
      console.error(import_chalk.default.red('\u274C Claude API not configured. Run "claude-api configure" first.'));
      process.exit(1);
    }
    const updates = {};
    if (options.model)
      updates.model = options.model;
    if (options.temperature !== void 0)
      updates.temperature = options.temperature;
    if (options.maxTokens !== void 0)
      updates.maxTokens = options.maxTokens;
    if (Object.keys(updates).length === 0) {
      console.log(
        import_chalk.default.yellow("\u26A0\uFE0F  No updates specified. Use --model, --temperature, or --max-tokens.")
      );
      return;
    }
    configManager.setClaudeConfig(updates);
    await configManager.save();
    console.log(import_chalk.default.green("\u2705 Claude API configuration updated"));
    Object.entries(updates).forEach(([key, value]) => {
      console.log(import_chalk.default.gray(`${key}: ${value}`));
    });
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Failed to update configuration:"), (0, import_error_handler.getErrorMessage)(error));
    process.exit(1);
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  claudeApiCommand
});
//# sourceMappingURL=claude-api.js.map
