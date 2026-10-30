// Sync the repo's catalog data + site assets into the Next app.
// Source of truth stays the repo (catalog/*.json, assets/) — one
// generator change feeds both sites. Runs as `prebuild`.
import { cpSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");

// The sync targets are gitignored, so their directories may not exist
// on a fresh clone — copyFileSync does not create parents.
mkdirSync(join(root, "src", "data"), { recursive: true });
mkdirSync(join(root, "src", "styles"), { recursive: true });

copyFileSync(join(repo, "catalog", "kinds.json"), join(root, "src", "data", "kinds.json"));
copyFileSync(join(repo, "catalog", "families.json"), join(root, "src", "data", "families.json"));
copyFileSync(join(repo, "assets", "js", "chat-intents.json"), join(root, "src", "data", "chat-intents.json"));
for (const f of ["robots.json", "parts.json", "gate-reports.json", "parts-kits.json"]) {
  copyFileSync(join(repo, "catalog", f), join(root, "src", "data", f));
}
mkdirSync(join(root, "public"), { recursive: true });
cpSync(join(repo, "assets"), join(root, "public", "assets"), { recursive: true });
for (const css of ["tokens.css", "app.css", "site.css", "chat.css", "anim.css"]) {
  copyFileSync(join(repo, "assets", "css", css), join(root, "src", "styles", css));
}
// Runtime-fetched static files (specs, recorded runs, specimen).
cpSync(join(repo, "examples"), join(root, "public", "examples"), { recursive: true });
copyFileSync(join(repo, "problem-space.html"), join(root, "public", "problem-space.html"));
cpSync(join(repo, "catalog", "specimens"), join(root, "public", "catalog", "specimens"), { recursive: true });
// Raw gate-report JSONs, served as-is so a badge's receipt can link
// the actual report file (catalog/gate-runs/<run>.json).
cpSync(join(repo, "catalog", "gate-runs"), join(root, "public", "catalog", "gate-runs"), { recursive: true });
// Per-slug report folders merged into single maps for static import.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
for (const [folder, out] of [["harness-reports", "harness-reports.json"],
                             ["stability-reports", "stability-reports.json"]]) {
  const dir = join(repo, "catalog", folder);
  const map = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    map[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  }
  writeFileSync(join(root, "src", "data", out), JSON.stringify(map));
}
console.log("sync-data: catalog JSON, assets/ and stylesheets synced");
