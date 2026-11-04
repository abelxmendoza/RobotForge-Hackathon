/* Scan Studio <-> the local scan bridge (tools/scan_bridge.py). Pure
 * helpers, no DOM, so they test in Node. A browser cannot read a
 * RealSense depth stream itself, so the bridge runs on the user's own
 * computer and Scan Studio talks to it over 127.0.0.1 only. */
import type { GarageRobot } from './garage';
import type { SlotScan } from './scan3d';

export const DEFAULT_BRIDGE = 'http://127.0.0.1:8765';
export const BRIDGE_URL_KEY = 'rf.scanBridge.url';

export interface BridgeStatus {
  ok: boolean;
  bridge: string;
  camera: string;
  simulated: boolean;
  intrinsics: { width: number; height: number; fx: number; fy: number; cx: number; cy: number };
  recording: boolean;
  frames_recorded: number;
  session: string | null;
  error?: string;
}

export interface BridgeFrame {
  ok: boolean;
  w: number;
  h: number;
  color: string;        // base64 RGB, w*h*3
  depth: string;        // base64 RGB depth colormap, w*h*3
  points: string;       // base64 little-endian float32 xyz, n*3
  point_colors: string; // base64 RGB, n*3
  n: number;
  recording: boolean;
  frames_recorded: number;
}

export interface ScanDimsMm { length: number; width: number; height: number }

export interface BuildResult {
  ok: boolean;
  error?: string;
  dims_mm: ScanDimsMm;
  floor_found: boolean;
  points: number;
  method: 'points' | 'tsdf-mesh';
  frames_used: number;
  frames_lost: number;
  ply_bytes: number;
  measured_by: 'simulated' | 'realsense';
  accuracy_note: string;
  truth_mm?: ScanDimsMm;
  session: string;
}

/* Only this computer: the bridge binds 127.0.0.1, and Scan Studio
 * refuses any other address so a typo can't send frames elsewhere. */
export function bridgeUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'That is not a web address. Try ' + DEFAULT_BRIDGE; }
  if (u.protocol !== 'http:') return 'The bridge speaks plain http on this computer: ' + DEFAULT_BRIDGE;
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    return 'Scan Studio only talks to a bridge on this computer (127.0.0.1 or localhost).';
  }
  return null;
}

export function normalizeBridgeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* RGB (3 bytes per pixel) to RGBA for canvas ImageData. */
export function rgbToRgba(rgb: Uint8Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    out[i * 4] = rgb[j]; out[i * 4 + 1] = rgb[j + 1]; out[i * 4 + 2] = rgb[j + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}

export function decodePoints(frame: Pick<BridgeFrame, 'points' | 'point_colors' | 'n'>): { xyz: Float32Array; rgb: Uint8Array } {
  const raw = b64ToBytes(frame.points);
  const xyz = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const rgb = b64ToBytes(frame.point_colors);
  if (xyz.length !== frame.n * 3 || rgb.length !== frame.n * 3) throw new Error('The bridge sent a damaged frame.');
  return { xyz, rgb };
}

/* Percent error of each measured size against a known truth
 * (simulate mode only: a real robot's truth is the tape measure). */
export function dimsError(dims: ScanDimsMm, truth: ScanDimsMm): ScanDimsMm {
  const e = (a: number, b: number) => Math.round((Math.abs(a - b) / b) * 1000) / 10;
  return { length: e(dims.length, truth.length), width: e(dims.width, truth.width), height: e(dims.height, truth.height) };
}

export function scanFileName(robotName: string, at: Date): string {
  const slug = robotName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'robot';
  return `${slug}-realsense-${at.toISOString().slice(0, 10)}.ply`;
}

/* Attach a RealSense scan to a robot's "RealSense scan" slot, the one
 * Improve this twin measures from. Same record shape as the Workshop's
 * slot upload: replaces that slot and mirrors into `scan` (the
 * Overview viewer). Returns null when the robot is gone or archived. */
export function attachRealsenseScan(robots: GarageRobot[], robotId: string, meta: Omit<SlotScan, 'kind'>): GarageRobot[] | null {
  const target = robots.find((r) => r.id === robotId);
  if (!target || target.archivedAt) return null;
  const slot: SlotScan = { ...meta, kind: 'realsense' };
  return robots.map((r) => {
    if (r.id !== robotId) return r;
    const scans = [...(r.scans ?? []).filter((s) => s.kind !== 'realsense'), slot];
    return { ...r, scans, scan: { name: slot.name, format: slot.format, bytes: slot.bytes, addedAt: slot.addedAt } };
  });
}
