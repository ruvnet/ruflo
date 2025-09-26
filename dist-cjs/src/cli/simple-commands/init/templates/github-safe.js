#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log(`
Safe GitHub CLI Helper

Usage:
  ./github-safe.js issue comment <number> <body>
  ./github-safe.js pr comment <number> <body>
  ./github-safe.js issue create --title <title> --body <body>
  ./github-safe.js pr create --title <title> --body <body>

This helper prevents timeout issues with special characters like:
- Backticks in code examples
- Command substitution \$(...)
- Directory paths
- Special shell characters
`);
    process.exit(1);
}
const [command, subcommand, ...restArgs] = args;
if ((command === 'issue' || command === 'pr') && (subcommand === 'comment' || subcommand === 'create')) {
    let bodyIndex = -1;
    let body = '';
    if (subcommand === 'comment' && restArgs.length >= 2) {
        body = restArgs[1];
        bodyIndex = 1;
    } else {
        bodyIndex = restArgs.indexOf('--body');
        if (bodyIndex !== -1 && bodyIndex < restArgs.length - 1) {
            body = restArgs[bodyIndex + 1];
        }
    }
    if (body) {
        const tmpFile = join(tmpdir(), `gh-body-${randomBytes(8).toString('hex')}.tmp`);
        try {
            writeFileSync(tmpFile, body, 'utf8');
            const newArgs = [
                ...restArgs
            ];
            if (subcommand === 'comment' && bodyIndex === 1) {
                newArgs[1] = '--body-file';
                newArgs.push(tmpFile);
            } else if (bodyIndex !== -1) {
                newArgs[bodyIndex] = '--body-file';
                newArgs[bodyIndex + 1] = tmpFile;
            }
            const ghCommand = `gh ${command} ${subcommand} ${newArgs.join(' ')}`;
            console.log(`Executing: ${ghCommand}`);
            const result = execSync(ghCommand, {
                stdio: 'inherit',
                timeout: 30000
            });
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        } finally{
            try {
                unlinkSync(tmpFile);
            } catch (e) {}
        }
    } else {
        execSync(`gh ${args.join(' ')}`, {
            stdio: 'inherit'
        });
    }
} else {
    execSync(`gh ${args.join(' ')}`, {
        stdio: 'inherit'
    });
}

//# sourceMappingURL=github-safe.js.map