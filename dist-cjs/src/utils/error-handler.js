import { getErrorMessage as getErrorMsg, getErrorStack as getErrorStk, isError as isErr } from './type-guards.js';
export class AppError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode){
        super(message), this.code = code, this.statusCode = statusCode;
        this.name = 'AppError';
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
export const isError = isErr;
export const getErrorMessage = getErrorMsg;
export const getErrorStack = getErrorStk;
export function handleError(error, context) {
    const message = getErrorMessage(error);
    const stack = getErrorStack(error);
    console.error(`Error${context ? ` in ${context}` : ''}: ${message}`);
    if (stack && process.env.NODE_ENV === 'development') {
        console.error('Stack trace:', stack);
    }
    process.exit(1);
}

//# sourceMappingURL=error-handler.js.map