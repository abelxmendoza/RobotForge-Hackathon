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

/* The Improve-this-twin flow keeps up to THREE scans per robot, one
 * per job: a Scaniverse PLY (the photoreal look), a RealSense PLY
 * (true scale — the one dimensions are measured from) and a GLB
 * photo model (textured mesh). The slot the owner picks sets the
 * label; the file itself lives in IndexedDB under a per-slot key. */
export type ScanKind = 'scaniverse' | 'realsense' | 'photomodel';

export interface SlotScan extends ScanMeta {
  kind: ScanKind;
}

export const SCAN_SLOTS: { kind: ScanKind; label: string; gives: string; format: ScanFormat }[] = [
  { kind: 'scaniverse', label: 'Scaniverse scan (.ply)', gives: 'The photoreal look — your real robot, as points', format: 'ply' },
  { kind: 'realsense', label: 'RealSense scan (.ply)', gives: 'True scale — the scan dimensions are measured from', format: 'ply' },
  { kind: 'photomodel', label: 'Photo model (.glb)', gives: 'A textured mesh from your photos', format: 'glb' },
];

/* IndexedDB key for one slot's file. The single-scan key above stays
 * for the robot's primary (viewer) scan. */
export function slotScanKey(robotId: string, kind: ScanKind, demo: boolean): string {
  return (demo ? 'demo:' : '') + robotId + ':' + kind;
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

/* Scans from RobotForge's own scan bridge (tools/scan_bridge.py) are
 * stored z-up (x length, y width, z height: the axes ScanMeasure
 * reads) and say so in a PLY header comment. Viewers are y-up, so
 * they stand such a scan upright with a quarter turn about x. */
export function isZUpRobotForgeScan(data: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(512, data.byteLength)));
  const end = head.indexOf('end_header');
  return /^comment robotforge scan:.*z up/m.test(end >= 0 ? head.slice(0, end) : head);
}
