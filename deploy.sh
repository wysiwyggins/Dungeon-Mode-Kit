#!/bin/bash

# Dungeon Mode Kit - Deploy Script
# This script is just for copying the needed files to my jekyll site so that embedding prototypes works. Not needed for running locally or on a regular site
# Copies required game files to a destination folder (e.g., Jekyll site)

# Configuration - update this path to your Jekyll site's game folder
DEST="${1:-/path/to/your/jekyll/site/games/dungeon}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${YELLOW}Dungeon Mode Kit Deploy${NC}"
echo "========================"
echo "Source: $SCRIPT_DIR"
echo "Destination: $DEST"
echo ""

# Check if destination was provided
if [[ "$DEST" == "/path/to/your/jekyll/site/games/dungeon" ]]; then
    echo -e "${RED}Error: Please provide destination path${NC}"
    echo ""
    echo "Usage: ./deploy.sh /path/to/jekyll/site/games/dungeon"
    echo ""
    echo "Example:"
    echo "  ./deploy.sh ~/wileywiggins.com/games/dungeon"
    exit 1
fi

# Create destination directories
echo "Creating directories..."
mkdir -p "$DEST"/{lib,assets/sprites,assets/audio,data,prototypes/default,prototypes/test,prototypes/labyrinth,prototypes/arena,prototypes/automatons,prototypes/dungeon}

# Core JavaScript files
echo "Copying core JS files..."
cp "$SCRIPT_DIR/architect.js" "$DEST/"
cp "$SCRIPT_DIR/engine.js" "$DEST/"
cp "$SCRIPT_DIR/behaviors.js" "$DEST/"
cp "$SCRIPT_DIR/effects.js" "$DEST/"
cp "$SCRIPT_DIR/globals.js" "$DEST/"
cp "$SCRIPT_DIR/input.js" "$DEST/"
cp "$SCRIPT_DIR/interface.js" "$DEST/"
cp "$SCRIPT_DIR/lighting.js" "$DEST/"
cp "$SCRIPT_DIR/sound.js" "$DEST/"

# Library files
echo "Copying library files..."
cp "$SCRIPT_DIR/lib/rot.js" "$DEST/lib/"
cp "$SCRIPT_DIR/lib/pixi.min.js" "$DEST/lib/"
cp "$SCRIPT_DIR/lib/tweenjs.js" "$DEST/lib/"
cp "$SCRIPT_DIR/lib/howler.js" "$DEST/lib/"

# Assets
echo "Copying assets..."
cp "$SCRIPT_DIR/assets/main.css" "$DEST/assets/"
echo "Rewriting font paths for Jekyll..."
sed -i '' 's|/assets/fonts/|/fonts/|g' "$DEST/assets/main.css"
cp "$SCRIPT_DIR/assets/audio/sounds.mp3" "$DEST/assets/audio/"
cp "$SCRIPT_DIR/assets/sprites/"*.png "$DEST/assets/sprites/"

# Data files
echo "Copying data files..."
cp "$SCRIPT_DIR/data/"*.json "$DEST/data/"

# Prototypes
echo "Copying prototypes..."
cp "$SCRIPT_DIR/prototypes/default/"*.json "$DEST/prototypes/default/"
cp "$SCRIPT_DIR/prototypes/default/"*.tmj "$DEST/prototypes/default/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/test/"*.json "$DEST/prototypes/test/"
cp "$SCRIPT_DIR/prototypes/test/"*.tmj "$DEST/prototypes/test/"
cp "$SCRIPT_DIR/prototypes/labyrinth/"*.json "$DEST/prototypes/labyrinth/"
cp "$SCRIPT_DIR/prototypes/labyrinth/"*.tmj "$DEST/prototypes/labyrinth/"
cp "$SCRIPT_DIR/prototypes/arena/"*.json "$DEST/prototypes/arena/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/arena/"*.tmj "$DEST/prototypes/arena/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/automatons/"*.json "$DEST/prototypes/automatons/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/automatons/"*.tmj "$DEST/prototypes/automatons/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/dungeon/"*.json "$DEST/prototypes/dungeon/" 2>/dev/null
cp "$SCRIPT_DIR/prototypes/dungeon/"*.tmj "$DEST/prototypes/dungeon/" 2>/dev/null

# Copy index.html as a reference (optional - you may want to customize this)
echo "Copying index.html template..."
cp "$SCRIPT_DIR/index.html" "$DEST/"

# Editor tools
echo "Copying editor tools..."
cp "$SCRIPT_DIR/editors/item-editor.html" "$DEST/"
cp "$SCRIPT_DIR/editors/actor-editor.html" "$DEST/"
cp "$SCRIPT_DIR/editors/personality-editor.html" "$DEST/"
cp "$SCRIPT_DIR/editors/prototype-editor.html" "$DEST/"
cp "$SCRIPT_DIR/editors/biome-editor.html" "$DEST/"

echo ""
echo -e "${GREEN}Deploy complete!${NC}"
echo ""
echo "Files copied to: $DEST"
echo ""
echo "To embed in a Jekyll page, use:"
echo ""
echo '  <iframe src="/games/dungeon/?prototype=labyrinth" width="800" height="600"></iframe>'
echo ""
echo "Or link directly:"
echo ""
echo '  <a href="/games/dungeon/?prototype=labyrinth">Play the Labyrinth</a>'
