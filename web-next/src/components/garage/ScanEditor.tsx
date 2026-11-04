'use client';
/* Add, replace or remove the robot's 3D scan. The file goes to this
 * browser's IndexedDB first; only then is the small record saved. */
import Link from 'next/link';
import { useRef, useState } from 'react';
import { removeScanFile, saveScanFile } from '@/lib/scanStore';
import { scanFormat, scanProblem, type ScanMeta } from '@/lib/scan3d';

export default function ScanEditor({ robotId, scan, onSave }: {
  robotId: string;
  scan: ScanMeta | undefined;
  onSave: (next: ScanMeta | null) => string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const add = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const problem = scanProblem(file.name, file.size);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await saveScanFile(robotId, file);
      const failure = onSave({ name: file.name, format: scanFormat(file.name)!, bytes: file.size, addedAt: new Date().toISOString() });
      if (failure) setError(failure);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    try { await removeScanFile(robotId); } catch { /* the record goes either way */ }
    onSave(null);
  };

  return (
    <div className="ps-edit">
      {!scan && (
        <p className="faint g-small">
          Scan the robot with a phone app such as Scaniverse (free; Share → Export model → GLB), Polycam or
          Apple Object Capture, or with a RealSense depth camera in <Link href="/scan/">Scan Studio</Link> (or <code>tools/realsense_scan.py</code>), then upload
          the GLB, OBJ or PLY here. It stays in this browser.
        </p>
      )}
      <div className="ps-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {scan ? 'Replace the scan' : 'Upload a 3D scan'}
        </button>
        {scan && (confirmRemove ? (
          <span className="g-remove-confirm" role="alert">
            Remove the 3D scan? <button type="button" className="btn btn-sm g-remove-yes" onClick={() => { void remove(); }}>Yes, remove</button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(true)}>Remove scan</button>
        ))}
        <input ref={input} type="file" accept=".glb,.obj,.ply,model/gltf-binary" hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {busy && <p className="faint g-small" role="status">Saving the scan in this browser…</p>}
      {error && <p className="g-error" role="alert">{error}</p>}
    </div>
  );
}
