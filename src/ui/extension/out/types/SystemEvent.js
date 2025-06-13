"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventType = void 0;
var EventType;
(function (EventType) {
    // Agent events
    EventType["AGENT_SPAWNED"] = "agent.spawned";
    EventType["AGENT_MESSAGE"] = "agent.message";
    EventType["AGENT_TERMINATED"] = "agent.terminated";
    EventType["AGENT_ERROR"] = "agent.error";
    // Task events
    EventType["TASK_CREATED"] = "task.created";
    EventType["TASK_ASSIGNED"] = "task.assigned";
    EventType["TASK_STARTED"] = "task.started";
    EventType["TASK_COMPLETED"] = "task.completed";
    EventType["TASK_FAILED"] = "task.failed";
    // Tool events
    EventType["TOOL_INVOKED"] = "tool.invoked";
    EventType["TOOL_COMPLETED"] = "tool.completed";
    EventType["TOOL_FAILED"] = "tool.failed";
    // System events
    EventType["MODE_CHANGED"] = "system.mode_changed";
    EventType["ERROR_OCCURRED"] = "system.error";
    EventType["MEMORY_UPDATED"] = "system.memory_updated";
})(EventType || (exports.EventType = EventType = {}));
//# sourceMappingURL=SystemEvent.js.map