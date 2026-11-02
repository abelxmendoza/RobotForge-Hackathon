/* Repo import — bring a public GitHub robot repo into RobotForge.
 *
 * The deterministic core lives here and is pure (node-tested): input
 * parsing, tree scanning, license detection, BOM/README extraction,
 * a small URDF reader, catalogue matching, quote validation and the
 * specimen record builder. The browser component (components/import)
 * adds the network (GitHub API + raw files, all client-side), the
 * optional Muse hardware pass through the Worker, and rendering.
 *
 * Honesty rules, mirroring the rest of the app:
 *  - every fact on the record carries its source (repo, pinned
 *    commit, file it came from);
 *  - catalogue matching is the gather pipeline's dedupe semantics
 *    (squashed substring / all-token) — NO fuzzy matching, so a
 *    BNO085 never resolves to the catalogue's BNO055;
 *  - repo images display only under a permissive license or the
 *    user's own attestation, and are always captioned as the source
 *    repo's images — never as photos of the user's build;
 *  - physics runs only on a plain URDF, through the robot pages'
 *    own engine; xacro/SDF models get the catalogue's honest
 *    not-checked state, never a silent conversion.
 */
import { buildWorldSdf } from "./gazebo";
import type { PhysicsEntry } from "./types";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface RepoRef {
  owner: string;
  repo: string;
}

export type ModelFormat = "urdf" | "xacro" | "sdf";

export interface PickedFiles {
  readme?: string;
  license?: string;
  bom?: string;
  urdf: string[];
  xacro: string[];
  sdf: string[];
  packageXml: string[];
  /** Image files under docs/ assets/ images/ media/ (tree order). */
  images: string[];
  primaryModel?: { path: string; format: ModelFormat };
}

export type LicenseFamily = "permissive" | "nc" | "copyleft" | "other" | "unknown";

export interface LicenseInfo {
  /** SPDX-ish id when one could be read, else null. */
  spdx: string | null;
  family: LicenseFamily;
  /** Human label for chips: "BSD-3-Clause", "CC BY-NC-SA 4.0", … */
  label: string;
}

export interface BomPart {
  name: string;
  qty: number | null;
  notes: string;
  sourceFile: string;
}

export interface UrdfLink {
  name: string;
  massKg: number | null;
}

export interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  lower: number | null;
  upper: number | null;
}

export interface UrdfInfo {
  name: string | null;
  links: UrdfLink[];
  joints: UrdfJoint[];
  /** Sum of the link masses the file records; null when it records none. */
  totalMassKg: number | null;
}

export interface RepoImage {
  /** Display URL (pinned raw.githubusercontent URL for tree files). */
  url: string;
  /** Repo path for tree images; "README reference" for README-only ones. */
  path: string;
  alt: string;
  via: "tree" | "readme";
}

export type HardwareCategory =
  | "computer" | "motor" | "driver" | "sensor" | "power" | "other";

export interface HardwareItem {
  name: string;
  category: HardwareCategory;
  /** Verbatim line from the repo text this item was read from. */
  quote: string;
}

export interface SpecimenPart extends BomPart {
  catalogId: string | null;
}

export interface PhysicsSummary {
  totalMassKg: number;
  linkCount: number;
  com: [number, number, number];
  stabilityInside: boolean | null;
  stabilityMarginM: number | null;
  settleVerdict: string | null;
  settleTiltDeg: number | null;
  runAt: string;
}

export interface RepoSpecimen {
  kind: "repo-import";
  name: string;
  provenance: {
    repoUrl: string;
    owner: string;
    repo: string;
    commitSha: string;
    license: LicenseInfo;
    importedAt: string;
    /** True when this record came from the bundled recorded fixture. */
    recorded?: boolean;
    sourceFiles: {
      model?: string;
      bom?: string;
      readme?: string;
      license?: string;
    };
  };
  description: string;
  model: {
    path: string;
    format: ModelFormat;
    /** URDF structure, when a plain URDF was fetched and parsed. */
    urdf?: UrdfInfo;
    /** Honest physics state for non-URDF models (the catalogue wording). */
    physicsNote?: string;
  } | null;
  /** package name → pinned raw base URL of that package directory. */
  packages: Record<string, string>;
  hardware: {
    /** Where the hardware list came from — always labeled in the UI. */
    claudePass: boolean;
    items: HardwareItem[];
  };
  parts: SpecimenPart[];
  images: RepoImage[];
  imagesAttested: boolean;
  physics?: PhysicsSummary;
}

/* ------------------------------------------------------------------ */
/* repo reference + URLs                                               */
/* ------------------------------------------------------------------ */

