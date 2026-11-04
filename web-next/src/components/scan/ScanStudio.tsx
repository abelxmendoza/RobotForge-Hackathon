'use client';
/* Scan Studio: scan a real robot with an Intel RealSense depth camera.
 *
 * A browser tab cannot read a RealSense depth stream (no shipped web
 * API), so the camera is read by a small open-source bridge on the
 * user's own computer (tools/scan_bridge.py: librealsense + Open3D),
 * and this page talks to it over 127.0.0.1 only. Live colour, depth
 * and a 3D point cloud; record a walk-around; Build fuses it into one
 * scan with sizes measured from real depth; then download the PLY or
 * put it in a robot's RealSense scan slot, where Improve this twin
 * applies the sizes. Nothing is uploaded anywhere. */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import PointStage, { type PushPoints } from './PointStage';
import { readStore, writeStore } from '@/lib/store';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { OMEGA1_ROBOT_ID } from '@/lib/omega1Garage';
import { saveScanFile, saveSlotScanFile } from '@/lib/scanStore';
import { fmtBytes } from '@/lib/scan3d';
import {
  attachRealsenseScan, b64ToBytes, BRIDGE_URL_KEY, bridgeUrlProblem, decodePoints, DEFAULT_BRIDGE,
  dimsError, normalizeBridgeUrl, rgbToRgba, scanFileName,
  type BridgeFrame, type BridgeStatus, type BuildResult,
} from '@/lib/scanBridge';
import type { SlotScan } from '@/lib/scan3d';

type Conn = 'idle' | 'connecting' | 'connected' | 'offline';

function readUrl(): string {
  try { return window.localStorage.getItem(BRIDGE_URL_KEY) || DEFAULT_BRIDGE; } catch { return DEFAULT_BRIDGE; }
}

