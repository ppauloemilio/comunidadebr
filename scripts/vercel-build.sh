#!/bin/sh
set -e

if [ -d client ] && [ -f package.json ] && [ -f client/package.json ]; then
  # Running from monorepo root
  npm exec -w client -- vite build
  rm -rf dist
  cp -r client/dist dist
else
  # Running from client/ (Vercel Root Directory = client)
  node ../node_modules/vite/bin/vite.js build
fi
