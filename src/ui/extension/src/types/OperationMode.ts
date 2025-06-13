export enum OperationMode {
    Chat = 'chat',
    PairProgramming = 'pair-programming',
    CodeReview = 'code-review',
    PlanReflect = 'plan-reflect'
}

export interface ModeConfiguration {
    name: string;
    displayName: string;
    description: string;
    agents: string[];
    workflow: string;
    permissions: string[];
}