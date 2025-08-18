# Fork Guide - CI/CD Configuration

## CI/CD in Forks

By default, CI/CD workflows are **disabled in forks** to conserve GitHub Actions resources and provide a cleaner fork experience.

### Why This Approach?

- **Resource efficiency**: Prevents unnecessary GitHub Actions usage
- **Clean fork experience**: No failed workflow notifications in your fork
- **Full control**: Enable CI/CD only when you actually need it
- **PR validation**: Your changes are still fully tested when submitting PRs to the main repository

## Enabling CI/CD in Your Fork

If you need to run CI/CD workflows in your fork, follow these steps:

1. Navigate to your fork's **Settings** tab
2. Go to **Secrets and variables** → **Actions** → **Variables**
3. Click **New repository variable**
4. Create a new variable:
   - **Name**: `ENABLE_CI_IN_FORK`
   - **Value**: `true`
5. Click **Add variable**

That's it! CI/CD workflows will now run in your fork.

## Disabling CI/CD Again

To disable CI/CD workflows in your fork, you can either:

- **Delete the variable**: Remove the `ENABLE_CI_IN_FORK` variable entirely, or
- **Set to false**: Change the `ENABLE_CI_IN_FORK` value to `false`

## Alternative Testing Options

You don't always need to enable CI/CD in your fork. Here are alternatives:

### Local Testing

Run tests locally before pushing:

```bash
# Install dependencies
npm ci

# Run linting
npm run lint

# Run tests
npm test

# Run type checking
npm run typecheck

# Run full CI suite locally
npm run ci:local
```

### Pull Request CI

When you open a Pull Request to the main repository:
- All CI/CD workflows automatically run
- You get full validation of your changes
- No configuration needed

### GitHub Codespaces

Use GitHub Codespaces for a full development environment:
- All tools pre-configured
- Same environment as CI/CD
- No local setup required

## Frequently Asked Questions

### Q: Will my PR be tested even if CI is disabled in my fork?

**A:** Yes! When you open a PR to the main repository, all CI/CD workflows run automatically, regardless of your fork's settings.

### Q: Can I selectively enable specific workflows?

**A:** The `ENABLE_CI_IN_FORK` variable enables all workflows. For selective control, you'd need to modify individual workflow files.

### Q: Do I need to enable CI in my fork to contribute?

**A:** No! Most contributors never need to enable CI in their forks. Local testing and PR validation are sufficient for most contributions.

### Q: Will disabling CI affect my ability to merge PRs?

**A:** No! PR merge requirements are based on CI runs in the main repository, not your fork.

## Best Practices

1. **Use local testing first** - Catch issues before pushing
2. **Enable fork CI only when needed** - For complex multi-commit work
3. **Disable when done** - Keep your fork clean
4. **Rely on PR CI** - Let the main repository validate your final changes

## Need Help?

If you encounter any issues or have questions:

1. Check the [main documentation](../README.md)
2. Open an [issue](https://github.com/ruvnet/claude-flow/issues)
3. Join our [Discord community](https://discord.com/invite/dfxmpwkG2D)

---

*This fork-friendly CI/CD approach helps us maintain a sustainable open-source project while providing flexibility for contributors.*