#!/bin/bash
set -e

# Parse --dev flag
DEV_MODE=false
if [[ "$1" == "--dev" ]]; then
  DEV_MODE=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

echo "Building mcpx desktop app..."
npm run build

echo "Creating app bundle..."
npx electron-builder --mac --dir

echo "Stopping running instances..."
pkill -f "/Applications/mcpx.app" || true
pkill -f "dist/mac-arm64/mcpx.app" || true
sleep 1

echo "Installing to /Applications..."
if [ -d /Applications/mcpx.app ]; then
  echo "Removing existing installation..."
  rm -rf /Applications/mcpx.app
fi
ditto dist/mac-arm64/mcpx.app /Applications/mcpx.app

echo "Verifying signature..."
codesign --verify --deep --strict /Applications/mcpx.app

echo "Launching app..."
if [ "$DEV_MODE" = true ]; then
  open /Applications/mcpx.app --args --dev
else
  open /Applications/mcpx.app
fi
echo "Done!"