export function parseRepoInput(input: string): RepoRef | null {
  const s = (input || "").trim();
  if (!s) return null;
  const url = s.match(
    /(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/i,
  );
  if (url) return { owner: url[1], repo: url[2] };
  const ssh = s.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const short = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  return null;
}

/* Several repos pasted at once: one per line, or separated by spaces
 * or commas. Duplicates (GitHub names ignore case) are dropped, and
 * anything that isn't a repo is reported back, not silently skipped. */
export function parseRepoList(input: string): { refs: RepoRef[]; bad: string[] } {
  const refs: RepoRef[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const piece of (input || "").split(/[\s,]+/)) {
    if (!piece) continue;
    const ref = parseRepoInput(piece);
    if (!ref) { bad.push(piece); continue; }
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return { refs, bad };
}

export function repoUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

export function rawUrl(ref: RepoRef, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${path}`;
}

export function blobUrl(ref: RepoRef, sha: string, path: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/blob/${sha}/${path}`;
}

export function commitUrl(ref: RepoRef, sha: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/commit/${sha}`;
}

export function slugifyRepo(ref: RepoRef): string {
  return `${ref.owner}-${ref.repo}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ */
/* tree scanning                                                       */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const IMAGE_DIRS = new Set(["docs", "assets", "images", "image", "media", "img", "pictures"]);
export const MAX_TREE_ENTRIES = 3000;
export const MAX_GALLERY_IMAGES = 40;

function base(path: string): string {
  return path.split("/").pop() || path;
}

/** Vendored dependency trees (committed virtualenvs, node_modules,
 *  pip caches). They are not the robot, and on a real repo they can be
 *  most of the tree: Omega-Code commits ~8,000 venv files, which used
 *  to push its own robot files past the 3,000-path cap. */
const VENDORED_SEG = /^(node_modules|\.?venv|[\w.-]+_venv|\.direnv|site-packages|__pycache__|\.tox|\.git)$/i;

export function isVendoredPath(path: string): boolean {
  return path.split("/").some((seg) => VENDORED_SEG.test(seg) || seg.endsWith(".dist-info"));
}

const LICENSE_FILE = /^(licen[cs]e|copying)([._-].*)?$/i;
const BUILD_ROOT_FILE = /^(meson\.build|CMakeLists\.txt|configure(\.ac)?|Makefile\.am|setup\.py|pyproject\.toml|package\.json|Cargo\.toml|BUILD(\.bazel)?|WORKSPACE)$/;
/** A nested source tree this big, with its own license and build root,
 *  is a third-party project copied into the repo, not the robot. */
export const THIRD_PARTY_MIN_FILES = 300;

/** Drop vendored files: dependency trees (isVendoredPath) and nested
 *  third-party source trees. Omega-Code carries a full libcamera checkout
 *  (2,606 files, own COPYING.rst + meson.build) under its backend; a ROS
 *  package with a LICENSE and CMakeLists.txt stays, being far smaller. */
export function filterVendored(paths: string[]): string[] {
  const own = paths.filter((p) => !isVendoredPath(p));
  const hasLicense = new Set<string>();
  const hasBuild = new Set<string>();
  for (const p of own) {
    const i = p.lastIndexOf("/");
    if (i < 0) continue; // the repo root is never third-party
    const dir = p.slice(0, i);
    const b = p.slice(i + 1);
    if (LICENSE_FILE.test(b)) hasLicense.add(dir);
    if (BUILD_ROOT_FILE.test(b)) hasBuild.add(dir);
  }
  const candidates = [...hasLicense].filter((d) => hasBuild.has(d))
    .sort((a, b) => a.length - b.length);
  const roots: string[] = [];
  for (const dir of candidates) {
    if (roots.some((r) => dir.startsWith(r + "/"))) continue;
    const n = own.reduce((k, p) => k + (p.startsWith(dir + "/") ? 1 : 0), 0);
    if (n >= THIRD_PARTY_MIN_FILES) roots.push(dir);
  }
  if (!roots.length) return own;
  return own.filter((p) => !roots.some((r) => p.startsWith(r + "/")));
}

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTS.some((e) => lower.endsWith(e));
}

/** Score a model-file candidate: the robot's own file over shared
 *  include files (common_properties.urdf and friends carry no links
 *  at all — picking one would simulate an empty shell). */
function modelScore(path: string, repoHint?: string): number {
  const b = base(path).toLowerCase();
  let score = 0;
  if (/common|properties|materials?|macros?|utils?|gazebo|ros2_control|control/.test(b)) score -= 3;
  if (repoHint) {
    const hint = repoHint.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (hint.length >= 3 && b.replace(/[^a-z0-9]+/g, "").includes(hint)) score += 3;
  }
  if (b.includes("robot")) score += 1;
  return score;
}

/** Pick the candidate files the import reads, from tree paths.
 *  Pure: the same picker runs on the live tree and on fixtures. */
export function pickFiles(paths: string[], repoHint?: string): PickedFiles {
  const files = filterVendored(paths.filter((p) => !p.endsWith("/")));
  const byDepth = (a: string, b: string) =>
    a.split("/").length - b.split("/").length || (a < b ? -1 : 1);

  const readmes = files
    .filter((p) => /^readme(\.[a-z0-9]+)?$/i.test(base(p)))
    .sort(byDepth);
  const licenses = files
    .filter((p) =>
      /^(licen[cs]e|copying)(\.[a-z0-9]+)?$/i.test(base(p)) ||
      /^licen[cs]e-/i.test(base(p)))
    .sort(byDepth);
  const boms = files
    .filter((p) => {
      const b = base(p).toLowerCase();
      if (!/\.(csv|md|txt)$/.test(b)) return false;
      return /(^|[^a-z])bom([^a-z]|$)/.test(b) || /^parts([._-]|$)/.test(b) ||
        /^components([._-]|$)/.test(b);
    })
    .sort((a, b) => {
      const rank = (p: string) => (p.endsWith(".csv") ? 0 : p.endsWith(".md") ? 1 : 2);
      return rank(a) - rank(b) || byDepth(a, b);
    });

  const urdf = files.filter((p) => p.toLowerCase().endsWith(".urdf")).sort(byDepth);
  const xacro = files.filter((p) => p.toLowerCase().endsWith(".xacro")).sort(byDepth);
  const sdf = files.filter((p) => p.toLowerCase().endsWith(".sdf")).sort(byDepth);
  const packageXml = files.filter((p) => base(p) === "package.xml").sort(byDepth);

  const images = files
    .filter((p) => isImagePath(p) &&
      p.toLowerCase().split("/").some((seg) => IMAGE_DIRS.has(seg)))
    .slice(0, MAX_GALLERY_IMAGES);

  const picked: PickedFiles = {
    readme: readmes[0],
    license: licenses[0],
    bom: boms[0],
    urdf, xacro, sdf,
    packageXml: packageXml.slice(0, 20),
    images,
  };

  // Primary model: a plain URDF first (physics can run on it), then a
  // top-level *.urdf.xacro, then a model SDF (not a world file).
  const byScore = (a: string, b: string) =>
    modelScore(b, repoHint) - modelScore(a, repoHint) || byDepth(a, b);
  if (urdf.length) {
    picked.primaryModel = { path: [...urdf].sort(byScore)[0], format: "urdf" };
  } else if (xacro.length) {
    const mains = xacro.filter((p) => p.toLowerCase().endsWith(".urdf.xacro"));
    const pool = mains.length ? mains : xacro;
    picked.primaryModel = { path: [...pool].sort(byScore)[0], format: "xacro" };
  } else if (sdf.length) {
    const modelSdf = sdf.find((p) =>
      /(^|\/)models?\//.test(p.toLowerCase()) &&
      !/world/.test(base(p).toLowerCase())) || sdf.find((p) => !/world/.test(p.toLowerCase()));
    if (modelSdf) picked.primaryModel = { path: modelSdf, format: "sdf" };
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* license                                                             */
/* ------------------------------------------------------------------ */

const PERMISSIVE_SPDX = new Set([
  "MIT", "MIT-0", "Apache-2.0", "BSD-1-Clause", "BSD-2-Clause",
  "BSD-3-Clause", "BSD-3-Clause-Clear", "ISC", "Unlicense", "Zlib",
  "CC0-1.0", "CC-BY-1.0", "CC-BY-2.0", "CC-BY-2.5", "CC-BY-3.0",
  "CC-BY-4.0", "CC-BY-SA-1.0", "BSL-1.0", "Python-2.0",
]);

export function licenseFamily(spdx: string | null): LicenseFamily {
  if (!spdx) return "unknown";
  const id = spdx.toUpperCase();
  if (id.includes("-NC") || id.includes("NONCOMMERCIAL")) return "nc";
  if (PERMISSIVE_SPDX.has(spdx) || PERMISSIVE_SPDX.has(id)) return "permissive";
  if (/^(A?GPL|LGPL)/.test(id)) return "copyleft";
  if (id.startsWith("CC-BY")) return "permissive";
  return "other";
}

/** Read a license from its file text (SPDX-ish detection), falling
 *  back to the API's SPDX id when the text is not decisive. */
export function detectLicense(
  text: string | null,
  apiSpdx?: string | null,
): LicenseInfo {
  let spdx: string | null = null;
  if (text) {
    const t = text.slice(0, 6000);
    if (/Apache License/i.test(t) && /Version 2\.0/.test(t)) spdx = "Apache-2.0";
    else if (/MIT License/i.test(t) || /Permission is hereby granted, free of charge/.test(t) && /MIT/.test(t.slice(0, 200))) spdx = "MIT";
    else if (/BSD 3-Clause/i.test(t) || (/Redistribution and use in source and binary forms/.test(t) && /Neither the name/.test(t))) spdx = "BSD-3-Clause";
    else if (/BSD 2-Clause/i.test(t)) spdx = "BSD-2-Clause";
    else if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) spdx = /Version 3/.test(t) ? "GPL-3.0" : "GPL-2.0";
    else if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) spdx = "LGPL-3.0";
    else if (/Attribution-NonCommercial/i.test(t)) {
      const sa = /ShareAlike/i.test(t) ? "-SA" : "";
      const ver = /(4\.0|3\.0|2\.5)/.exec(t)?.[1] || "4.0";
      spdx = `CC-BY-NC${sa}-${ver}`;
    } else if (/Attribution-ShareAlike/i.test(t)) spdx = "CC-BY-SA-4.0";
    else if (/Attribution 4\.0 International/i.test(t) || /Creative Commons Attribution/i.test(t)) spdx = "CC-BY-4.0";
    else if (/CC0/i.test(t) || /public domain/i.test(t) && /waive/i.test(t)) spdx = "CC0-1.0";
    else if (/This is free and unencumbered software released into the public domain/i.test(t)) spdx = "Unlicense";
  }
  if (!spdx && apiSpdx && apiSpdx !== "NOASSERTION") spdx = apiSpdx;
  const family = licenseFamily(spdx);
  return {
    spdx,
    family,
    label: spdx ?? (text ? "license file present, not identified" : "no license found"),
  };
}

/** The image-display gate. Display is allowed under a permissive
 *  license, or when the user attests the repo is theirs / they hold
 *  the rights (the attestation is recorded on the record). */
export function imageGate(
  license: LicenseInfo,
  attested: boolean,
): { display: boolean; reason: string } {
  if (license.family === "permissive") {
    return {
      display: true,
      reason: `The repo's license (${license.label}) permits showing its images with credit.`,
    };
  }
  if (attested) {
    return {
      display: true,
      reason: "Shown under your attestation that this is your repo, or you hold the rights to these images.",
    };
  }
  if (license.family === "nc") {
    return {
      display: false,
      reason: `The repo's license (${license.label}) is non-commercial — its images are listed as links only unless you attest you hold the rights.`,
    };
  }
  return {
    display: false,
    reason: `The repo's license (${license.label}) is not a permissive license RobotForge can rely on — images are listed as links only unless you attest you hold the rights.`,
  };
}

/* ------------------------------------------------------------------ */
/* README extraction                                                   */
/* ------------------------------------------------------------------ */

export function readmeTitle(md: string | null, fallback: string): string {
  if (md) {
    const m = md.match(/^#\s+(.+)$/m);
    if (m) {
      const title = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "").trim();
      if (title) return title;
    }
  }
  return fallback;
}

const BADGEISH = /(shields\.io|badge|actions\/workflows|travis-ci|codecov|circleci|github\.com\/[^/]+\/[^/]+\/actions)/i;

/** Image references in a README, in document order, resolved to
 *  pinned raw URLs. Badge/tracker images are skipped — they are not
 *  pictures of the robot. */
export function readmeImages(
  md: string | null,
  ref: RepoRef,
  sha: string,
  readmePath: string,
): RepoImage[] {
  if (!md) return [];
  const out: RepoImage[] = [];
  const seen = new Set<string>();
  const dir = readmePath.includes("/")
    ? readmePath.replace(/[^/]*$/, "")
    : "";
  const push = (url: string, alt: string) => {
    if (!url || BADGEISH.test(url) || url.startsWith("data:")) return;
    let abs = url;
    if (!/^https?:\/\//i.test(url)) {
      const rel = url.replace(/^\.\//, "").replace(/^\//, "");
      abs = rawUrl(ref, sha, dir + rel);
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, path: "README reference", alt: alt || "image from the repo README", via: "readme" });
  };
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]*\ssrc=["']?([^"'\s>]+)["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m[2]) push(m[2], m[1]);
    else if (m[3]) {
      const alt = /title=["']([^"']+)["']/.exec(m[0])?.[1] || "";
      push(m[3], alt);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* BOM parsing                                                         */
/* ------------------------------------------------------------------ */

function cleanCell(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseQty(s: string): number | null {
  const m = String(s || "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const NAME_COL = /^(part|component|item|name|description|material)s?$/i;
const QTY_COL = /^(qty|quantity|count|no\.?|#|amount)$/i;
const NOTES_COL = /^(notes?|comments?|details?|specs?|type)$/i;
/** Header cells that mark a table as something other than a part list
 *  (API routes, ROS topics, CLI flags, launch parameters). A README's
 *  "Method | Path | Description" table is not hardware. Only headers
 *  that never describe hardware are here: URL, status and port columns
 *  do appear in real BOMs ("Part | Qty | URL"). */
const NOT_PARTS_COL = /^(method|path|endpoint|route|topic|parameter|param|argument|flag|option|command|variable|env|default)s?$/i;

/** Parse a markdown document's part tables (also used on READMEs —
 *  a "Part list" table is a BOM by another name). */
export function parseBomMarkdown(md: string, sourceFile: string): BomPart[] {
  const lines = md.split(/\r?\n/);
  const out: BomPart[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|")) continue;
    const header = lines[i].split("|").map((c) => cleanCell(c));
    const nameIdx = header.findIndex((c) => NAME_COL.test(c));
    if (nameIdx < 0) continue;
    if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) continue;
    const qtyIdx = header.findIndex((c) => QTY_COL.test(c));
    const notesIdx = header.findIndex((c) => NOTES_COL.test(c));
    // A quantity column is a part list whatever else the table has.
    if (qtyIdx < 0 && header.some((c) => NOT_PARTS_COL.test(c))) {
      // Skip the whole non-part table, not just its header row.
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|")) j++;
      i = j;
      continue;
    }
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].includes("|")) break;
      const cells = lines[j].split("|").map((c) => cleanCell(c));
      const name = cells[nameIdx] || "";
      if (!name || NAME_COL.test(name)) continue;
      out.push({
        name,
        qty: qtyIdx >= 0 ? parseQty(cells[qtyIdx]) : null,
        notes: notesIdx >= 0 ? (cells[notesIdx] || "") : "",
        sourceFile,
      });
    }
    i = i + 2;
  }
  return out;
}

/** Parse a CSV BOM: a header row naming the part column, then rows. */
export function parseBomCsv(text: string, sourceFile: string): BomPart[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!rows.length) return [];
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cleanCell(cur)); cur = ""; }
      else cur += ch;
    }
    cells.push(cleanCell(cur));
    return cells;
  };
  const header = split(rows[0]);
  let nameIdx = header.findIndex((c) => NAME_COL.test(c));
  if (nameIdx < 0) nameIdx = 0;
  const qtyIdx = header.findIndex((c) => QTY_COL.test(c));
  const notesIdx = header.findIndex((c) => NOTES_COL.test(c));
  const out: BomPart[] = [];
  for (const row of rows.slice(1)) {
    const cells = split(row);
    const name = cells[nameIdx] || "";
    if (!name) continue;
    out.push({
      name,
      qty: qtyIdx >= 0 ? parseQty(cells[qtyIdx]) : null,
      notes: notesIdx >= 0 ? (cells[notesIdx] || "") : "",
      sourceFile,
    });
  }
  return out;
}

