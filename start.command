#!/bin/bash
# Double-click (macOS) to start the gallery admin (opens in your browser).
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org"
  read -r -p "Press Enter to close..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies..."
  if ! npm install; then
    echo
    echo "Installation failed."
    read -r -p "Press Enter to close..."
    exit 1
  fi
fi
npm run admin
