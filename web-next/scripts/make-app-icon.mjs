// Materialize the Meta app icon: public/assets/img/app-icon-1024.png
//
// The 1024x1024 PNG the provider dashboards ask for (Meta app
// icon). It is the repo logo (assets/img/logo.svg — an SVG wrapper
// around a native 1254x1254 raster) downsampled to exactly
// 1024x1024, stored base64-encoded like the SimReady props: the
// binary is a build artifact, the text form is the source of
// truth the git pipeline can carry. This script decodes it at
// prebuild/predev and VERIFIES the sha256 — a corrupted decode
// fails the build loudly instead of shipping a broken icon.
//
// Node stdlib only, like make-simready-props.mjs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const src = join(repo, "assets", "img", "app-icon-1024.png.b64");
const out = join(root, "public", "assets", "img", "app-icon-1024.png");

const EXPECTED_SHA256 = "26afbd41711609ea667e158e6b84fa4afe70c20c5dbf01a0b29fb1d1f06d775a";
const EXPECTED_BYTES = 852676;

const b64 = readFileSync(src, "utf8");
const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== EXPECTED_SHA256 || bytes.length !== EXPECTED_BYTES) {
  throw new Error(
    `make-app-icon: app-icon-1024.png failed verification ` +
      `(sha256 ${sha.slice(0, 12)}…, ${bytes.length} bytes; expected ` +
      `${EXPECTED_SHA256.slice(0, 12)}…, ${EXPECTED_BYTES} bytes)`,
  );
}
// PNG IHDR width/height must be exactly 1024x1024.
const w = bytes.readUInt32BE(16);
const h = bytes.readUInt32BE(20);
if (w !== 1024 || h !== 1024) {
  throw new Error(`make-app-icon: decoded PNG is ${w}x${h}, not 1024x1024`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`make-app-icon: wrote public/assets/img/app-icon-1024.png (${bytes.length} bytes, sha256 ${sha.slice(0, 12)}…)`);
