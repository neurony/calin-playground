# CV Tailor (single-file page)

The claude.ai artifact version of CV Tailor: https://claude.ai/artifact/S423pmYK2nggZNqGLboTSr

It is newer than the Next.js app in this repo (fit score, answer memory, saved CVs,
completeness check, per-section rewrite, source highlighting, section tips, three PDF
templates, real PDF preview, scanned-PDF reading, English UI).

- `cv-tailor.template.html`: the source. Calls Claude through the artifact runtime
  (`window.claude.use("sample")`) and saves files through `use("downloads")`.
- `build.py`: embeds the fonts from `public/fonts` and writes `cv-tailor.html`
  (`python3 artifact/build.py`). The built file is not committed.
