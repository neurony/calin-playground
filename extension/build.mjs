// Builds the unpacked extension into dist/ (and with --zip, cv-tailor-extension.zip).
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zip } from "./zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const dist = path.join(here, "dist");
const mod = (p) => path.join(here, "node_modules", p);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { background: path.join(src, "background.js"), content: path.join(src, "content.js"), app: path.join(src, "app/app.js"), offscreen: path.join(src, "offscreen.js") },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  minify: false,
  legalComments: "eof",
  logLevel: "warning",
});

const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true }); fs.copyFileSync(from, path.join(dist, to)); };
copy(path.join(src, "manifest.json"), "manifest.json");
copy(path.join(src, "app/app.html"), "app.html");
copy(path.join(src, "app/app.css"), "app.css");
copy(path.join(src, "offscreen.html"), "offscreen.html");
for (const f of fs.readdirSync(path.join(src, "icons"))) copy(path.join(src, "icons", f), "icons/" + f);

// Libraries, bundled with the extension (Manifest V3 does not allow scripts from a CDN).
copy(mod("pdfjs-dist/build/pdf.min.js"), "vendor/pdf.min.js");
copy(mod("pdfjs-dist/build/pdf.worker.min.js"), "vendor/pdf.worker.min.js");
copy(mod("pdfmake/build/pdfmake.min.js"), "vendor/pdfmake.min.js");
copy(mod("mammoth/mammoth.browser.min.js"), "vendor/mammoth.browser.min.js");
copy(mod("pdfjs-dist/LICENSE"), "vendor/LICENSE-pdfjs.txt");
copy(mod("pdfmake/LICENSE"), "vendor/LICENSE-pdfmake.txt");
copy(mod("mammoth/LICENSE"), "vendor/LICENSE-mammoth.txt");

// PDF fonts: Source Sans 3 from the repo (public/fonts).
const repoFonts = path.join(here, "..", "public", "fonts");
for (const f of ["SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf", "SourceSans3-Italic.ttf", "LICENSE.md"]) copy(path.join(repoFonts, f), "fonts/" + f);

// Interface fonts: Source Sans 3 and Source Serif 4 (SIL OFL), latin + latin-ext subsets.
const faces = [];
const ui = [
  ["Source Sans 3", "source-sans-3", [["400", "normal"], ["400", "italic"], ["600", "normal"], ["700", "normal"]]],
  ["Source Serif 4", "source-serif-4", [["600", "normal"], ["700", "normal"]]],
];
for (const [family, pkg, variants] of ui) {
  for (const [weight, style] of variants) {
    for (const [subset, range] of [["latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"],
      ["latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"]]) {
      const file = `${pkg}-${subset}-${weight}-${style}.woff2`;
      copy(mod(`@fontsource/${pkg}/files/${file}`), "fonts/ui/" + file);
      faces.push(`@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url("${file}") format("woff2"); unicode-range: ${range}; }`);
    }
  }
}
fs.writeFileSync(path.join(dist, "fonts/ui/fonts.css"), faces.join("\n") + "\n");
copy(mod("@fontsource/source-serif-4/LICENSE"), "fonts/ui/LICENSE-source-serif-4.txt");

console.log("Built dist/");

if (process.argv.includes("--zip")) {
  const out = path.join(here, "cv-tailor-extension.zip");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  walk(dist);
  fs.writeFileSync(out, zip(files.map((f) => ({ name: "cv-tailor-extension/" + path.relative(dist, f).split(path.sep).join("/"), data: fs.readFileSync(f) }))));
  console.log("Wrote " + path.relative(process.cwd(), out));
}
