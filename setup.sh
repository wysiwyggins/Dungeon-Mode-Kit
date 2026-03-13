#!/bin/bash

# Dungeon Mode Kit - Setup Script
# Downloads required JavaScript libraries into lib/

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

echo -e "${YELLOW}Dungeon Mode Kit Setup${NC}"
echo "========================"
echo ""

# Check for curl
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is required but not installed.${NC}"
    exit 1
fi

# Create lib directory
mkdir -p "$LIB_DIR"

# Library versions
ROT_VERSION="2.1.5"
PIXI_VERSION="6.0.0"
TWEEN_VERSION="1.0.2"
HOWLER_VERSION="2.2.3"

# Download a file, printing status
download() {
    local url="$1"
    local dest="$2"
    local label="$3"

    printf "  %-30s" "$label"
    if curl -fsSL "$url" -o "$dest"; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

echo "Downloading libraries into lib/..."
echo ""

download "https://cdn.jsdelivr.net/npm/rot-js@${ROT_VERSION}/dist/rot.js" \
    "$LIB_DIR/rot.js" \
    "rot.js ${ROT_VERSION}"

download "https://cdn.jsdelivr.net/npm/pixi.js@${PIXI_VERSION}/dist/browser/pixi.min.js" \
    "$LIB_DIR/pixi.min.js" \
    "pixi.min.js ${PIXI_VERSION}"

download "https://cdn.jsdelivr.net/npm/pixi.js@${PIXI_VERSION}/dist/browser/pixi.min.js.map" \
    "$LIB_DIR/pixi.min.js.map" \
    "pixi.min.js.map ${PIXI_VERSION}"

download "https://cdn.jsdelivr.net/npm/tweenjs@${TWEEN_VERSION}/lib/tweenjs.js" \
    "$LIB_DIR/tweenjs.js" \
    "tweenjs.js ${TWEEN_VERSION}"

download "https://cdn.jsdelivr.net/npm/howler@${HOWLER_VERSION}/dist/howler.js" \
    "$LIB_DIR/howler.js" \
    "howler.js ${HOWLER_VERSION}"

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Start a local server and open index.html to play:"
echo "  python3 -m http.server"
