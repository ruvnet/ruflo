import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let VERSION;
let BUILD_DATE;
try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    VERSION = packageJson.version;
    BUILD_DATE = new Date().toISOString().split('T')[0];
} catch (error) {
    console.warn('Warning: Could not read version from package.json, using fallback');
    VERSION = '2.0.0-alpha.101';
    BUILD_DATE = new Date().toISOString().split('T')[0];
}
export { VERSION, BUILD_DATE };
export function getVersionString(includeV = true) {
    return includeV ? `v${VERSION}` : VERSION;
}
export function displayVersion() {
    console.log(getVersionString());
}

//# sourceMappingURL=version.js.map