async function call<T>(base: string, path: string, post = false): Promise<T> {
  const r = await fetch(base + path, { method: post ? 'POST' : 'GET', cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `The bridge answered ${r.status}.`);
  return data as T;
}

/* With `robot` the Studio scans that one robot (the Workshop's camera
 * window): no robot picker, it connects on open, and the scan is handed
 * to `onAttach` so the Workshop saves it through its own state. */
export type StudioRobot = { id: string; name: string };
export default function ScanStudio({ robot: fixed, onAttach, autoConnect = false, onDone }: {
  robot?: StudioRobot;
  onAttach?: (meta: Omit<SlotScan, 'kind'>) => string | null;
  autoConnect?: boolean;
  onDone?: () => void;
} = {}) {
  const [url, setUrl] = useState(DEFAULT_BRIDGE);
  const [conn, setConn] = useState<Conn>('idle');
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [frames, setFrames] = useState(0);
  const [recStart, setRecStart] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [ply, setPly] = useState<ArrayBuffer | null>(null);
  const [robots, setRobots] = useState<GarageRobot[]>([]);
  const [target, setTarget] = useState('');
  const [attached, setAttached] = useState<{ id: string; name: string } | null>(null);
  const colorRef = useRef<HTMLCanvasElement>(null);
  const depthRef = useRef<HTMLCanvasElement>(null);
  const pushRef = useRef<PushPoints | null>(null);
  const live = useRef(false);
  const recordingRef = useRef(false);
  const mounted = useRef(true);
  const baseRef = useRef(DEFAULT_BRIDGE);
  const base = normalizeBridgeUrl(url);
  baseRef.current = base;
  recordingRef.current = recording;
  const subject = fixed?.name ?? 'Omega1';

  useEffect(() => { setUrl(readUrl()); }, []);
  useEffect(() => {
    if (fixed) { setRobots([{ id: fixed.id, name: fixed.name } as GarageRobot]); setTarget(fixed.id); return; }
    const active = readStore<GarageRobot[]>(GARAGE_KEY, []).filter((r) => !r.archivedAt);
    setRobots(active);
    setTarget((t) => t || (active.find((r) => r.id === OMEGA1_ROBOT_ID)?.id ?? active[0]?.id ?? ''));
  }, [result, fixed]);
  // Closing the window stops the live view, and stops a recording so the
  // bridge doesn't keep filling the disk with frames nobody will build.
  useEffect(() => {
    mounted.current = true;
    return () => {
    mounted.current = false;
    live.current = false;
    if (recordingRef.current) void fetch(baseRef.current + '/record/stop', { method: 'POST' }).catch(() => undefined);
  };
  }, []);

  const draw = (canvas: HTMLCanvasElement | null, b64: string, w: number, h: number) => {
    if (!canvas) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.getContext('2d')?.putImageData(new ImageData(rgbToRgba(b64ToBytes(b64), w, h), w, h), 0, 0);
  };

  const poll = useCallback(async (b: string) => {
    while (live.current) {
      const t0 = performance.now();
      try {
        const f = await call<BridgeFrame>(b, '/frame');
        draw(colorRef.current, f.color, f.w, f.h);
        draw(depthRef.current, f.depth, f.w, f.h);
        const { xyz, rgb } = decodePoints(f);
        pushRef.current?.(xyz, rgb);
        setFrames(f.frames_recorded);
        setRecording(f.recording);
      } catch (e) {
        if (!live.current) return;
        live.current = false;
        setConn('offline');
        setMessage('Lost the bridge: ' + (e as Error).message + ' Is tools/scan_bridge.py still running?');
        return;
      }
      const wait = Math.max(0, 110 - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, document.hidden ? 600 : wait));
    }
  }, []);

  const connect = async (quiet = false) => {
    const problem = bridgeUrlProblem(base);
    if (problem) { setMessage(problem); return; }
    setConn('connecting');
    setMessage('');
    try {
      const st = await call<BridgeStatus>(base, '/status');
      try { window.localStorage.setItem(BRIDGE_URL_KEY, base); } catch { /* fine */ }
      setStatus(st);
      setFrames(st.frames_recorded);
      setRecording(st.recording);
      setConn('connected');
      live.current = true;
      void poll(base);
    } catch {
      setConn(quiet ? 'idle' : 'offline');
      if (quiet) return;
      setMessage(`No bridge answered at ${base}. Start it with python3 tools/scan_bridge.py (add --simulate to try it without a camera), then press Connect again. Safari blocks pages from reaching this computer: use Chrome or Edge, and allow local network access if asked. If the bridge is already running and says it is ready, it may not allow this page: restart it with --allow-origin ${window.location.origin}`);
    }
  };

  // The camera window tries the bridge once on open, silently: if it isn't
  // running yet, the steps to start it are already on screen.
  const tried = useRef(false);
  useEffect(() => {
    if (!autoConnect || tried.current || url !== readUrl()) return;
    tried.current = true;
    void connect(true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = () => { live.current = false; setConn('idle'); setStatus(null); };

  const startRec = async () => {
    setMessage(''); setResult(null); setPly(null); setAttached(null);
    try {
      await call(base, '/record/start', true);
      // Closed while the start was in flight: stop it, nobody can see it.
      if (!mounted.current) { void fetch(base + '/record/stop', { method: 'POST' }).catch(() => undefined); return; }
      recordingRef.current = true;
      setRecording(true); setRecStart(Date.now()); setFrames(0);
    }
    catch (e) { setMessage((e as Error).message); }
  };
  const stopRec = async () => {
    try { await call(base, '/record/stop', true); setRecording(false); }
    catch (e) { setMessage((e as Error).message); }
  };
  const build = async () => {
    setBuilding(true); setMessage(''); setAttached(null);
    try {
      const r = await call<BuildResult>(base, '/build', true);
      setRecording(false);
      const resp = await fetch(base + '/scan.ply', { cache: 'no-store' });
      if (!resp.ok) throw new Error('The scan was built but its file could not be read.');
      setPly(await resp.arrayBuffer());
      setResult(r);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const download = () => {
    if (!ply) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ply], { type: 'application/octet-stream' }));
    a.download = scanFileName(robots.find((r) => r.id === target)?.name ?? 'robot', new Date());
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const attach = async () => {
    if (!ply || !result || !target) return;
    const robot = robots.find((r) => r.id === target);
    if (!robot) return;
    setMessage('');
    try {
      const name = scanFileName(robot.name, new Date());
      await saveSlotScanFile(robot.id, 'realsense', new Blob([ply]));
      // The record also becomes the Overview's primary scan, which reads its own key.
      await saveScanFile(robot.id, new Blob([ply]));
      const meta = { name, format: 'ply' as const, bytes: ply.byteLength, addedAt: new Date().toISOString() };
      if (onAttach) {
        const failed = onAttach(meta);
        if (failed) { setMessage(failed); return; }
        setAttached({ id: robot.id, name: robot.name });
        return;
      }
      const next = attachRealsenseScan(readStore<GarageRobot[]>(GARAGE_KEY, []), robot.id, meta);
      if (!next) { setMessage(`${robot.name} was archived or removed meanwhile. Pick another robot.`); return; }
      const err = writeStore(GARAGE_KEY, next);
      if (err) { setMessage(err); return; }
      setAttached({ id: robot.id, name: robot.name });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const secs = recStart && recording ? Math.round((Date.now() - recStart) / 1000) : null;
  const simulated = Boolean(status?.simulated || result?.measured_by === 'simulated');
  const err = result?.truth_mm ? dimsError(result.dims_mm, result.truth_mm) : null;

  return (
    <div className="studio">
      <section className="studio-connect" aria-label="Connect the camera">
        <label className="studio-url">
          <span className="faint g-small">Bridge on this computer</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={conn === 'connected'} spellCheck={false} />
        </label>
        {conn === 'connected' ? (
          <button type="button" className="btn btn-sm" onClick={disconnect}>Disconnect</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { void connect(); }} disabled={conn === 'connecting'}>
            {conn === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
        )}
        {status && (
          <span className="studio-cam">
            <span className={'fbadge ' + (status.simulated ? 'planned' : 'live')}>{status.simulated ? 'SIMULATED' : 'LIVE'}</span>{' '}
            {status.camera} · {status.intrinsics.width}×{status.intrinsics.height}
          </span>
        )}
      </section>
      {message && <p className="g-error" role="alert">{message}</p>}

      {conn !== 'connected' && !result && (
        <section className="studio-empty" aria-label={`How to scan ${subject}`}>
          <h2>Scan {subject} with a RealSense</h2>
          <p className="faint">
            Browsers can&apos;t read a RealSense&apos;s depth stream, so a small open-source bridge runs on the
            computer the camera is plugged into. It only listens on this computer, and nothing is uploaded.
          </p>
          <ol className="studio-steps">
            <li>Plug the RealSense (D415, D435 or D455) into a USB 3 port.</li>
            <li>Install the open-source pieces: <code>pip install numpy pyrealsense2 open3d</code></li>
            <li>From the RobotForge repo, start the bridge: <code>python3 tools/scan_bridge.py</code><br />
              <span className="faint g-small">No camera handy? <code>python3 tools/scan_bridge.py --simulate</code> streams a synthetic test rover with a known size, so you can try every step.</span></li>
            <li>Press <strong>Connect</strong> above (Chrome or Edge; allow local network access if asked).</li>
          </ol>
          <h3>Walking around {subject}</h3>
          <ul className="studio-steps">
            <li>Set {subject} on a table or the floor with clear space all round. Plain floor is fine: the bridge finds it and removes it.</li>
            <li>Hold the camera 40–80 cm away. Closer than 15 cm or farther than 1 m is ignored, which cuts the room out.</li>
            <li>Press <strong>Record</strong>, walk one slow loop at chassis height, then a second loop looking down from above. 30–60 seconds is plenty.</li>
            <li>Even light helps tracking. Keep {subject} in view the whole time.</li>
          </ul>
        </section>
      )}

      {conn === 'connected' && (
        <section className="studio-live" aria-label="Live camera">
          <div className="studio-feeds">
            <figure><canvas ref={colorRef} aria-label="Colour camera" /><figcaption>Colour</figcaption></figure>
            <figure><canvas ref={depthRef} aria-label="Depth camera, near is warm, far is cool" /><figcaption>Depth (near warm, far cool)</figcaption></figure>
          </div>
          <figure className="studio-cloud">
            <PointStage label="Live 3D point cloud from the depth camera. Drag to orbit." onReady={(push) => { pushRef.current = push; }} height={300} />
            <figcaption>Live 3D points, from real depth</figcaption>
          </figure>
          <div className="studio-actions">
            {recording ? (
              <button type="button" className="btn btn-sm studio-rec on" onClick={() => { void stopRec(); }}>■ Stop</button>
            ) : (
              <button type="button" className="btn btn-sm studio-rec" onClick={() => { void startRec(); }} disabled={building}>● Record walk-around</button>
            )}
            <span className="faint g-small" role="status">
              {recording ? `Recording: ${frames} frames${secs !== null ? `, ${secs} s` : ''}` : frames ? `${frames} frames recorded` : 'Not recording'}
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void build(); }} disabled={building || frames < 8}>
              {building ? 'Building the scan…' : 'Build scan'}
            </button>
          </div>
          {status?.session && <p className="faint g-small">Frames are saved on your computer in <code>{status.session}</code>, so a heavier photogrammetry pass can run on the same session later.</p>}
        </section>
      )}

      {result && ply && (
        <section className="studio-result" aria-label="Your scan">
          <h2>Your scan</h2>
          <PointStage ply={ply} label="The fused scan. Drag to orbit, scroll to zoom." height={380} />
          <table className="studio-dims">
            <thead><tr><th></th><th>Length</th><th>Width</th><th>Height</th></tr></thead>
            <tbody>
              <tr><th scope="row">{simulated ? 'Measured (simulated camera)' : 'Measured'}</th>
                <td>{result.dims_mm.length} mm</td><td>{result.dims_mm.width} mm</td><td>{result.dims_mm.height} mm</td></tr>
              {result.truth_mm && err && (
                <tr><th scope="row">True size</th>
                  <td>{result.truth_mm.length} mm <span className="faint">({err.length}% off)</span></td>
                  <td>{result.truth_mm.width} mm <span className="faint">({err.width}% off)</span></td>
                  <td>{result.truth_mm.height} mm <span className="faint">({err.height}% off)</span></td></tr>
              )}
            </tbody>
          </table>
          <p className="g-small">
            <span className={'fbadge ' + (simulated ? 'planned' : 'live')}>{simulated ? 'SIMULATED' : 'MEASURED'}</span>{' '}
            {result.accuracy_note} Length and width are the smallest box around the footprint; height runs from the floor to the top.
          </p>
          <p className="faint g-small">
            {result.method === 'tsdf-mesh' ? 'Colour mesh fused with Open3D (TSDF)' : 'Colour point cloud'} from {result.frames_used} frames
            {result.frames_lost ? ` (${result.frames_lost} skipped where tracking slipped)` : ''}, {result.points.toLocaleString()} points, {fmtBytes(result.ply_bytes)}.
            {!result.floor_found && ' No floor was found, so height is measured from the lowest point.'}
            {' '}It is a colour-textured scan from the camera&apos;s own depth and colour, not photogrammetry.
          </p>
          <div className="studio-actions">
            <button type="button" className="btn btn-sm" onClick={download}>Download PLY</button>
            {simulated ? (
              <span className="faint g-small">A simulated scan can&apos;t be added to a robot: it is not your robot.</span>
            ) : fixed ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { void attach(); }} disabled={Boolean(attached)}>
                {attached ? `Saved to ${fixed.name}` : `Save as ${fixed.name}'s RealSense scan`}
              </button>
            ) : robots.length ? (
              <>
                <label className="g-small">Add to{' '}
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { void attach(); }}>Add as its RealSense scan</button>
              </>
            ) : (
              <span className="faint g-small">To keep it with a robot, first add one in the <Link href="/garage/#omega1">Workshop</Link> (Omega1 is built in).</span>
            )}
          </div>
          {!fixed && !simulated && robots.length > 0 && !robots.some((r) => r.id === OMEGA1_ROBOT_ID) && (
            <p className="faint g-small">Scanning Omega1? Add your copy first: <Link href="/garage/#omega1">open Omega1 in the Workshop</Link>.</p>
          )}
          {attached && fixed && (
            <p className="studio-done" role="status">
              Saved. {fixed.name}&apos;s Overview now shows this scan under <strong>Your 3D scan</strong>. To put the measured
              sizes into its spec, open <strong>Improve this twin → Step 2</strong>; that saves a new version, nothing is overwritten.{' '}
              {onDone && <button type="button" className="btn btn-sm" onClick={onDone}>Done</button>}
            </p>
          )}
          {attached && !fixed && (
            <p className="studio-done" role="status">
              Added to {attached.name} as its RealSense scan. Next: open{' '}
              <Link href={attached.id === OMEGA1_ROBOT_ID ? '/garage/#omega1' : '/garage/'}>{attached.name} in the Workshop</Link>
              {' '}and use <strong>Improve this twin → Step 2</strong> to put these measured sizes into its spec. They are saved as a new version, nothing is overwritten.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
