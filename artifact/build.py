"""Builds the single-file CV Tailor page (artifact/cv-tailor.html) by embedding
the Source Sans 3 fonts from public/fonts into the template."""
import base64
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
template = (root / "artifact" / "cv-tailor.template.html").read_text(encoding="utf8")
for key, name in [("REGULAR", "Regular"), ("BOLD", "Bold"), ("ITALIC", "Italic")]:
    data = (root / "public" / "fonts" / f"SourceSans3-{name}.ttf").read_bytes()
    template = template.replace(f"__FONT_{key}__", base64.b64encode(data).decode())
(root / "artifact" / "cv-tailor.html").write_text(template, encoding="utf8")
print("Wrote artifact/cv-tailor.html")
