"""Extract images from projects/webstuff.pdf into media/projects/."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".pylibs"))
import fitz  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
PDF = os.path.join(ROOT, "projects", "webstuff.pdf")
OUT = os.path.join(ROOT, "media", "projects")
MIN_SIZE = 80


def main():
    os.makedirs(OUT, exist_ok=True)
    doc = fitz.open(PDF)
    count = 0
    for pno in range(doc.page_count):
        seen = set()
        for img in doc.get_page_images(pno):
            xref = img[0]
            if xref in seen:
                continue
            seen.add(xref)
            pix = fitz.Pixmap(doc, xref)
            if pix.width < MIN_SIZE or pix.height < MIN_SIZE:
                continue
            if pix.n - pix.alpha > 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            name = f"webstuff-p{pno + 1:02d}-{count:03d}.png"
            pix.save(os.path.join(OUT, name))
            count += 1
    print(f"Saved {count} images to {OUT}")


if __name__ == "__main__":
    main()
