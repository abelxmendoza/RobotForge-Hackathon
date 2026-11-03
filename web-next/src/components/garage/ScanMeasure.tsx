'use client';
/* Measure a stored robot's scan and, on the owner's tap, turn the
 * measured size into spec dimensions.
 *
 * The measurement is the one RobotForge already trusts: the PLY
 * bounding box from components/forge/scan.ts, with its visible unit
 * rule (metres assumed; a largest extent over 20 is treated as
 * millimetres and converted, saying so). Axes follow the convention
 * the Forge scan flow already states on screen: x → length,
 * y → width, z → height, as stored in the file.
 *
 * GLB/OBJ scans are viewable in the Garage but are NOT measured
 * here — no Garage code measures a mesh, and inventing a second
 * measuring path for this card would be worse than saying so. */
import { useEffect, useState } from 'react';
import { measureCloud, parsePly, type Measure } from '@/components/forge/scan';
import { readScanFile, readSlotScanFile } from '@/lib/scanStore';
import type { ScanKind, ScanMeta } from '@/lib/scan3d';

export interface ScanDims { length_m: number; width_m: number; height_m: number }

type State =
  | { kind: 'working' }
  | { kind: 'measured'; measure: Extract<Measure, { ok: true }> }
  | { kind: 'unmeasurable'; reason: string }
  | { kind: 'missing' }
  | { kind: 'applied'; measure: Extract<Measure, { ok: true }> };

export default function ScanMeasure({ robotId, scan, onApply, slotKind, showPreviewNote = true }: {
  robotId: string;
  scan: ScanMeta;
  onApply: (dims: ScanDims, scanName: string, unitNote: string) => void;
  /* Set when the scan lives in an Improve-this-twin slot (per-slot
   * IndexedDB key) instead of the robot's primary scan slot. */
  slotKind?: ScanKind;
  showPreviewNote?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (scan.format !== 'ply') return;
    let disposed = false;
    setState({ kind: 'working' });
    (async () => {
      try {
        const data = slotKind ? await readSlotScanFile(robotId, slotKind) : await readScanFile(robotId);
        if (disposed) return;
        if (!data) { setState({ kind: 'missing' }); return; }
        const parsed = parsePly(data);
        const m = measureCloud(parsed.positions);
        if (disposed) return;
        setState(m.ok ? { kind: 'measured', measure: m } : { kind: 'unmeasurable', reason: m.reason });
      } catch (e) {
        if (!disposed) setState({ kind: 'unmeasurable', reason: (e as Error).message });
      }
    })();
    return () => { disposed = true; };
  }, [robotId, scan.addedAt, scan.format, slotKind]);

  const mm = (v: number) => `${Math.round(v * 1000)} mm`;

  return (
    <div className="scan-measure">
      <h4>Measure this scan</h4>
      <p className="faint g-small">
        Scan files stay in this browser (IndexedDB) — they are not uploaded to RobotForge or synced
        with your account.
      </p>
      {scan.format !== 'ply' ? (
        <p className="faint g-small">
          RobotForge measures PLY scans — the format its measuring code reads (a RealSense point
          cloud, or Scaniverse: Share → Export → PLY). This {scan.format.toUpperCase()} scan shows in
          the viewer above, but its size is not measured in the Garage.
        </p>
      ) : (
        <>
          {showPreviewNote && (
            <p className="faint g-small">
              The preview above is points drawn from the file — a point preview, not a photoreal render.
            </p>
          )}
          {state.kind === 'working' && <p className="faint g-small" role="status">Measuring {scan.name}…</p>}
          {state.kind === 'missing' && (
            <p className="faint g-small">This scan is saved in another browser, so there is nothing here to measure.</p>
          )}
          {state.kind === 'unmeasurable' && <p className="g-error" role="alert">Could not measure this scan: {state.reason}</p>}
          {(state.kind === 'measured' || state.kind === 'applied') && (
            <>
              <p className="g-small">
                Measured size — the bounding box of {state.measure.count.toLocaleString('en-US')} points,
                axes as stored in the file (x → length, y → width, z → height):{' '}
                <strong>length {mm(state.measure.extentsM[0])} · width {mm(state.measure.extentsM[1])} · height {mm(state.measure.extentsM[2])}</strong>
                {state.measure.unitNote ? <> — {state.measure.unitNote}</> : null}
              </p>
              {state.kind === 'measured' ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const e = state.measure.extentsM;
                    const r4 = (v: number) => Math.round(v * 10000) / 10000;
                    onApply({ length_m: r4(e[0]), width_m: r4(e[1]), height_m: r4(e[2]) }, scan.name, state.measure.unitNote);
                    setState({ kind: 'applied', measure: state.measure });
                  }}
                >
                  Use scan size as measured dimensions
                </button>
              ) : (
                <p className="faint g-small" role="status">
                  Saved as a new version with these dimensions — the version note names the scan and the
                  unit rule. A scan gives size only: mass, motors and voltage do not come from it.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
