#!/usr/bin/env bash
set -euo pipefail

NODE_DIR="/tmp/node-v20.19.6-linux-x64"
WORK_DIR="/tmp/anonchat-ci"
REPO_DIR="/mnt/c/Users/Bakare/Documents/AnonChat"

cp "$REPO_DIR/lib/blockchain/stellar-service.ts" "$WORK_DIR/lib/blockchain/stellar-service.ts"
cp "$REPO_DIR/lib/blockchain/transaction-verification.ts" "$WORK_DIR/lib/blockchain/transaction-verification.ts"

export PATH="$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$WORK_DIR"
npm run build
