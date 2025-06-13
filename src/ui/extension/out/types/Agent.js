"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentState = exports.AgentRole = void 0;
var AgentRole;
(function (AgentRole) {
    AgentRole["Coordinator"] = "coordinator";
    AgentRole["Implementer"] = "implementer";
    AgentRole["Tester"] = "tester";
    AgentRole["Reflector"] = "reflector";
    AgentRole["Analyst"] = "analyst";
    AgentRole["Assistant"] = "assistant";
})(AgentRole || (exports.AgentRole = AgentRole = {}));
var AgentState;
(function (AgentState) {
    AgentState["Idle"] = "idle";
    AgentState["Active"] = "active";
    AgentState["Thinking"] = "thinking";
    AgentState["Waiting"] = "waiting";
    AgentState["Error"] = "error";
})(AgentState || (exports.AgentState = AgentState = {}));
//# sourceMappingURL=Agent.js.map