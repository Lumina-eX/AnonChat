#!/bin/bash

# Setup Husky for pre-commit hooks
echo "🪝 Setting up Husky pre-commit hooks..."

# Create .husky directory if it doesn't exist
mkdir -p .husky/_

# Create the pre-commit hook
cat > .husky/pre-commit << 'EOF'
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run type checking
echo "🔍 Checking TypeScript types..."
npx tsc --noEmit
if [ $? -ne 0 ]; then
  echo "❌ TypeScript check failed. Fix errors before committing."
  exit 1
fi

# Run linting on staged files
echo "🎨 Running ESLint on staged files..."
npx lint-staged
if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Fix errors before committing."
  exit 1
fi

echo "✅ Pre-commit checks passed!"
EOF

chmod +x .husky/pre-commit

echo "✅ Husky setup complete!"
echo ""
echo "Pre-commit hooks will now:"
echo "  1. Check TypeScript types"
echo "  2. Run ESLint on staged files"
echo "  3. Prevent commit if errors found"
echo ""
echo "Contributors can skip hooks with: git commit --no-verify"
