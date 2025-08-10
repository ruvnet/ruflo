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
var formatters_exports = {};
__export(formatters_exports, {
  formatBytes: () => formatBytes,
  formatDuration: () => formatDuration,
  formatHealth: () => formatHealth,
  formatMetric: () => formatMetric,
  formatNumber: () => formatNumber,
  formatPercentage: () => formatPercentage,
  formatRate: () => formatRate,
  formatRelativeTime: () => formatRelativeTime,
  formatStatus: () => formatStatus,
  formatUptime: () => formatUptime,
  truncate: () => truncate
});
module.exports = __toCommonJS(formatters_exports);
function formatDuration(ms) {
  if (ms < 1e3)
    return `${ms}ms`;
  if (ms < 6e4)
    return `${Math.round(ms / 1e3)}s`;
  if (ms < 36e5)
    return `${Math.round(ms / 6e4)}m`;
  if (ms < 864e5)
    return `${Math.round(ms / 36e5)}h`;
  return `${Math.round(ms / 864e5)}d`;
}
__name(formatDuration, "formatDuration");
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
__name(formatBytes, "formatBytes");
function formatPercentage(value, decimals = 1) {
  return `${(value * 100).toFixed(decimals)}%`;
}
__name(formatPercentage, "formatPercentage");
function formatNumber(num) {
  return num.toLocaleString();
}
__name(formatNumber, "formatNumber");
function formatRelativeTime(date) {
  const now = /* @__PURE__ */ new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 6e4)
    return "just now";
  if (diff < 36e5)
    return `${Math.floor(diff / 6e4)}m ago`;
  if (diff < 864e5)
    return `${Math.floor(diff / 36e5)}h ago`;
  return `${Math.floor(diff / 864e5)}d ago`;
}
__name(formatRelativeTime, "formatRelativeTime");
function formatUptime(startTime) {
  const uptime = Date.now() - startTime.getTime();
  return formatDuration(uptime);
}
__name(formatUptime, "formatUptime");
function formatRate(rate) {
  if (rate < 1)
    return `${(rate * 1e3).toFixed(1)}/s`;
  if (rate < 60)
    return `${rate.toFixed(1)}/s`;
  return `${(rate / 60).toFixed(1)}/min`;
}
__name(formatRate, "formatRate");
function truncate(str, length) {
  if (str.length <= length)
    return str;
  return str.substring(0, length - 3) + "...";
}
__name(truncate, "truncate");
function formatStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}
__name(formatStatus, "formatStatus");
function formatHealth(health) {
  const percentage = Math.round(health * 100);
  let emoji = "\u{1F7E2}";
  if (health < 0.3)
    emoji = "\u{1F534}";
  else if (health < 0.7)
    emoji = "\u{1F7E1}";
  return `${emoji} ${percentage}%`;
}
__name(formatHealth, "formatHealth");
function formatMetric(value, unit) {
  if (value < 1e3)
    return `${value.toFixed(1)} ${unit}`;
  if (value < 1e6)
    return `${(value / 1e3).toFixed(1)}K ${unit}`;
  return `${(value / 1e6).toFixed(1)}M ${unit}`;
}
__name(formatMetric, "formatMetric");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatBytes,
  formatDuration,
  formatHealth,
  formatMetric,
  formatNumber,
  formatPercentage,
  formatRate,
  formatRelativeTime,
  formatStatus,
  formatUptime,
  truncate
});
//# sourceMappingURL=formatters.js.map
