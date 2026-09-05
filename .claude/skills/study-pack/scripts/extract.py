#!/usr/bin/env python3
"""
Extract source material for reading.

Two outputs, because neither alone is enough:

  text/      per-document plain text, cheap to grep and quote from
  sheets/    contact sheets of rendered pages, 4 per image

The contact sheets matter more than they look. Lecture slides routinely carry
most of their real content as images — formulas, worked examples, plots, code
screenshots — and text extraction silently returns only the titles. On one real
7-deck course, `pdftotext` recovered about 15% of what was actually on the
slides. Anything built from the text alone would have been confidently wrong
about what the course covered.

Usage:
    python extract.py <source-dir> <output-dir> [--dpi 140] [--per-sheet 4]
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

SUPPORTED = {".pdf", ".pptx", ".docx", ".md", ".txt"}


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def ensure_deps() -> tuple[object, object]:
    try:
        import pymupdf  # type: ignore
    except ImportError:
        die("pymupdf is required. Install it with: pip install pymupdf pillow")
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        die("pillow is required. Install it with: pip install pymupdf pillow")
    return pymupdf, Image


def find_sources(source_dir: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(source_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED:
            if path.name.startswith("~$") or path.name.startswith("."):
                continue
            files.append(path)
    return files


def extract_pdf_text(pymupdf, path: Path) -> tuple[str, int]:
    doc = pymupdf.open(path)
    parts = []
    for index, page in enumerate(doc, 1):
        parts.append(f"\n--- page {index} ---\n")
        parts.append(page.get_text("text"))
    pages = len(doc)
    doc.close()
    return "".join(parts), pages


def render_sheets(pymupdf, Image, path: Path, out_dir: Path, dpi: int, per_sheet: int) -> int:
    """Render pages and tile them into contact sheets. Returns sheet count."""
    doc = pymupdf.open(path)
    images = []

    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        images.append(Image.frombytes("RGB", [pix.width, pix.height], pix.samples))

    doc.close()
    if not images:
        return 0

    cols = 2 if per_sheet >= 2 else 1
    stem = path.stem
    made = 0

    for start in range(0, len(images), per_sheet):
        group = images[start : start + per_sheet]
        width = max(i.width for i in group)
        height = max(i.height for i in group)
        rows = math.ceil(len(group) / cols)

        sheet = Image.new("RGB", (width * cols + 12, height * rows + 12), "#8a8a8a")
        for k, img in enumerate(group):
            x = (k % cols) * (width + 4) + 4
            y = (k // cols) * (height + 4) + 4
            sheet.paste(img, (x, y))

        first = start + 1
        last = start + len(group)
        sheet.save(out_dir / f"{stem}_p{first:03d}-{last:03d}.png", quality=92)
        made += 1

    return made


def extract_plain(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dpi", type=int, default=140)
    parser.add_argument("--per-sheet", type=int, default=4)
    args = parser.parse_args()

    if not args.source.is_dir():
        die(f"{args.source} is not a directory")

    pymupdf, Image = ensure_deps()

    text_dir = args.output / "text"
    sheet_dir = args.output / "sheets"
    text_dir.mkdir(parents=True, exist_ok=True)
    sheet_dir.mkdir(parents=True, exist_ok=True)

    sources = find_sources(args.source)
    if not sources:
        die(f"no supported documents found under {args.source} ({', '.join(sorted(SUPPORTED))})")

    print(f"Found {len(sources)} document(s) under {args.source}\n")
    total_pages = 0

    for path in sources:
        rel = path.relative_to(args.source)
        suffix = path.suffix.lower()

        if suffix == ".pdf":
            try:
                text, pages = extract_pdf_text(pymupdf, path)
            except Exception as exc:  # noqa: BLE001 - report and continue
                print(f"  {rel}: could not read ({exc})")
                continue

            (text_dir / f"{path.stem}.txt").write_text(text, encoding="utf-8")
            sheets = render_sheets(pymupdf, Image, path, sheet_dir, args.dpi, args.per_sheet)
            total_pages += pages

            chars = len(text.strip())
            per_page = chars / pages if pages else 0
            flag = "  <- image-heavy, READ THE SHEETS" if per_page < 400 else ""
            print(f"  {rel}: {pages} pages, {chars} chars of text, {sheets} sheets{flag}")

        elif suffix in {".md", ".txt"}:
            (text_dir / f"{path.stem}.txt").write_text(extract_plain(path), encoding="utf-8")
            print(f"  {rel}: text copied")

        else:
            print(f"  {rel}: {suffix} not handled here — convert to PDF first")

    print(f"\nText:   {text_dir}")
    print(f"Sheets: {sheet_dir}")
    print(f"\n{total_pages} page(s) total.")
    print(
        "Read the contact sheets, not only the text. Slide decks keep formulas,\n"
        "worked examples, plots and code in images that extract as nothing."
    )


if __name__ == "__main__":
    main()