export function parseBom(text: string, filename: string): BomPart[] {
  if (filename.toLowerCase().endsWith(".csv")) return parseBomCsv(text, filename);
  return parseBomMarkdown(text, filename);
}

/* ------------------------------------------------------------------ */
/* URDF reading (deterministic, regex-scan — runs in node and browser) */
/* ------------------------------------------------------------------ */

export function parseUrdf(text: string): UrdfInfo {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "");
  const name = /<robot[^>]*\sname="([^"]+)"/.exec(clean)?.[1] ?? null;

  const links: UrdfLink[] = [];
  const linkRe = /<link\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/link>|<link\s+name="([^"]+)"[^>]*\/>/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(clean)) !== null) {
    const linkName = lm[1] || lm[3];
    const body = lm[2] || "";
    const mass = /<inertial>[\s\S]*?<mass\s+value="([\d.eE+-]+)"/.exec(body)?.[1];
    links.push({ name: linkName, massKg: mass !== undefined ? Number(mass) : null });
  }

  const joints: UrdfJoint[] = [];
  const jointRe = /<joint\s+name="([^"]+)"\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/joint>/g;
  let jm: RegExpExecArray | null;
  while ((jm = jointRe.exec(clean)) !== null) {
    const body = jm[3];
    const parent = /<parent\s+link="([^"]+)"/.exec(body)?.[1] ?? "";
    const child = /<child\s+link="([^"]+)"/.exec(body)?.[1] ?? "";
    const limit = /<limit[^>]*>/.exec(body)?.[0] || "";
    const lower = /lower="([\d.eE+-]+)"/.exec(limit)?.[1];
    const upper = /upper="([\d.eE+-]+)"/.exec(limit)?.[1];
    joints.push({
      name: jm[1], type: jm[2], parent, child,
      lower: lower !== undefined ? Number(lower) : null,
      upper: upper !== undefined ? Number(upper) : null,
    });
  }

  const masses = links.map((l) => l.massKg).filter((m): m is number => m !== null);
  return {
    name,
    links,
    joints,
    totalMassKg: masses.length ? masses.reduce((a, b) => a + b, 0) : null,
  };
}

