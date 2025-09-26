import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export function getClaudeFlowRoot() {
    const strategies = [
        resolve(__dirname, '../..'),
        process.cwd(),
        resolve(process.execPath, '../../lib/node_modules/claude-flow'),
        process.env.CLAUDE_FLOW_ROOT || ''
    ];
    for (const path of strategies){
        if (path && existsSync(join(path, 'package.json'))) {
            try {
                const pkgPath = join(path, 'package.json');
                const pkgContent = readFileSync(pkgPath, 'utf-8');
                const pkg = JSON.parse(pkgContent);
                if (pkg.name === 'claude-flow') {
                    return path;
                }
            } catch  {}
        }
    }
    return process.cwd();
}
export function getClaudeFlowBin() {
    return join(getClaudeFlowRoot(), 'bin', 'claude-flow');
}
export function resolveProjectPath(relativePath) {
    const root = getClaudeFlowRoot();
    return resolve(root, relativePath);
}

//# sourceMappingURL=paths.js.map