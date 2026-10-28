#!/usr/bin/env python3
"""Slice the static-tiles spritesheet into individual tile PNGs named from static-tiles.json."""

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITESHEET = ROOT / "assets" / "sprites" / "static-tiles.png"
TILES_JSON = ROOT / "data" / "static-tiles.json"
OUTPUT_DIR = ROOT / "docs" / "images"

def main():
    with open(TILES_JSON) as f:
        data = json.load(f)

    tile_w = data["tilePixelWidth"]   # 40
    tile_h = data["tilePixelHeight"]  # 30
    tiles = data["tiles"]

    sheet = Image.open(SPRITESHEET)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Cache cropped images by position to avoid re-cropping duplicates
    cropped = {}
    count = 0

    for name, (col, row) in tiles.items():
        if name in ("BLANK", "SPACE"):
            continue

        pos = (col, row)
        if pos not in cropped:
            left = col * tile_w
            upper = row * tile_h
            cropped[pos] = sheet.crop((left, upper, left + tile_w, upper + tile_h))

        out_path = OUTPUT_DIR / f"{name}.png"
        cropped[pos].save(out_path)
        count += 1

    print(f"Sliced {count} tiles to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
