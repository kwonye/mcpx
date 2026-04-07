#!/bin/bash
set -e

DEV_MODE=false
FLAVOR="production"
REMOTE_DEBUGGING_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      DEV_MODE=true
      shift
      ;;
    --flavor)
      FLAVOR="${2:-}"
      shift 2
      ;;
    --remote-debugging-port)
      REMOTE_DEBUGGING_PORT="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

case "$FLAVOR" in
  production)
    APP_PRODUCT_NAME="mcpx"
    APP_ID="io.github.kwonye.mcpx"
    ;;
  dev)
    APP_PRODUCT_NAME="mcpx-dev"
    APP_ID="io.github.kwonye.mcpx.dev"
    ;;
  *)
    echo "Unsupported flavor: $FLAVOR" >&2
    exit 1
    ;;
esac

APP_BUNDLE_NAME="${APP_PRODUCT_NAME}.app"
APP_INSTALL_PATH="/Applications/${APP_BUNDLE_NAME}"

echo "Building ${APP_PRODUCT_NAME} desktop app..."
npm run build

echo "Creating app bundle..."
npx electron-builder --mac --dir \
  -c.productName="${APP_PRODUCT_NAME}" \
  -c.appId="${APP_ID}"

SOURCE_APP_PATH="$(find dist -maxdepth 2 -type d -name "${APP_BUNDLE_NAME}" -print -quit)"
if [[ -z "$SOURCE_APP_PATH" ]]; then
  echo "Could not find built app bundle ${APP_BUNDLE_NAME} under dist/" >&2
  exit 1
fi

echo "Stopping running instances..."
pkill -f "${APP_INSTALL_PATH}" || true
pkill -f "${SOURCE_APP_PATH}" || true
sleep 1

echo "Installing to ${APP_INSTALL_PATH}..."
if [[ -d "${APP_INSTALL_PATH}" ]]; then
  echo "Removing existing installation..."
  rm -rf "${APP_INSTALL_PATH}"
fi
ditto "${SOURCE_APP_PATH}" "${APP_INSTALL_PATH}"

echo "Verifying signature..."
codesign --verify --deep --strict "${APP_INSTALL_PATH}"

echo "Launching app..."
OPEN_ARGS=()
if [[ "$DEV_MODE" == true ]]; then
  OPEN_ARGS+=("--dev")
fi
if [[ -n "$REMOTE_DEBUGGING_PORT" ]]; then
  OPEN_ARGS+=("--remoteDebuggingPort" "$REMOTE_DEBUGGING_PORT")
fi

if [[ ${#OPEN_ARGS[@]} -gt 0 ]]; then
  open "${APP_INSTALL_PATH}" --args "${OPEN_ARGS[@]}"
else
  open "${APP_INSTALL_PATH}"
fi

echo "Done!"
