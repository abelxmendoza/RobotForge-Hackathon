// Materialize the SimReady bench props: public/catalog/props/simready/*.glb
//
// The props are external NVIDIA SimReady assets (CC BY 4.0 — see
// catalog/props/simready/props.json for per-prop attribution, the
// conversion record and the honesty notes). The optimized GLBs are
// stored in the repo base64-encoded (catalog/props/simready/*.glb.b64)
// for the same reason the sample scan is generated here: the binary
// is a build artifact, the text form is the source of truth that
// review and the git pipeline can carry. This script decodes them at
// prebuild/predev and VERIFIES each one against the manifest's
// sha256 and byte count — a corrupted decode fails the build loudly
// instead of shipping a broken model. It also copies the manifest
// itself into public/ so the scene can fetch it next to the models.
//
// Node stdlib only, like make-sample-scan.mjs.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const srcDir = join(repo, "catalog", "props", "simready");
const outDir = join(root, "public", "catalog", "props", "simready");

const manifest = JSON.parse(readFileSync(join(srcDir, "props.json"), "utf8"));
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const prop of manifest.props) {
  const b64 = readFileSync(join(srcDir, prop.file + ".b64"), "utf8");
  const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== prop.sha256 || bytes.length !== prop.optimized_bytes) {
    throw new Error(
      `make-simready-props: ${prop.file} failed verification ` +
        `(sha256 ${sha.slice(0, 12)}…, ${bytes.length} bytes; manifest says ` +
        `${prop.sha256.slice(0, 12)}…, ${prop.optimized_bytes} bytes)`,
    );
  }
  writeFileSync(join(outDir, prop.file), bytes);
  total += bytes.length;
  console.log(
    `make-simready-props: ${prop.file} — ${bytes.length} bytes, sha256 verified`,
  );
}
copyFileSync(join(srcDir, "props.json"), join(outDir, "props.json"));
console.log(
  `make-simready-props: ${manifest.props.length} props, ${total} bytes total, manifest copied`,
);
