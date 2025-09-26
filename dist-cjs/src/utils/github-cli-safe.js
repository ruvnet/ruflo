import { GitHubCliSafe, githubCli, safeGhCommand as newSafeGhCommand } from './github-cli-safety-wrapper.js';
export async function safeGhCommand(command, target, body, options = {}) {
    console.warn('safeGhCommand is deprecated. Use GitHubCliSafe from github-cli-safety-wrapper.js');
    try {
        const result = await newSafeGhCommand(command, target, body, options);
        return result.stdout;
    } catch (error) {
        throw error;
    }
}
function executeWithTimeout(command, args, timeout) {
    console.warn('executeWithTimeout is deprecated. Use GitHubCliSafe.executeWithTimeout instead');
    const ghSafe = new GitHubCliSafe({
        timeout
    });
    return ghSafe.executeWithTimeout(command.replace('gh ', ''), args.slice(1), {
        timeout
    });
}
export const gh = {
    async issueComment (issue, body, options = {}) {
        console.warn('gh.issueComment is deprecated. Use githubCli.addIssueComment instead');
        const result = await githubCli.addIssueComment(issue, body, options);
        return result.stdout;
    },
    async prComment (pr, body, options = {}) {
        console.warn('gh.prComment is deprecated. Use githubCli.addPRComment instead');
        const result = await githubCli.addPRComment(pr, body, options);
        return result.stdout;
    },
    async createIssue ({ title, body, labels = [], assignees = [] }) {
        console.warn('gh.createIssue is deprecated. Use githubCli.createIssue instead');
        const result = await githubCli.createIssue({
            title,
            body,
            labels,
            assignees
        });
        return result.stdout;
    },
    async createPR ({ title, body, base = 'main', head, draft = false }) {
        console.warn('gh.createPR is deprecated. Use githubCli.createPR instead');
        const result = await githubCli.createPR({
            title,
            body,
            base,
            head,
            draft
        });
        return result.stdout;
    }
};

//# sourceMappingURL=github-cli-safe.js.map