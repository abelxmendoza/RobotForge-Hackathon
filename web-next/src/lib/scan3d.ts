/* 3D scans of the real robot: a mesh from a phone scanning app
 * (Scaniverse, Polycam, Apple Object Capture) or from a depth camera
 * (tools/realsense_scan.py). Pure helpers, no DOM, so they test in
 * Node. The file itself is too big for localStorage, so it lives in
 * this browser's IndexedDB (lib/scanStore.ts); only this small record
 * rides on the Garage robot (GarageRobot.scan). */

export type ScanFormat = 'glb' | 'obj' | 'ply';

export interface ScanMeta {
  name: string;        // the uploaded file's name
  format: ScanFormat;
  bytes: number;
  addedAt: string;
}

/* Big enough for a detailed phone scan, small enough for IndexedDB on
 * a phone. Scaniverse's "medium" GLB of a desk-sized robot is ~5-25 MB. */
export const SCAN_MAX_BYTES = 80 * 1024 * 1024;

/* .gltf is left out on purpose: it points at separate texture and .bin
 * files that a single upload does not bring. GLB packs them in one. */
export function scanFormat(fileName: string): ScanFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return ext === 'glb' || ext === 'obj' || ext === 'ply' ? ext : null;
}

export function scanProblem(fileName: string, bytes: number): string | null {
  const fmt = scanFormat(fileName);
  if (!fmt) {
    return fileName.toLowerCase().endsWith('.gltf')
      ? 'Export the scan as GLB instead of glTF: GLB keeps the textures in the same file.'
      : 'Pick a GLB, OBJ or PLY file. In Scaniverse: Share → Export model → GLB.';
  }
  if (bytes <= 0) return 'That file is empty.';
  if (bytes > SCAN_MAX_BYTES) {
    return `That scan is ${fmtBytes(bytes)}; the limit is ${fmtBytes(SCAN_MAX_BYTES)}. Export it at a lower detail level.`;
  }
  return null;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/* Scans come in any unit and any up-axis. Fit the model's bounding box
 * into a box of `target` size and say where to put the camera. */
export function fitScan(size: [number, number, number], target = 1): { scale: number; distance: number } {
  const longest = Math.max(...size.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0)));
  const scale = longest > 0 ? target / longest : 1;
  return { scale, distance: target * 1.9 };
}

/* Which storage key a robot's scan lives under. Demo mode keeps its
 * own copies so a visitor's scan never lands in a signed-in garage. */
export function scanKey(robotId: string, demo: boolean): string {
  return (demo ? 'demo:' : '') + robotId;
}
