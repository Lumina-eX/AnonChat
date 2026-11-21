#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="20.19.6"
NODE_DIR="/tmp/node-v${NODE_VERSION}-linux-x64"
WORK_DIR="/tmp/anonchat-ci"
REPO_DIR="/mnt/c/Users/Bakare/Documents/AnonChat"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$REPO_DIR"
tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=tmp-ci-repro.sh \
  -cf - . | tar -x -C "$WORK_DIR"

cd /tmp
if [ ! -x "$NODE_DIR/bin/node" ]; then
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar -xf "node-v${NODE_VERSION}-linux-x64.tar.xz"
fi

export PATH="$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$WORK_DIR"
node --version
npm --version
npm install
npm run lint
npm run test:unit
npm run build
