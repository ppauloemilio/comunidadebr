#!/bin/sh
set -e

if [ -d client ] && [ -f package.json ] && [ -f client/package.json ]; then
  npm install --include=dev --workspace=client --workspace=server --include-workspace-root
else
  cd ..
  npm install --include=dev --workspace=client --workspace=server --include-workspace-root
fi
