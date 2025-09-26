export function printSuccess(message) {
    console.log(`\x1b[32m✅ ${message}\x1b[0m`);
}
export function printError(message) {
    console.log(`\x1b[31m❌ ${message}\x1b[0m`);
}
export function printWarning(message) {
    console.log(`\x1b[33m⚠️  ${message}\x1b[0m`);
}
export function printInfo(message) {
    console.log(`\x1b[36mℹ️  ${message}\x1b[0m`);
}

//# sourceMappingURL=utils.js.map