/** The physics entry for an imported model — the same shape the
 *  catalogue uses, so the robot pages' engine runs it unchanged.
 *  Non-URDF models get the honest not-checked state with the reason. */
export function physicsEntryFor(
  specimen: RepoSpecimen,
  packages: Record<string, string>,
): PhysicsEntry {
  const ref = { owner: specimen.provenance.owner, repo: specimen.provenance.repo };
  const sha = specimen.provenance.commitSha;
  const model = specimen.model;
  if (!model) {
    return {
      status: "none",
      reason: "The repo records no URDF, xacro or SDF model file, so there is nothing to run physics checks on.",
    };
  }
  const sourceLabel =
    `${ref.owner}/${ref.repo} @ ${sha.slice(0, 7)} — ${model.path} (imported repo model)`;
  if (model.format === "urdf") {
    return {
      status: "urdf",
      urdf_url: rawUrl(ref, sha, model.path),
      packages,
      source_label: sourceLabel,
      license: specimen.provenance.license.spdx ?? undefined,
    };
  }
  if (model.format === "xacro") {
    return {
      status: "none",
      reason:
        `The repo's model is an xacro (${model.path}). Physics checks run on a plain URDF, ` +
        "and RobotForge does not expand xacro or convert model formats behind your back — " +
        "so this model's physics is not checked.",
    };
  }
  return {
    status: "none",
    reason:
      `The repo's model is an SDF (${model.path}). The physics checks read URDF; the SDF ` +
      "is offered as a Gazebo launch bundle instead — its physics is not checked here.",
  };
}

