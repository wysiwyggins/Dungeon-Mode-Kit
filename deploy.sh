#!/bin/bash

# Dungeon Mode Kit - Deploy Script
# This script is just for copying the needed files to my jekyll site so that embedding prototypes works. Not needed for running locally or on a regular site
# Mirrors the game files into a destination folder (e.g., Jekyll site). The
# engine, data, prototype, editor, lib and asset folders are synced with
# --delete, so files removed from the repo are removed from the site too.

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

mkdir -p "$DEST"

# Folders mirrored exactly. main.js is the ES module entry; it imports from
# core/, engine/, architect/, behaviors/ and ui/.
SYNC_DIRS=(core architect engine behaviors ui editors data prototypes lib assets)

echo "Syncing folders..."
for dir in "${SYNC_DIRS[@]}"; do
    rsync -a --delete \
        --exclude '.DS_Store' \
        --exclude 'audio/source/' \
        "$SCRIPT_DIR/$dir/" "$DEST/$dir/"
done

# Root files: the module entry, the root-level modules and the game pages.
echo "Copying root files..."
ROOT_FILES=(
    main.js effects.js input.js lighting.js sound.js
    index.html dungeon.html labyrinth.html mine.html automatons.html
    hallucination_test.html test.html embed-example.html
    LICENSE.txt README.md
)
for file in "${ROOT_FILES[@]}"; do
    cp "$SCRIPT_DIR/$file" "$DEST/"
done

# Leftovers from before the ES module refactor, and from old deploys that put
# the editors at the root (they only work from editors/).
echo "Removing orphaned files..."
ORPHANS=(
    globals.js engine.js architect.js interface.js behaviors.js
    actor-editor.html item-editor.html personality-editor.html
    prototype-editor.html biome-editor.html
    arena.html sewer.html
)
for file in "${ORPHANS[@]}"; do
    if [[ -e "$DEST/$file" ]]; then
        rm "$DEST/$file"
        echo "  removed $file"
    fi
done

echo "Rewriting font paths for Jekyll..."
sed -i '' 's|/assets/fonts/|/fonts/|g' "$DEST/assets/main.css"

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
