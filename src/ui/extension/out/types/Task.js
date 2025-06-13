"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskPriority = exports.TaskStatus = exports.TaskType = void 0;
var TaskType;
(function (TaskType) {
    TaskType["Implementation"] = "implementation";
    TaskType["Analysis"] = "analysis";
    TaskType["Testing"] = "testing";
    TaskType["Documentation"] = "documentation";
    TaskType["Refactoring"] = "refactoring";
})(TaskType || (exports.TaskType = TaskType = {}));
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["Pending"] = "pending";
    TaskStatus["InProgress"] = "in-progress";
    TaskStatus["Completed"] = "completed";
    TaskStatus["Failed"] = "failed";
    TaskStatus["Cancelled"] = "cancelled";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
var TaskPriority;
(function (TaskPriority) {
    TaskPriority["Low"] = "low";
    TaskPriority["Medium"] = "medium";
    TaskPriority["High"] = "high";
    TaskPriority["Critical"] = "critical";
})(TaskPriority || (exports.TaskPriority = TaskPriority = {}));
//# sourceMappingURL=Task.js.map