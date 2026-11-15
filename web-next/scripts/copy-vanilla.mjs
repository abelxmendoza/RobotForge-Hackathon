// Preserve the vanilla site under /vanilla/ in the static export.
// Runs at prebuild: the files land in public/vanilla/, which Next copies
// into the export itself. (Copying into out/ after `next build` does not
// survive Vercel's Next.js builder — the copy ran but never deployed.)
// The vanilla files live at the repository root, one level up from web-next.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webNextDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(webNextDir);
const destRoot = path.join(webNextDir, "public", "vanilla");

const files = ["index.html", "kit.html", "parts.html", "reports.html", "robodex.html", "try.html"];
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
console.log(`copy-vanilla: copied ${copied} entries into public/vanilla/`);

// The legacy catalogue includes optional illustrations with an onerror
// removal fallback. Omit unavailable figures from the exported page so
// they do not produce broken requests before that fallback can run.
const cataloguePage = path.join(destRoot, "app", "robots", "index.html");
if (existsSync(cataloguePage)) {
  const html = readFileSync(cataloguePage, "utf8");
  const complete = html.replace(/<figure class="pfig"><img src="([^"<>]+)"[^>]*>[\s\S]*?<\/figure>/g, (figure, src) => {
    if (!src.startsWith("../../assets/img/parts/")) return figure;
    return existsSync(path.resolve(path.dirname(cataloguePage), src)) ? figure : "";
  });
  writeFileSync(cataloguePage, complete);
}
