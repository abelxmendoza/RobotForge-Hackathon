// Content parity: exported Next pages vs the vanilla site.
// Caveat: the vanilla forge/evidence pages render much of their
// content client-side from JSON, so their static HTML is a shell —
// coverage there understates the port (the Next export server-renders
// a superset). The per-page SSR-vs-vanilla-JS harnesses run during
// the port are the stronger checks for those two routes.
// Extracts visible text from both, reports similarity and checks that
// key strings (robot names, verdicts, thresholds) survive the port.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");

const ROUTES = [
  ["home", join(repo, "index.html"), join(root, "out", "index.html")],
  ["forge", join(repo, "app", "forge", "index.html"), join(root, "out", "forge", "index.html")],
  ["robots", join(repo, "app", "robots", "index.html"), join(root, "out", "robots", "index.html")],
  ["evidence", join(repo, "app", "evidence", "index.html"), join(root, "out", "evidence", "index.html")],
  ["how-it-works", join(repo, "app", "how-it-works", "index.html"), join(root, "out", "how-it-works", "index.html")],
];
const MUST_CONTAIN = {
  home: ["RobotForge", "Check a robot before you build it"],
  forge: ["Forge"],
  robots: ["Andino", "TurtleBot3 Burger", "Pathfinder"],
  evidence: ["Fail", "Pass"],
  "how-it-works": ["Muse Spark"],
};

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function wordSet(t) { return new Set(t.toLowerCase().split(" ")); }

let fail = 0;
for (const [name, vanilla, next] of ROUTES) {
  if (!existsSync(vanilla)) { console.log(`${name}: vanilla page missing (skipped)`); continue; }
  if (!existsSync(next)) { console.log(`${name}: NEXT EXPORT MISSING`); fail++; continue; }
  const vt = textOf(readFileSync(vanilla, "utf8"));
  const nt = textOf(readFileSync(next, "utf8"));
  const vs = wordSet(vt), ns = wordSet(nt);
  let shared = 0; for (const w of vs) if (ns.has(w)) shared++;
  const cover = vs.size ? (100 * shared / vs.size).toFixed(1) : "0";
  const missing = (MUST_CONTAIN[name] || []).filter((s) => !nt.includes(s));
  console.log(`${name}: vanilla words ${vs.size}, next words ${ns.size}, vanilla-word coverage ${cover}%` +
    (missing.length ? ` | MISSING KEY STRINGS: ${missing.join(", ")}` : " | key strings ok"));
  if (missing.length) fail++;
}
process.exit(fail ? 1 : 0);