/* ------------------------------------------------------------------ */
/* catalogue matching — the gather pipeline's dedupe semantics         */
/* ------------------------------------------------------------------ */

export function squashName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 || /^\d$/.test(t));
}

/** Words that name a kind of part, not a part. A name made only of
 *  these ("Camera", "Motor driver", "Controller") says nothing about
 *  which part it is, so it must not match the first catalogue entry
 *  that happens to contain the word. */
const GENERIC_PART_WORDS = new Set([
  "adc", "battery", "board", "cable", "camera", "chassis", "compute",
  "computer", "controller", "driver", "drivers", "encoder", "encoders",
  "frame", "gimbal", "hat", "imu", "kit", "lidar", "line", "module",
  "motor", "motors", "pack", "pan", "plate", "power", "sensor", "sensors",
  "servo", "servos", "shield", "tilt", "tracking", "ultrasonic", "wheel",
  "wheels",
]);

/** True when a name is only a role ("Camera", "Motor driver"), not a part. */
export function isGenericPartName(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return !words.length || words.every((w) => GENERIC_PART_WORDS.has(w));
}

/** Match a free-text part name against the catalogue: squashed
 *  substring, or all-token containment, over ids and names. No fuzzy
 *  matching — near-misses (BNO085 vs BNO055, Pi 4 vs Pi 5) miss, and
 *  a bare category word ("Camera") matches nothing. */
