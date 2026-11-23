#!/usr/bin/env python3
"""Cuts the brand sprite sheet into the app icons, favicon and GitHub banner.

The sheet (docs/brand/sheet.jpeg) holds three panels on a bright green
background: app icon (top left), favicon (top right) and a wide banner
(bottom). Run from the repository root:

    python scripts/make-brand.py

Needs Pillow, NumPy and SciPy, and the Ubuntu fonts for the banner text
(set REEL_FONTS to their folder if they are not installed system-wide).
"""
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs/brand/sheet.jpeg"
# Folders searched for the Ubuntu fonts; set REEL_FONTS to add one.
FONTS = [Path(p) for p in os.environ.get("REEL_FONTS", "").split(os.pathsep) if p] + [
    Path("/usr/share/fonts/truetype/ubuntu"),
    Path("/usr/share/fonts/ubuntu"),
]
TITLE = "Reel"
TAGLINE = ["A multi-track video editor in your browser.", "No accounts, no ads, no tracking."]
TEXT = (255, 255, 255)
DIM = (154, 160, 171)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for folder in FONTS:
        if (folder / name).exists():
            return ImageFont.truetype(str(folder / name), size)
    raise SystemExit(f"Font {name} not found in {FONTS}")


def is_green(a: np.ndarray, margin: int) -> np.ndarray:
    """Pixels where green clearly dominates. A small margin also catches the soft fringe."""
    r, g, b = (a[..., i].astype(int) for i in range(3))
    return (g - np.maximum(r, b)) > margin


def panels(a: np.ndarray) -> list[tuple[slice, slice]]:
    """The three largest non-green regions, as (rows, columns) slices."""
    labels, _ = ndimage.label(~is_green(a, 60))
    boxes = ndimage.find_objects(labels)
    boxes.sort(key=lambda s: (s[0].stop - s[0].start) * (s[1].stop - s[1].start), reverse=True)
    return boxes[:3]


def clean(a: np.ndarray, box: tuple[slice, slice]) -> tuple[Image.Image, tuple[int, int, int]]:
    """A panel with its rounded green corners and fringe painted over in the panel's own background."""
    crop = a[box].copy()
    h, w = crop.shape[:2]
    # The background is the most common dark colour along the panel's outer band.
    band = np.concatenate([crop[h // 20, :], crop[-h // 20, :], crop[:, w // 20], crop[:, -w // 20]])
    dark = band[band.sum(axis=1) < 200]
    bg = tuple(int(v) for v in np.median(dark, axis=0))
    fringe = ndimage.binary_dilation(is_green(crop, 12), iterations=3)
    crop[fringe] = bg
    # Flatten the background to one exact colour, so padding added later shows no seam.
    near = np.abs(crop.astype(int) - np.array(bg)).sum(axis=2) < 30
    crop[near] = bg
    return Image.fromarray(crop), bg


def fit(img: Image.Image, bg: tuple[int, int, int], width: int, height: int, zoom: float = 1.0) -> Image.Image:
    """Scales the picture to cover width x height (times zoom), centred, padding with the background."""
    scale = max(width / img.width, height / img.height) * zoom
    scaled = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    out = Image.new("RGB", (width, height), bg)
    out.paste(scaled, ((width - scaled.width) // 2, (height - scaled.height) // 2))
    return out


def main() -> None:
    a = np.asarray(Image.open(SHEET).convert("RGB"))
    boxes = panels(a)
    banner_box = max(boxes, key=lambda s: s[1].stop - s[1].start)
    squares = sorted((b for b in boxes if b is not banner_box), key=lambda s: s[1].start)
    icon, icon_bg = clean(a, squares[0])
    fav, fav_bg = clean(a, squares[1])
    banner, banner_bg = clean(a, banner_box)

    # App icons: slightly reduced so launchers that crop to a circle keep the whole drawing.
    for size in (512, 192, 180):
        fit(icon, icon_bg, 1024, 1024, zoom=0.9).resize((size, size), Image.LANCZOS).save(ROOT / f"public/icon-{size}.png")

    # Favicon: enlarged a little for small sizes, with rounded transparent corners.
    big = fit(fav, fav_bg, 512, 512, zoom=1.12).convert("RGBA")
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 511, 511), radius=104, fill=255)
    big.putalpha(mask)
    big.resize((64, 64), Image.LANCZOS).save(ROOT / "public/favicon.png")

    # Banner: 1280x640 with the name and tagline in the empty right-hand part.
    out = fit(banner, banner_bg, 1280, 640)
    draw = ImageDraw.Draw(out)
    x = 560
    draw.text((x, 150), TITLE, font=font("Ubuntu-B.ttf", 132), fill=TEXT)
    for i, line in enumerate(TAGLINE):
        draw.text((x + 4, 318 + i * 46), line, font=font("Ubuntu-R.ttf", 32), fill=DIM)
    out.save(ROOT / "docs/brand/social-preview.png")
    print("panels:", [(b[1].stop - b[1].start, b[0].stop - b[0].start) for b in (squares[0], squares[1], banner_box)])


if __name__ == "__main__":
    main()
