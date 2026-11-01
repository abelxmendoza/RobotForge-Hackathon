// Materialize the browser-tab favicons: public/assets/img/favicon-*.png,
// apple-touch-icon.png and icon-192/512.png.
//
// Same pattern as make-app-icon.mjs: the PNGs are stored base64-encoded
// in assets/img/ (the binary is a build artifact, the text form is the
// source of truth the git pipeline can carry). This script decodes them
// at prebuild/predev and VERIFIES sha256 + byte count + IHDR dimensions
// for each — a corrupted decode fails the build loudly.
//
// Source: the native 1254x1254 raster embedded in assets/img/logo.svg.
// The full lockup's wordmark is mush at tab size, so the favicons use
// the EMBLEM ONLY (the teal wireframe cube + rover). The crop was
// derived deterministically from the raster (PIL, LANCZOS downsample
// per size): background = median corner colour (2,14,27); content =
// max-channel diff > 12; the first content band is the emblem (bbox
// x 260..987, y 149..919) and the second band is the wordmark (top
// y 949). Square crop left=207, top=104, side=833 — the emblem bbox
// plus ~8% padding, shifted up so the crop bottom (937) stays 12 rows
// above the wordmark.
//
// Node stdlib only, like make-app-icon.mjs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const outDir = join(root, "public", "assets", "img");

const ICONS = [
  { file: "favicon-16.png", size: 16, bytes: 810, sha256: "0dee2d09ea2a96c6a8aec2a85684544c25dfc8f79fc9f6e66636b2c74c163d70" },
  { file: "favicon-32.png", size: 32, bytes: 2345, sha256: "408eea8014cd67b863eaf14e6b095e42595185cef43db9177e58b0906c470f4d" },
  { file: "favicon-48.png", size: 48, bytes: 4550, sha256: "a739f32cc760c97855cd1f284f7c2ca4d21443b8383904529d1e8db5616713f8" },
  { file: "apple-touch-icon.png", size: 180, bytes: 44259, sha256: "0a48fb6b426a64dae939fca94c88285353bd1b098ef07bc3868ce8f70bf9bbb1" },
  { file: "icon-192.png", size: 192, bytes: 49602, sha256: "1e25930c78fb54e4ca7db5e97da5c02fd916b68057e796dc5f34efcc5ec3bab9" },
  { file: "icon-512.png", size: 512, bytes: 294776, sha256: "3d62040fe1885ecd6a91725fd874967db6614891469582b32d16a377c4ef7018" },
];

mkdirSync(outDir, { recursive: true });
for (const icon of ICONS) {
  const src = join(repo, "assets", "img", `${icon.file}.b64`);
  const b64 = readFileSync(src, "utf8");
  const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== icon.sha256 || bytes.length !== icon.bytes) {
    throw new Error(
      `make-favicon: ${icon.file} failed verification ` +
        `(sha256 ${sha.slice(0, 12)}…, ${bytes.length} bytes; expected ` +
        `${icon.sha256.slice(0, 12)}…, ${icon.bytes} bytes)`,
    );
  }
  // PNG IHDR width/height must be exactly size x size.
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  if (w !== icon.size || h !== icon.size) {
    throw new Error(`make-favicon: decoded ${icon.file} is ${w}x${h}, not ${icon.size}x${icon.size}`);
  }
  writeFileSync(join(outDir, icon.file), bytes);
  console.log(`make-favicon: wrote public/assets/img/${icon.file} (${bytes.length} bytes, sha256 ${sha.slice(0, 12)}…)`);
}
