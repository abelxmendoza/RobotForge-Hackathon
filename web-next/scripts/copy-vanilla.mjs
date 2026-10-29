// Preserve the vanilla site under /vanilla/ in the static export.
// Mirrors the copy step the retired GitHub Pages workflow performed:
// the vanilla files live at the repository root, one level up from web-next.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webNextDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(webNextDir);
const destRoot = path.join(webNextDir, "out", "vanilla");

const files = ["index.html", "kit.html", "parts.html", "problem-space.html", "reports.html", "robodex.html", "try.html"];
const dirs = ["app", "assets", "catalog", "examples"];

mkdirSync(destRoot, { recursive: true });
let copied = 0;
for (const name of [...files, ...dirs]) {
  const src = path.join(repoRoot, name);
  if (!existsSync(src)) {
    console.warn(`copy-vanilla: skipping missing ${name}`);
    continue;
  }
  cpSync(src, path.join(destRoot, name), { recursive: true });
  copied++;
}
console.log(`copy-vanilla: copied ${copied} entries into out/vanilla/`);
