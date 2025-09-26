import path from 'path';
import fs from 'fs';
export function findProjectRoot(startDir = process.cwd()) {
    let currentDir = path.resolve(startDir);
    const root = path.parse(currentDir).root;
    let searchDir = currentDir;
    while(searchDir !== root){
        const packageJsonPath = path.join(searchDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (packageJson.name === 'claude-flow' || packageJson.name === '@anthropic/claude-flow') {
                    if (fs.existsSync(path.join(searchDir, 'bin/claude-flow')) || fs.existsSync(path.join(searchDir, 'src/cli')) || fs.existsSync(path.join(searchDir, 'src/memory'))) {
                        return searchDir;
                    }
                }
            } catch (e) {}
        }
        if (fs.existsSync(path.join(searchDir, '.git'))) {
            if (fs.existsSync(path.join(searchDir, 'bin/claude-flow')) || fs.existsSync(path.join(searchDir, '.claude-flow')) || fs.existsSync(path.join(searchDir, 'CLAUDE.md'))) {
                return searchDir;
            }
        }
        const parentDir = path.dirname(searchDir);
        if (parentDir === searchDir) {
            break;
        }
        searchDir = parentDir;
    }
    searchDir = currentDir;
    while(searchDir !== root){
        if (fs.existsSync(path.join(searchDir, '.claude-flow')) || fs.existsSync(path.join(searchDir, '.swarm'))) {
            if (fs.existsSync(path.join(searchDir, 'CLAUDE.md')) || fs.existsSync(path.join(searchDir, 'bin/claude-flow'))) {
                return searchDir;
            }
        }
        const parentDir = path.dirname(searchDir);
        if (parentDir === searchDir) {
            break;
        }
        searchDir = parentDir;
    }
    return process.cwd();
}
export function getClaudeFlowDir(startDir) {
    const root = findProjectRoot(startDir);
    return path.join(root, '.claude-flow');
}
export function getSwarmDir(startDir) {
    const root = findProjectRoot(startDir);
    return path.join(root, '.swarm');
}
export function getHiveMindDir(startDir) {
    const root = findProjectRoot(startDir);
    return path.join(root, '.hive-mind');
}
let cachedProjectRoot = null;
export function getProjectRoot() {
    if (!cachedProjectRoot) {
        cachedProjectRoot = findProjectRoot();
    }
    return cachedProjectRoot;
}
export function clearProjectRootCache() {
    cachedProjectRoot = null;
}

//# sourceMappingURL=project-root.js.map