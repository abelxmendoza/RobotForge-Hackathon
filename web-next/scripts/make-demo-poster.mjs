// Materialize the demo video card's poster: public/assets/img/demo-poster.jpg
//
// The poster is a screenshot of the current build's demo Workshop
// (1280x720, taken from the production export: landing -> "Try the
// demo" -> seeded TurtleBot3 Burger, welcome dismissed). It is
// stored base64-encoded like the app icon and the SimReady props:
// the binary is a build artifact, the text form is the source of
// truth the git pipeline can carry. This script decodes it at
// prebuild/predev and VERIFIES the sha256 — a corrupted decode
// fails the build loudly instead of shipping a broken poster.
//
// When the demo video render lands (see
// hackathon/simulated-demo-video-plan-2026-11-01.md §6), refresh
// this poster from the same build the video shows and update the
// two constants below.
//
// Node stdlib only, like make-app-icon.mjs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const src = join(repo, "assets", "img", "demo-poster.jpg.b64");
const out = join(root, "public", "assets", "img", "demo-poster.jpg");

const EXPECTED_SHA256 = "56a9806927bf284e5d8b9af8fdc5e01a6d36ce48be009bcee37f07b9cc624894";
const EXPECTED_BYTES = 73168;

const b64 = readFileSync(src, "utf8");
const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== EXPECTED_SHA256 || bytes.length !== EXPECTED_BYTES) {
  throw new Error(
    `make-demo-poster: demo-poster.jpg failed verification ` +
      `(sha256 ${sha.slice(0, 12)}…, ${bytes.length} bytes; expected ` +
      `${EXPECTED_SHA256.slice(0, 12)}…, ${EXPECTED_BYTES} bytes)`,
  );
}
// JPEG dimensions from the first SOF0/SOF2 segment must be 1280x720.
let w = 0;
let h = 0;
if (bytes[0] === 0xff && bytes[1] === 0xd8) {
  let off = 2;
  while (off + 9 < bytes.length) {
    if (bytes[off] !== 0xff) break;
    const marker = bytes[off + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      h = bytes.readUInt16BE(off + 5);
      w = bytes.readUInt16BE(off + 7);
      break;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    off += 2 + bytes.readUInt16BE(off + 2);
  }
}
if (w !== 1280 || h !== 720) {
  throw new Error(`make-demo-poster: decoded JPEG is ${w}x${h}, not 1280x720`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`make-demo-poster: wrote public/assets/img/demo-poster.jpg (${bytes.length} bytes, sha256 ${sha.slice(0, 12)}…)`);