export function matchCatalogPart(
  name: string,
  catalog: { id: string; name: string }[],
): string | null {
  const sq = squashName(name);
  if (!sq || isGenericPartName(name)) return null;
  for (const part of catalog) {
    if (sq.length >= 3 &&
      (squashName(part.id).includes(sq) || squashName(part.name).includes(sq))) {
      return part.id;
    }
  }
  const tokens = nameTokens(name);
  if (tokens.length >= 2) {
    for (const part of catalog) {
      const have = new Set([...nameTokens(part.name), ...nameTokens(part.id)]);
      if (tokens.every((t) => have.has(t))) return part.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Muse hardware pass — quote validation                             */
/* ------------------------------------------------------------------ */

const HARDWARE_CATEGORIES: HardwareCategory[] = [
  "computer", "motor", "driver", "sensor", "power", "other",
];

function normWs(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Keep only the model-proposed items whose quote appears verbatim
 *  (whitespace-normalized) in the source text. Unquoted or
 *  unverifiable items are dropped — the same receipt rule the
 *  gather pipeline enforces. */
export function validateHardwareItems(
  raw: unknown,
  sourceText: string,
): HardwareItem[] {
  if (!Array.isArray(raw)) return [];
  const haystack = normWs(sourceText);
  const out: HardwareItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as HardwareItem).name || "").trim();
    const quote = String((item as HardwareItem).quote || "").trim();
    if (!name || quote.length < 8) continue;
    if (!haystack.includes(normWs(quote))) continue;
    const cat = (item as HardwareItem).category;
    out.push({
      name: name.slice(0, 80),
      category: HARDWARE_CATEGORIES.includes(cat) ? cat : "other",
      quote: quote.slice(0, 300),
    });
    if (out.length >= 24) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* specimen builder                                                    */
/* ------------------------------------------------------------------ */

export interface SnapshotTexts {
  readme: string | null;
  licenseText: string | null;
  bomText: string | null;
  modelText: string | null;
  /** package name → pinned raw base URL of its directory. */
  packages: Record<string, string>;
}

export interface Snapshot {
  ref: RepoRef;
  description: string;
  headSha: string;
  apiLicenseSpdx: string | null;
  /** Tree paths; truncated=true when the API cap was hit. */
  treePaths: string[];
  treeTruncated: boolean;
  texts: SnapshotTexts;
  importedAt: string;
  recorded?: boolean;
}

export function buildSpecimen(snap: Snapshot): RepoSpecimen {
  const picked = pickFiles(snap.treePaths, snap.ref.repo);
  const license = detectLicense(snap.texts.licenseText, snap.apiLicenseSpdx);
  const name = readmeTitle(snap.texts.readme, snap.ref.repo);

  // Parts: the BOM file when one was picked; otherwise a part table
  // inside the README (a "Part list" is a BOM by another name).
  let parts: BomPart[] = [];
  if (picked.bom && snap.texts.bomText) {
    parts = parseBom(snap.texts.bomText, picked.bom);
  }
  if (!parts.length && snap.texts.readme) {
    parts = parseBomMarkdown(snap.texts.readme, `${picked.readme || "README.md"} (part list)`);
  }

  // Images: tree files under image dirs first, then README-referenced
  // ones not already covered, all pinned at the import commit.
  const images: RepoImage[] = picked.images.map((p) => ({
    url: rawUrl(snap.ref, snap.headSha, p),
    path: p,
    alt: base(p).replace(/[_-]+/g, " ").replace(/\.[a-z0-9]+$/i, ""),
    via: "tree" as const,
  }));
  const seen = new Set(images.map((i) => i.url));
  for (const img of readmeImages(snap.texts.readme, snap.ref, snap.headSha, picked.readme || "README.md")) {
    if (!seen.has(img.url)) {
      images.push(img);
      seen.add(img.url);
    }
    if (images.length >= MAX_GALLERY_IMAGES) break;
  }

  let model: RepoSpecimen["model"] = null;
  if (picked.primaryModel) {
    model = { path: picked.primaryModel.path, format: picked.primaryModel.format };
    if (model.format === "urdf" && snap.texts.modelText) {
      model.urdf = parseUrdf(snap.texts.modelText);
    }
    if (model.format !== "urdf") {
      model.physicsNote = physicsEntryFor(
        {
          provenance: {
            owner: snap.ref.owner, repo: snap.ref.repo,
            commitSha: snap.headSha, license,
          },
          model,
        } as unknown as RepoSpecimen,
        {},
      ).reason;
    }
  }

  return {
    kind: "repo-import",
    name,
    provenance: {
      repoUrl: repoUrl(snap.ref),
      owner: snap.ref.owner,
      repo: snap.ref.repo,
      commitSha: snap.headSha,
      license,
      importedAt: snap.importedAt,
      recorded: snap.recorded || undefined,
      sourceFiles: {
        model: picked.primaryModel?.path,
        bom: picked.bom || (parts.length ? picked.readme : undefined),
        readme: picked.readme,
        license: picked.license,
      },
    },
    description: snap.description || "",
    model,
    packages: snap.texts.packages,
    hardware: { claudePass: false, items: [] },
    parts: parts.map((p) => ({ ...p, catalogId: null })),
    images,
    imagesAttested: false,
  };
}

/** Fill catalogue matches onto a specimen's parts (client passes the
 *  catalogue; kept separate so the pure builder stays data-free). */
export function withCatalogMatches(
  specimen: RepoSpecimen,
  catalog: { id: string; name: string }[],
): RepoSpecimen {
  return {
    ...specimen,
    parts: specimen.parts.map((p) => ({
      ...p,
      // A "Role | Details" hardware table puts the actual part in the
      // details ("Ultrasonic | HC-SR04 (GPIO 27…)"), so when the name is
      // only a role, try the head of the details. A named part
      // ("OV5647 | Raspberry Pi 5 (CSI connector)") never takes its
      // identity from the notes, which may describe something else.
      catalogId: matchCatalogPart(p.name, catalog) ??
        (p.notes && isGenericPartName(p.name)
          ? matchCatalogPart(p.notes.split(/[(\u2014\u2013,;]/)[0].trim(), catalog)
          : null),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* gather requests                                                     */
/* ------------------------------------------------------------------ */

/** One line of the gather queue (tools/gather/requests.jsonl shape),
 *  for an unmatched part found in an imported repo. */
export function gatherRequestFor(
  part: SpecimenPart,
  specimen: RepoSpecimen,
  at: string,
): Record<string, unknown> {
  const ref = { owner: specimen.provenance.owner, repo: specimen.provenance.repo };
  return {
    name: part.name,
    urls: [],
    requested_by: "repo-import",
    at,
    status: "needs_sources",
    source: "repo-import",
    repo: specimen.provenance.repoUrl,
    source_file: blobUrl(ref, specimen.provenance.commitSha, part.sourceFile.split(" (")[0]),
  };
}

export const GATHER_REQUESTS_KEY = "rf.gather-requests.v1";

/* ------------------------------------------------------------------ */
/* generic SDF Gazebo bundle (the URDF path reuses lib/gazebo.ts)      */
/* ------------------------------------------------------------------ */

export interface ImportBundleFile {
  path: string;
  content: string;
}

export interface ImportSdfBundle {
  bundleRoot: string;
  files: ImportBundleFile[];
  primaryCommand: string;
  gzCommand: string;
  sourceLabel: string;
}

/** A self-contained launch bundle around an imported SDF model,
 *  following lib/gazebo.ts's SDF bundle shape: the model file
 *  exactly as published, generated world scaffolding, a launch.py
 *  and a README — the generated files are labeled as scaffolding. */
export function buildImportedSdfBundle(
  specimen: RepoSpecimen,
  sdfText: string,
): ImportSdfBundle {
  const slug = slugifyRepo({ owner: specimen.provenance.owner, repo: specimen.provenance.repo });
  const bundleRoot = `robotforge-${slug}-gazebo`;
  const modelPath = specimen.model?.path || "model.sdf";
  const modelFile = modelPath.split("/").pop() || "model.sdf";
  const modelDir = modelFile.replace(/\.sdf$/i, "") || "model";
  const modelRel = `models/${modelDir}/${modelFile}`;
  const modelName =
    /<model[^>]*\sname="([^"]+)"/.exec(sdfText.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ||
    specimen.name;
  const sourceLabel =
    `${specimen.provenance.owner}/${specimen.provenance.repo} @ ` +
    `${specimen.provenance.commitSha.slice(0, 7)} — ${modelPath} (imported repo model)`;
  const file = (rel: string, content: string): ImportBundleFile => ({
    path: `${bundleRoot}/${rel}`,
    content,
  });
  const gzCommand =
    `cd ${bundleRoot} && GZ_SIM_RESOURCE_PATH="$PWD/models" gz sim -r worlds/world_with_robot.sdf`;
  const primaryCommand = gzCommand;

  const modelConfig = `<?xml version="1.0"?>
<model>
  <name>${modelName}</name>
  <version>1.0</version>
  <sdf version="1.9">${modelFile}</sdf>
  <description>${specimen.name} — bundled by RobotForge from ${sourceLabel}. Model license: ${specimen.provenance.license.label}.</description>
</model>
`;
  const launchPy = `# Generated scaffolding — written by RobotForge for this imported
# model. It starts Gazebo with the bundled world, which includes the
# model exactly as the source repo publishes it (${modelPath}).
# Source: ${sourceLabel}
import os

from launch import LaunchDescription
from launch.actions import ExecuteProcess


def generate_launch_description():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    world = os.path.join(root, "worlds", "world_with_robot.sdf")
    env = dict(os.environ)
    env["GZ_SIM_RESOURCE_PATH"] = os.path.join(root, "models")
    return LaunchDescription([
        ExecuteProcess(
            cmd=["gz", "sim", "-r", world],
            additional_env=env,
            output="screen",
        ),
    ])
`;
  const readme = `# ${specimen.name} — Gazebo launch bundle

Generated by RobotForge from an imported repository model.

- Model: \`${modelPath}\` from ${sourceLabel}, bundled exactly as
  published (license: ${specimen.provenance.license.label}).
- \`worlds/\` and \`launch/launch.py\` are generated scaffolding.

## Run it (on your machine — Gazebo is not in the browser)

\`\`\`
${gzCommand}
\`\`\`

or through ROS 2 launch:

\`\`\`
cd ${bundleRoot} && ros2 launch launch/launch.py
\`\`\`
`;
  const files: ImportBundleFile[] = [
    file(modelRel, sdfText),
    file(`models/${modelDir}/model.config`, modelConfig),
    file("worlds/empty_world.sdf", buildWorldSdf()),
    file("worlds/world_with_robot.sdf", buildWorldSdf({ uri: modelRel, name: modelName })),
    file("launch/launch.py", launchPy),
    file("README.md", readme),
  ];
  const manifest = {
    bundle: "robotforge-gazebo-launch/1",
    robot: slug,
    robot_name: specimen.name,
    format: "sdf" as const,
    model_source: sourceLabel,
    license: specimen.provenance.license.spdx,
    primary_command: primaryCommand,
    gz_command: gzCommand,
    files: files.map((f) => f.path.slice(bundleRoot.length + 1)),
  };
  files.push(file("bundle.json", JSON.stringify(manifest, null, 2) + "\n"));
  return { bundleRoot, files, primaryCommand, gzCommand, sourceLabel };
}
