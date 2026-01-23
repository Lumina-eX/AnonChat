# Contributing to AnonChat 🤝

Thank you for your interest in contributing to AnonChat! This guide will help you get started and ensure a smooth contribution process.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Testing](#testing)

## 🤝 Code of Conduct

We expect all contributors to:
- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

## 🚀 Getting Started

### 1. Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/AnonChat.git
   cd AnonChat
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/original-owner/AnonChat.git
   ```

### 2. Set Up Development Environment

Follow the installation instructions in [README.md](README.md) to set up:
- Node.js dependencies
- Supabase configuration
- Environment variables

### 3. Create a Development Branch

Always create a new branch for your work:
```bash
git checkout -b fix-[issue-number]
```

Use descriptive branch names:
- `fix-123` - For bug fixes
- `feature-456` - For new features
- `docs-789` - For documentation updates

## 🔄 Development Workflow

### Before Starting Work

1. **Check for existing issues** - Avoid duplicate work
2. **Get assigned to an issue** - Comment on the issue to request assignment
3. **Wait for assignment** - Only start work after being assigned
4. **Sync with upstream**:
   ```bash
   git checkout main
   git fetch upstream
   git merge upstream/main
   ```

### During Development

1. **Keep commits atomic** - One logical change per commit
2. **Test frequently** - Run the development server and test your changes
3. **Commit regularly** - Don't wait until everything is done
4. **Stay updated** - Regularly pull changes from upstream

### Testing Your Changes

1. **Run the development server**:
   ```bash
   pnpm dev
   ```

2. **Test in browser**:
   - Visit `http://localhost:3000`
   - Test all affected functionality
   - Check for console errors
   - Verify responsive design (mobile/tablet/desktop)

3. **Run linting**:
   ```bash
   pnpm lint
   ```

4. **Build verification**:
   ```bash
   pnpm build
   ```

## 🌲 Branching Strategy

- `main` - Production-ready code
- `develop` - Integration branch (if used)
- `fix-*` - Bug fixes
- `feature-*` - New features
- `docs-*` - Documentation updates
- `refactor-*` - Code refactoring
- `test-*` - Test additions/modifications

## 📝 Code Standards

### TypeScript/JavaScript

- **Use TypeScript** for all new files
- **Follow existing patterns** in the codebase
- **Use functional components** with hooks in React
- **Add types** for all props, function parameters, and return values
- **Avoid `any` type** - use specific types or `unknown`

### File Organization

- Place components in `components/` directory
- Use kebab-case for file names: `my-component.tsx`
- Group related files together
- Export components using named exports

### Code Style

```typescript
// ✅ Good
interface UserProfile {
  id: string;
  username: string;
  createdAt: Date;
}

export function ProfileCard({ user }: { user: UserProfile }) {
  return (
    <div className="profile-card">
      <h2>{user.username}</h2>
    </div>
  );
}

// ❌ Avoid
export function ProfileCard(props: any) {
  return <div className="profile-card">
    <h2>{props.user.username}</h2></div>
}
```

### Component Guidelines

- **Keep components small** - Single responsibility
- **Use composition** over complex props
- **Extract reusable logic** into custom hooks
- **Use Radix UI components** when available
- **Follow Tailwind CSS conventions** for styling

### CSS/Styling

- **Use Tailwind CSS utility classes** as primary styling method
- **Follow mobile-first approach** for responsive design
- **Use CSS variables** for theming (defined in globals.css)
- **Avoid inline styles** unless absolutely necessary

## 💬 Commit Guidelines

### Commit Message Format

```
<type>: <subject>

[optional body]

[optional footer]
```

### Types

- `Fix:` - Bug fix
- `Feat:` - New feature
- `Docs:` - Documentation changes
- `Style:` - Code style changes (formatting, etc.)
- `Refactor:` - Code refactoring
- `Test:` - Adding or updating tests
- `Chore:` - Build process or auxiliary tool changes

### Examples

```bash
# Good commit messages
git commit -m "Fix: Resolve chat message duplication issue (#123)"
git commit -m "Feat: Add user profile avatar upload functionality"
git commit -m "Docs: Update installation instructions in README"
git commit -m "Refactor: Simplify authentication logic in auth module"

# Bad commit messages (avoid these)
git commit -m "fixed stuff"
git commit -m "update"
git commit -m "changes"
```

### Commit Best Practices

- **Write clear, descriptive messages**
- **Reference issue numbers** when applicable
- **Keep commits focused** on a single change
- **Use present tense** ("Fix bug" not "Fixed bug")
- **Start with capital letter**

## 🔍 Pull Request Process

### Before Submitting

1. **Ensure all tests pass**
2. **Run linting**: `pnpm lint`
3. **Build successfully**: `pnpm build`
4. **Update documentation** if needed
5. **Sync with upstream main**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

### PR Title Format

```
<Type>: <Short description> (#issue-number)
```

Examples:
- `Fix: Resolve message send button disabled state (#45)`
- `Feat: Implement group chat creation (#67)`
- `Docs: Expand contributing guidelines (#89)`

### PR Description Template

```markdown
## Summary
Brief description of what this PR does (1-2 sentences).

## Changes
- Change 1
- Change 2
- Change 3

## Related Issue
Closes #[issue-number]

## Scope
- This PR intentionally avoids refactors, cleanups, and unrelated changes
- All modifications are limited to what is required by the issue

## Testing
- [ ] Tested locally
- [ ] All builds pass
- [ ] No console errors
- [ ] Responsive design verified

## Screenshots (if applicable)
[Add screenshots for UI changes]

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review of code completed
- [ ] Documentation updated (if needed)
- [ ] No new warnings or errors introduced
```

### PR Requirements

- **Must reference an issue**: Include `Closes #[issue-number]` in description
- **Must be assigned**: Only submit PR if you were assigned to the issue
- **Complete within 3 business days** of assignment
- **Respond to review feedback** within 24 hours
- **Keep PR focused** - One issue per PR

### After Submitting

1. **Monitor for review comments**
2. **Address feedback promptly**
3. **Make requested changes** in new commits
4. **Don't force-push** after initial submission (unless requested)

## 📋 Issue Guidelines

### Before Creating an Issue

1. **Search existing issues** - Check if already reported
2. **Reproduce the bug** - Ensure it's consistent
3. **Gather information** - Environment, steps to reproduce

### Issue Template

When reporting bugs:
```markdown
**Description**
Clear description of the issue

**Steps to Reproduce**
1. Step one
2. Step two
3. Step three

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- OS: [e.g., macOS, Windows, Linux]
- Browser: [e.g., Chrome 120]
- Node version: [e.g., 18.17.0]

**Screenshots**
[If applicable]
```

### Requesting Assignment

To work on an issue:
1. Comment on the issue: "I'd like to work on this"
2. Wait for maintainer assignment
3. Begin work only after assignment confirmation

## 🧪 Testing

### Manual Testing Checklist

Before submitting PR, verify:
- [ ] Feature works as intended
- [ ] No console errors or warnings
- [ ] Responsive on mobile/tablet/desktop
- [ ] Works in Chrome, Firefox, Safari
- [ ] Loading states handled properly
- [ ] Error states handled gracefully
- [ ] No visual regressions

### Testing User Flows

Common flows to test:
1. **Authentication**
   - Connect wallet
   - Sign in/out
   
2. **Chat**
   - Send messages
   - Receive messages in real-time
   - Create groups
   - Join groups

3. **Profile**
   - View profile
   - Update profile information

## 🎯 Best Practices

### Do's ✅

- **Read the entire issue** before starting
- **Ask questions** if requirements are unclear
- **Test thoroughly** before submitting
- **Write clean, readable code**
- **Follow existing patterns** in the codebase
- **Update documentation** when adding features
- **Be patient and respectful** in discussions

### Don'ts ❌

- **Don't start without assignment**
- **Don't submit PRs for unassigned issues**
- **Don't make unrelated changes** in your PR
- **Don't ignore review feedback**
- **Don't force-push** without communication
- **Don't copy code** without attribution
- **Don't add unnecessary dependencies**

## 📞 Getting Help

- **Questions about issues?** Comment on the issue
- **Need clarification?** Tag a maintainer
- **Found a problem?** Open a new issue
- **General questions?** Use GitHub Discussions (if enabled)

## 🙏 Recognition

Contributors are recognized in:
- GitHub contributors page
- Release notes (for significant contributions)
- Project README (for major features)

Thank you for contributing to AnonChat! Your efforts help make privacy-focused communication accessible to everyone. 🌟

---

**Remember**: Quality over quantity. A well-tested, focused PR is more valuable than a large, unfocused one.
