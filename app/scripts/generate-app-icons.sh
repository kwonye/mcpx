#!/bin/bash
#
# Generate .icns app icons from design/icon.svg
#
# Creates:
# - app/build/icons/mcpx.icns (production)
# - app/build/icons/mcpx-dev.icns (dev with "DEV" badge)
#
# Uses iconutil to create .icns from .iconset directory.
# Note: iconutil requires .iconset extension for input directory.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESIGN_DIR="${SCRIPT_DIR}/../../design"
BUILD_DIR="${SCRIPT_DIR}/../build/icons"
TEMP_DIR="/tmp/mcpx-iconset.iconset"

# Required icon sizes for .icns (iconutil requires .iconset extension for input)
# File names map to nominal size, dimensions are different:
# - icon_32x32.png: 32x32 pixels (nominal 32px)
# - icon_32x32@2x.png: 64x64 pixels (retina 32px)
# - icon_512x512.png: 512x512 pixels (nominal 512px)
# - icon_512x512@2x.png: 1024x1024 pixels (retina 512px)
# - icon_256x256.png: 256x256 pixels (nominal 256px)
# - icon_256x256@2x.png: 512x512 pixels (retina 256px)

echo "Generating app icons from design/icon.svg..."

# Ensure build directory exists
mkdir -p "$BUILD_DIR"

# Create temp iconset directory (must have .iconset extension)
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "Exporting PNG assets..."

# Generate PNGs using node/canvas (need 1024px base)
# Use node via npx to ensure canvas is available
cd "$SCRIPT_DIR/.."

# Generate 1024px PNG from 128px source using node
node -e "
const fs = require('fs');
const { createCanvas } = require('canvas');

const img128 = fs.readFileSync('$DESIGN_DIR/icon-128.png');
const { Image } = require('canvas');

// Scale 128px to 1024px (large size needed for all other sizes)
const canvas = createCanvas(1024, 1024);
const ctx = canvas.getContext('2d');
const img = new Image();
img.src = img128;
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
ctx.drawImage(img, 0, 0, 1024, 1024);
fs.writeFileSync('/tmp/icon-1024.png', canvas.toBuffer('image/png'));
console.log('Generated /tmp/icon-1024.png');
" 2>/dev/null || {
  echo "Node/canvas generation failed, using fallback..."
  # Fallback: use existing 128px and scale up
  sips -s format png -z 1024 1024 "$DESIGN_DIR/icon-128.png" --out /tmp/icon-1024.png
}

# Create all required icon files
# icon_32x32.png (32x32)
sips -s format png -z 32 32 /tmp/icon-1024.png --out "$TEMP_DIR/icon_32x32.png"
echo "  ✓ icon_32x32.png"

# icon_32x32@2x.png (64x64)
sips -s format png -z 64 64 /tmp/icon-1024.png --out "$TEMP_DIR/icon_32x32@2x.png"
echo "  ✓ icon_32x32@2x.png"

# icon_512x512.png (512x512)
sips -s format png -z 512 512 /tmp/icon-1024.png --out "$TEMP_DIR/icon_512x512.png"
echo "  ✓ icon_512x512.png"

# icon_512x512@2x.png (1024x1024)
sips -s format png -z 1024 1024 /tmp/icon-1024.png --out "$TEMP_DIR/icon_512x512@2x.png"
echo "  ✓ icon_512x512@2x.png"

# icon_256x256.png (256x256)
sips -s format png -z 256 256 /tmp/icon-1024.png --out "$TEMP_DIR/icon_256x256.png"
echo "  ✓ icon_256x256.png"

# icon_256x256@2x.png (512x512)
sips -s format png -z 512 512 /tmp/icon-1024.png --out "$TEMP_DIR/icon_256x256@2x.png"
echo "  ✓ icon_256x256@2x.png"

# Cleanup temporary files
rm -f /tmp/icon-1024.png

echo ""
echo "Verifying dimensions..."
for f in "$TEMP_DIR"/*.png; do
  dims=$(sips -g pixelWidth "$f" 2>/dev/null | tail -1 | awk '{print $2}')
  echo "  $(basename $f): ${dims}x${dims}"
done

# Generate the .icns file
# Note: iconutil requires .iconset extension for input directory
echo ""
echo "Creating mcpx.icns..."
if command -v iconutil &> /dev/null; then
  iconutil --convert icns "$TEMP_DIR" -o "${BUILD_DIR}/mcpx.icns"
  echo "  ✓ app/build/icons/mcpx.icns"
else
  echo "Error: iconutil not found. Cannot generate .icns file."
  exit 1
fi

# For dev variant, use the same icon (DEV badge requires ImageMagick)
echo ""
echo "Creating mcpx-dev.icns..."
DEV_TEMP_DIR="/tmp/mcpx-dev-iconset.iconset"
rm -rf "$DEV_TEMP_DIR"
cp -r "$TEMP_DIR" "$DEV_TEMP_DIR"

iconutil --convert icns "$DEV_TEMP_DIR" -o "${BUILD_DIR}/mcpx-dev.icns"
echo "  ✓ app/build/icons/mcpx-dev.icns"
echo "  Note: Dev variant uses same icon; add 'DEV' badge with ImageMagick if desired"

# Cleanup
rm -rf "$TEMP_DIR"
rm -rf "$DEV_TEMP_DIR"

echo ""
echo "Done! App icons generated in ${BUILD_DIR}/"
