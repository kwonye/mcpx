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
    APP_EXECUTABLE_NAME="mcpx"
    APP_ICON_PATH=""
    BUILD_DEBUG="0"
    ;;
  dev)
    APP_PRODUCT_NAME="mcpx-dev"
    APP_ID="io.github.kwonye.mcpx.dev"
    APP_EXECUTABLE_NAME="mcpx-dev"
    APP_ICON_PATH="build/icons/mcpx-dev.icns"
    BUILD_DEBUG="1"
    ;;
  *)
    echo "Unsupported flavor: $FLAVOR" >&2
    exit 1
    ;;
esac

APP_BUNDLE_NAME="${APP_PRODUCT_NAME}.app"
APP_INSTALL_PATH="/Applications/${APP_BUNDLE_NAME}"
DIST_DIR="dist/${FLAVOR}"
BUILDER_ARGS=(
  --mac
  --dir
  "-c.directories.output=${DIST_DIR}"
  "-c.mac.notarize=false"
)

if [[ "$FLAVOR" == "dev" ]]; then
  BUILDER_ARGS+=(
    "-c.productName=${APP_PRODUCT_NAME}"
    "-c.appId=${APP_ID}"
    "-c.executableName=${APP_EXECUTABLE_NAME}"
    "-c.mac.icon=${APP_ICON_PATH}"
    "-c.mac.extendInfo.CFBundleDisplayName=${APP_PRODUCT_NAME}"
    "-c.mac.extendInfo.CFBundleName=${APP_PRODUCT_NAME}"
  )
fi

echo "Building ${APP_PRODUCT_NAME} desktop app..."
export MCPX_DESKTOP_FLAVOR="${FLAVOR}"
export MCPX_DESKTOP_DEBUG="${BUILD_DEBUG}"
export CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run build

echo "Creating app bundle..."
npx electron-builder "${BUILDER_ARGS[@]}"

SOURCE_APP_PATH="$(find "${DIST_DIR}" -maxdepth 2 -type d -name "${APP_BUNDLE_NAME}" -print -quit)"
if [[ -z "$SOURCE_APP_PATH" ]]; then
  echo "Could not find built app bundle ${APP_BUNDLE_NAME} under ${DIST_DIR}/" >&2
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

echo "Applying local ad-hoc signature..."
codesign --force --deep --sign - "${APP_INSTALL_PATH}"

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
