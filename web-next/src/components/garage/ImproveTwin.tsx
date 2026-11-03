'use client';
/* "Improve this twin" — the guided upgrade for the owner's stored
 * Omega1, on its Overview, directly under the header. Four numbered
 * steps, each with ONE primary action and a done-state computed from
 * the real store (see improveStepStates): attach scans, measure from
 * the RealSense one, type the tape-measure numbers, confirm the
 * wiring. Plain language, big tap targets, nothing leaves the
 * browser: scan files live in this browser's IndexedDB, and every
 * save is a new version in the robot's own store. */
import { useRef, useState } from 'react';
import { getPath, type GarageRobot, type Spec } from '@/lib/garage';
import { improveStepStates, OMEGA1_MEASURE_FIELDS, type SpecConnection } from '@/lib/omega1Garage';
import { fmtBytes, scanFormat, scanProblem, SCAN_SLOTS, type ScanKind, type SlotScan } from '@/lib/scan3d';
import { removeScanFile, removeSlotScanFile, saveScanFile, saveSlotScanFile, readSlotScanFile } from '@/lib/scanStore';
import ScanMeasure, { type ScanDims } from './ScanMeasure';

/* Primary-scan file bookkeeping: when a slot is removed and another
 * remains, that file becomes the robot's primary (viewer) scan. */
export async function refreshPrimaryScanFile(robotId: string, remaining: SlotScan | undefined): Promise<void> {
  if (!remaining) { await removeScanFile(robotId); return; }
  const data = await readSlotScanFile(robotId, remaining.kind);
  if (data) await saveScanFile(robotId, new Blob([data]));
}

function SlotUpload({ robotId, kind, attached, fallback, onSlotSave }: {
  robotId: string;
  kind: ScanKind;
  attached: SlotScan | undefined;
  /* The newest OTHER slot — becomes the primary scan if this one goes. */
  fallback: SlotScan | undefined;
  onSlotSave: (kind: ScanKind, next: SlotScan | null) => string | null;
}) {
  const slot = SCAN_SLOTS.find((s) => s.kind === kind)!;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const add = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const fmt = scanFormat(file.name);
    if (fmt !== slot.format) {
      setError(fmt
        ? `That is a ${fmt.toUpperCase()} file — this slot takes ${slot.format.toUpperCase()}. In Scaniverse: Share → Export → ${slot.format.toUpperCase()}.`
        : `Pick a ${slot.format.toUpperCase()} file for this slot.`);
      return;
    }
    const problem = scanProblem(file.name, file.size);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await saveSlotScanFile(robotId, kind, file);
      /* The newest scan is also the robot's primary scan, so the
       * Overview viewer shows it without a second upload. */
      await saveScanFile(robotId, file);
      const failure = onSlotSave(kind, { kind, name: file.name, format: fmt, bytes: file.size, addedAt: new Date().toISOString() });
      if (failure) setError(failure);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy(true);
    try {
      await removeSlotScanFile(robotId, kind);
      /* If another slot remains, its file becomes the primary scan;
       * otherwise the primary scan goes too. */
      await refreshPrimaryScanFile(robotId, fallback);
      const failure = onSlotSave(kind, null);
      if (failure) setError(failure);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={'improve-slot' + (drag ? ' drag' : '')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files?.[0]); }}
    >
      <strong>{slot.label}</strong>
      <span className="faint g-small">{slot.gives}</span>
      {attached ? (
        <>
          <span className="g-small">
            {attached.name} · {fmtBytes(attached.bytes)} · added {new Date(attached.addedAt).toLocaleDateString()}
          </span>
          <span className="improve-actions">
            <button type="button" className="btn improve-btn" disabled={busy} onClick={() => input.current?.click()}>Replace</button>
            {confirmRemove ? (
              <span className="g-remove-confirm" role="alert">
                Remove this scan? <button type="button" className="btn improve-btn g-remove-yes" onClick={() => { void remove(); }}>Yes, remove</button>
                <button type="button" className="btn improve-btn" onClick={() => setConfirmRemove(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="btn improve-btn" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
            )}
          </span>
        </>
      ) : (
        <button type="button" className="btn improve-btn improve-drop" disabled={busy} onClick={() => input.current?.click()}>
          Drop the file here, or tap to choose it
        </button>
      )}
      <input ref={input} type="file" accept={slot.format === 'ply' ? '.ply' : '.glb,model/gltf-binary'} hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
      {busy && <span className="faint g-small" role="status">Saving in this browser…</span>}
      {error && <span className="g-error" role="alert">{error}</span>}
    </div>
  );
}

