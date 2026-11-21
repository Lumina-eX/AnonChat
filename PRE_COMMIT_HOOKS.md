# Pre-Commit Hooks Setup

This project uses **Husky** and **lint-staged** to automatically check code quality before commits.

## What Gets Checked

### Before Every Commit:
1. ✅ **TypeScript Type Checking** - Ensures no type errors
2. ✅ **ESLint** - Checks code style and best practices
3. ✅ **Staged Files Only** - Only files you're committing are checked

### Supported File Types:
- `.ts`, `.tsx` - TypeScript files (full type check + linting)
- `.js`, `.jsx` - JavaScript files (linting only)
- `.json` - JSON files (formatting)

## Installation

### For Contributors (One-time setup):

```bash
# 1. Clone the repo
git clone https://github.com/Lumina-eX/AnonChat.git
cd AnonChat

# 2. Install dependencies
npm install
# or
pnpm install

# 3. Setup Husky hooks
npx husky install

# 4. You're done! Hooks will run automatically on next commit
```

### Automatic Setup (Post-install):

The hooks are set up automatically when you run `npm install`.

## How It Works

When you commit code:

```bash
git commit -m "your message"
```

The pre-commit hook will:

1. **Check TypeScript Types**
   ```
   npx tsc --noEmit
   ```
   - Fails if there are any TypeScript errors
   - Prevents commit with type errors

2. **Run ESLint on Staged Files**
   ```
   npx lint-staged
   ```
   - Lints only files you're committing
   - Auto-fixes fixable issues
   - Fails if unfixable issues found

3. **Show Results**
   - ✅ All checks pass → Commit succeeds
   - ❌ Any check fails → Commit blocked (see errors below)

## Common Issues

### ❌ "TypeScript check failed"

**Solution:** Fix the TypeScript errors:

```bash
# See what's wrong
npx tsc --noEmit

# Fix the issues in your code, then:
git add <fixed-files>
git commit -m "your message"
```

### ❌ "ESLint errors"

**Solution:** ESLint can auto-fix many issues:

```bash
# Auto-fix linting issues
npx eslint . --fix

# Then commit again
git add <files>
git commit -m "your message"
```

### 🚀 "I need to commit without checks"

**Use the bypass flag** (use sparingly):

```bash
git commit --no-verify
```

⚠️ **Note:** This bypasses all checks. Avoid if possible.

## Configuration

### Files Being Checked

Edit in `package.json` under `"lint-staged"`:

```json
"lint-staged": {
  "*.{ts,tsx}": [
    "eslint --fix",
    "npx tsc --noEmit"
  ],
  "*.{js,jsx}": [
    "eslint --fix"
  ]
}
```

### ESLint Config

See: `.eslintrc.json` and `eslint.config.mjs`

### TypeScript Config

See: `tsconfig.json`

## For Maintainers

### Require All Checks Pass

Enable in GitHub:
1. Go to **Settings → Branches**
2. Find your branch protection rule
3. Enable: **"Require status checks to pass before merging"**
4. Add the GitHub Actions CI workflow

This ensures PRs can only merge when CI passes ✅

### Disable Husky (If Needed)

```bash
npm uninstall husky lint-staged
rm -rf .husky
```

## Troubleshooting

### Hooks not running?

```bash
# Re-install Husky
npx husky install

# Check hook files exist
ls -la .husky/pre-commit
```

### "command not found: husky"?

```bash
# Make sure dependencies are installed
npm install

# Or use npx
npx husky install
```

### Hooks failing on Windows?

Make sure to use WSL or Git Bash, not cmd.exe:

```bash
# In Git Bash or WSL:
git commit -m "your message"
```

## Benefits

✅ **Catch errors early** - Before they reach GitHub  
✅ **Consistent code quality** - Everyone follows same rules  
✅ **Faster reviews** - No time fixing linting issues in PR  
✅ **Fewer CI failures** - Less wasted GitHub Actions runs  
✅ **Better collaboration** - Team standards enforced automatically  

## References

- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/okonet/lint-staged)
- [ESLint Configuration](https://eslint.org/docs/rules/)

---

**Questions?** See CONTRIBUTING.md or ask in issues.
