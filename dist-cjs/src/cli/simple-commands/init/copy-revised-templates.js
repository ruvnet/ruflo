import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_TEMPLATES_DIR = path.join(__dirname, '../../../../.claude/commands');
export async function copyRevisedTemplates(targetDir, options = {}) {
    const results = {
        success: true,
        copiedFiles: [],
        skippedFiles: [],
        errors: []
    };
    const targetCommandsDir = path.join(targetDir, '.claude/commands');
    try {
        await fs.promises.mkdir(targetCommandsDir, {
            recursive: true
        });
        await copyDirectoryRecursive(REPO_TEMPLATES_DIR, targetCommandsDir, options, results);
        const additionalFiles = [
            {
                source: '../config.json',
                target: '.claude/config.json'
            },
            {
                source: '../settings.json',
                target: '.claude/settings.json'
            }
        ];
        for (const file of additionalFiles){
            const sourcePath = path.join(REPO_TEMPLATES_DIR, file.source);
            const targetPath = path.join(targetDir, file.target);
            if (fs.existsSync(sourcePath)) {
                try {
                    const targetDirPath = path.dirname(targetPath);
                    await fs.promises.mkdir(targetDirPath, {
                        recursive: true
                    });
                    if (!fs.existsSync(targetPath) || options.force) {
                        await fs.promises.copyFile(sourcePath, targetPath);
                        results.copiedFiles.push(file.target);
                        if (!options.dryRun) {
                            console.log(`  ✓ Copied ${file.target}`);
                        }
                    } else {
                        results.skippedFiles.push(file.target);
                        if (!options.dryRun) {
                            console.log(`  ⏭️  Skipped ${file.target} (already exists)`);
                        }
                    }
                } catch (err) {
                    results.errors.push(`Failed to copy ${file.target}: ${err.message}`);
                }
            }
        }
        results.success = results.errors.length === 0;
    } catch (err) {
        results.success = false;
        results.errors.push(`Failed to copy revised templates: ${err.message}`);
    }
    return results;
}
async function copyDirectoryRecursive(sourceDir, targetDir, options, results) {
    try {
        const entries = await fs.promises.readdir(sourceDir, {
            withFileTypes: true
        });
        for (const entry of entries){
            const sourcePath = path.join(sourceDir, entry.name);
            const targetPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                await fs.promises.mkdir(targetPath, {
                    recursive: true
                });
                await copyDirectoryRecursive(sourcePath, targetPath, options, results);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                    if (!fs.existsSync(targetPath) || options.force) {
                        if (!options.dryRun) {
                            await fs.promises.copyFile(sourcePath, targetPath);
                        }
                        const relativePath = path.relative(targetDir, targetPath);
                        results.copiedFiles.push(relativePath);
                        if (!options.dryRun && options.verbose) {
                            console.log(`  ✓ Copied ${relativePath}`);
                        }
                    } else {
                        const relativePath = path.relative(targetDir, targetPath);
                        results.skippedFiles.push(relativePath);
                        if (!options.dryRun && options.verbose) {
                            console.log(`  ⏭️  Skipped ${relativePath} (already exists)`);
                        }
                    }
                } catch (err) {
                    results.errors.push(`Failed to copy ${entry.name}: ${err.message}`);
                }
            }
        }
    } catch (err) {
        results.errors.push(`Failed to read directory ${sourceDir}: ${err.message}`);
    }
}
export async function copyRevisedTemplatesByCategory(targetDir, categories, options = {}) {
    const results = {
        success: true,
        copiedFiles: [],
        skippedFiles: [],
        errors: []
    };
    for (const category of categories){
        const sourceCategoryDir = path.join(REPO_TEMPLATES_DIR, category);
        const targetCategoryDir = path.join(targetDir, '.claude/commands', category);
        if (fs.existsSync(sourceCategoryDir)) {
            await fs.promises.mkdir(targetCategoryDir, {
                recursive: true
            });
            await copyDirectoryRecursive(sourceCategoryDir, targetCategoryDir, options, results);
        } else {
            results.errors.push(`Category '${category}' not found in templates`);
        }
    }
    results.success = results.errors.length === 0;
    return results;
}
export function validateTemplatesExist() {
    if (!fs.existsSync(REPO_TEMPLATES_DIR)) {
        return {
            valid: false,
            error: `Template directory not found: ${REPO_TEMPLATES_DIR}`
        };
    }
    const requiredCategories = [
        'analysis',
        'github',
        'sparc',
        'coordination'
    ];
    const missingCategories = [];
    for (const category of requiredCategories){
        const categoryPath = path.join(REPO_TEMPLATES_DIR, category);
        if (!fs.existsSync(categoryPath)) {
            missingCategories.push(category);
        }
    }
    if (missingCategories.length > 0) {
        return {
            valid: false,
            error: `Missing required template categories: ${missingCategories.join(', ')}`
        };
    }
    return {
        valid: true
    };
}

//# sourceMappingURL=copy-revised-templates.js.map