export default function ImproveTwin({ robot, draft, onSlotSave, onApplyScanSize, onSaveMeasured, onSaveConnections, onGoWiring }: {
  robot: GarageRobot;
  draft: Spec;
  onSlotSave: (kind: ScanKind, next: SlotScan | null) => string | null;
  onApplyScanSize: (dims: ScanDims, scanName: string, unitNote: string) => void;
  onSaveMeasured: (fields: { path: string; value: number }[]) => void;
  onSaveConnections: (next: SpecConnection[]) => void;
  onGoWiring: () => void;
}) {
  const savedSpec = robot.versions[robot.versions.length - 1]?.spec ?? {};
  const st = improveStepStates(robot, savedSpec);
  const realsense = robot.scans?.find((s) => s.kind === 'realsense');
  const conns: SpecConnection[] = Array.isArray(draft?.connections) ? draft.connections : [];

  /* Step 3's mini-form: display values (mm for lengths) seeded from
   * the draft; saving writes only the boxes actually filled in. */
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of OMEGA1_MEASURE_FIELDS) {
      const v = getPath(draft, f.path);
      if (typeof v === 'number') out[f.path] = f.unit === 'mm' ? String(Math.round(v * 1000)) : String(v);
    }
    return out;
  });
  const saveNumbers = () => {
    const fields: { path: string; value: number }[] = [];
    for (const f of OMEGA1_MEASURE_FIELDS) {
      const raw = (vals[f.path] ?? '').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) continue;
      fields.push({ path: f.path, value: f.unit === 'mm' ? n / 1000 : n });
    }
    if (fields.length) onSaveMeasured(fields);
  };
  const filledCount = OMEGA1_MEASURE_FIELDS.filter((f) => (vals[f.path] ?? '').trim()).length;

  const confirmConn = (i: number) => {
    onSaveConnections(conns.map((c, j) => (j === i ? { ...c, verifiedAt: new Date().toISOString() } : c)));
  };

  return (
    <section className="improve-card" aria-label="Improve this twin">
      <div className="improve-head">
        <h3>Improve this twin</h3>
        <span className="fbadge live">{st.done} of 4 done</span>
      </div>
      <p className="faint">
        Four steps turn this record-seeded copy into an accurate twin of your real Omega1. Scans stay in
        this browser — nothing is uploaded — and every save is a new version, so nothing is overwritten.
      </p>

      <details className="improve-step" open={!st.scans}>
        <summary><strong>Step 1 · Add your scans</strong> — what this gives you: the look, the true size, and a textured model of your real robot</summary>
        <div className="improve-body">
          {SCAN_SLOTS.map((s) => (
            <SlotUpload key={s.kind} robotId={robot.id} kind={s.kind}
              attached={robot.scans?.find((x) => x.kind === s.kind)}
              fallback={robot.scans?.filter((x) => x.kind !== s.kind).at(-1)}
              onSlotSave={onSlotSave} />
          ))}
          <p className="faint g-small">
            A point scan is a point preview, not a photoreal render — the photo model (GLB) is the one
            that looks solid. The ProjectSim twin stays labelled ESTIMATED either way.
          </p>
        </div>
      </details>

      <details className="improve-step" open={!st.measured}>
        <summary><strong>Step 2 · Measure from your RealSense scan</strong> — what this gives you: real dimensions in the spec, measured — not the vendor envelope</summary>
        <div className="improve-body">
          {!realsense ? (
            <p className="g-small">
              Waiting for a RealSense scan (step 1) — that is the scan with true scale, so the
              dimensions come from it, not from the prettier one.
            </p>
          ) : (
            <>
              {st.measured && <p className="g-small">Done — dimensions were saved from a scan. Measuring a newer scan replaces them in a new version.</p>}
              <ScanMeasure robotId={robot.id} scan={realsense} slotKind="realsense" showPreviewNote={false} onApply={onApplyScanSize} />
            </>
          )}
        </div>
      </details>

      <details className="improve-step" open={!st.numbers}>
        <summary><strong>Step 3 · Add the tape-measure numbers</strong> — what this gives you: the numbers no scan can take — mass, clearance, wheel size</summary>
        <div className="improve-body">
          <p className="g-small">{st.numbersIn} of {OMEGA1_MEASURE_FIELDS.length} numbers are in the saved spec. Fill in what you measure; empty boxes are skipped, and saving makes one new version badged as measured, with today&apos;s date.</p>
          <div className="improve-form">
            {OMEGA1_MEASURE_FIELDS.map((f) => (
              <label key={f.path} className="improve-field">
                <span>{f.label}</span>
                <span className="improve-input">
                  <input inputMode="decimal" value={vals[f.path] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.path]: e.target.value }))} placeholder="—" />
                  <span className="faint">{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary improve-btn" disabled={filledCount === 0} onClick={saveNumbers}>
            Save measured numbers as a new version
          </button>
        </div>
      </details>

      <details className="improve-step" open={!st.wiring}>
        <summary><strong>Step 4 · Check the wiring map</strong> — what this gives you: every connection checked against the real robot</summary>
        <div className="improve-body">
          <p className="g-small">{st.confirmed} of {st.connTotal} connections confirmed. The list came from Omega1&apos;s repo records — tap Confirm as you check each one on the bench.</p>
          <ul className="ws-conn-list">
            {conns.map((c, i) => (
              <li key={i} className="ws-conn-row">
                <span className="ws-conn-main">
                  <strong>{c.from}</strong> → <strong>{c.to}</strong>
                  {c.detail && <span className="faint"> — {c.detail}</span>}
                </span>
                {c.verifiedAt ? (
                  <span className="faint g-small">Confirmed {new Date(c.verifiedAt).toLocaleDateString()}</span>
                ) : (
                  <button type="button" className="btn improve-btn" onClick={() => confirmConn(i)}>Confirm</button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn improve-btn" onClick={onGoWiring}>Open the full wiring map</button>
        </div>
      </details>
    </section>
  );
}
