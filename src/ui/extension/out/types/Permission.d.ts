export declare enum PermissionLevel {
    Restricted = "restricted",
    Normal = "normal",
    Autonomous = "autonomous"
}
export interface Permission {
    action: string;
    resource: string;
    level: PermissionLevel;
}
export interface PermissionRequest {
    id: string;
    action: string;
    resource: string;
    reason: string;
    timestamp: number;
}
//# sourceMappingURL=Permission.d.ts.map