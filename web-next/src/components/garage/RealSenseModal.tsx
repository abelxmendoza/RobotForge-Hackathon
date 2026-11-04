'use client';
/* Intel RealSense, live in the browser: a RealSense plugged in
 * over USB shows up as an ordinary camera device, so this modal
 * opens its live view with getUserMedia and lets the user pick
 * between cameras when more than one is attached.
 *
 * Honesty (the standing rule): what shows here is the camera's
 * ordinary colour (RGB) video view. It is not a depth scan, and
 * nothing in this view is measured — no dimensions, no point
 * cloud. The measured path stays the product's approved one:
 * capture in Intel RealSense Viewer, export the .ply, and attach
 * it through "Add a scan through Wrench", where scans are
 * measured in the browser.
 *
 * There is deliberately no "capture frame" button: the only
 * programmatic file channel into Wrench (lib/handoff) is consumed
 * once when the Workshop's thread mounts, and this modal lives on
 * that same already-mounted page, so a captured still would sit
 * unclaimed. The live view plus the Viewer guidance is the whole
 * offer — nothing about it is faked.
 *
 * Closing the modal (button, backdrop, or Esc) stops every track
 * of the stream, so the camera light goes off and the device is
 * released. No storage is touched. */
import { useCallback, useEffect, useRef, useState } from 'react';

type CamState =
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'denied' }
  | { kind: 'none-found' }
  | { kind: 'unavailable'; message: string };

export default function RealSenseModal({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [state, setState] = useState<CamState>({ kind: 'starting' });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async (wantDeviceId: string) => {
    stopStream();
    setState({ kind: 'starting' });
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: 'unavailable', message: 'This browser cannot open cameras here (camera access needs a secure page). Try the browser you normally use for the Workshop.' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: wantDeviceId ? { deviceId: { exact: wantDeviceId } } : true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { /* autoplay policies: the element is muted + playsInline */ });
      }
      const track = stream.getVideoTracks()[0];
      if (track) setDeviceId((cur) => cur || track.getSettings().deviceId || '');
      /* Labels only arrive after permission, so enumerate now. */
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      setDevices(all.filter((d) => d.kind === 'videoinput'));
      setState({ kind: 'live' });
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'NotAllowedError') setState({ kind: 'denied' });
      else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') setState({ kind: 'none-found' });
      else setState({ kind: 'unavailable', message: `The camera would not start (${err?.message || 'unknown error'}). Check the USB cable and try again.` });
    }
  }, [stopStream]);

  /* Open: show the dialog and start the camera. Close (any route):
   * stop every track before the dialog goes away. */
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void (async () => {
        const all = await navigator.mediaDevices?.enumerateDevices().catch(() => [] as MediaDeviceInfo[]) ?? [];
        const cams = all.filter((x) => x.kind === 'videoinput');
        setDevices(cams);
        if (!cams.length && typeof navigator.mediaDevices?.getUserMedia === 'function') {
          /* Zero listed cameras can still mean "permission not yet
           * granted" on some browsers — try opening one before
           * declaring none found; start() sorts out the states. */
          void start('');
          return;
        }
        if (!cams.length) { setState({ kind: 'none-found' }); return; }
        void start('');
      })();
    }
    if (!open && d.open) d.close();
    if (!open) stopStream();
  }, [open, start, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  return (
    <dialog
      ref={dialogRef}
      className="dex-modal rs-modal"
      aria-labelledby="rs-modal-title"
      onClose={() => { stopStream(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); /* backdrop */ }}
    >
      <div className="dex-modal-head">
        <h2 id="rs-modal-title">Intel RealSense camera — live view</h2>
        <p className="faint">Plug the RealSense in over USB and its live colour view shows here.</p>
        <button type="button" className="fc-close" onClick={onClose} aria-label="Close the camera view">✕</button>
      </div>
      <div className="rs-body">
        {state.kind === 'live' || state.kind === 'starting' ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="rs-video" autoPlay playsInline muted />
            {state.kind === 'starting' && <p className="faint" role="status">Starting the camera…</p>}
          </>
        ) : state.kind === 'denied' ? (
          <p role="status"><strong>The browser did not get camera permission.</strong> Allow camera access for this site in the browser's address-bar or settings, check the RealSense's USB cable is seated, then reopen this window.</p>
        ) : state.kind === 'none-found' ? (
          <p role="status"><strong>No camera found.</strong> Check the RealSense's USB cable (a data cable, straight into the computer — some hubs and charge-only cables will not carry it), then reopen this window.</p>
        ) : (
          <p role="status">{state.message}</p>
        )}
        {devices.length > 1 && (
          <label className="rs-picker">
            <span>Camera</span>
            <select
              value={deviceId}
              onChange={(e) => { setDeviceId(e.target.value); void start(e.target.value); }}
            >
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
              ))}
            </select>
          </label>
        )}
        <p>
          This view is the camera's ordinary colour video — <strong>not a depth scan</strong>, and
          nothing here is measured. For a measured scan, capture in{' '}
          <strong>Intel RealSense Viewer</strong>, export the <strong>.ply</strong>, then attach it
          through <strong>Add a scan through Wrench</strong> — scans attached there are measured
          in your browser.
        </p>
        <div className="rs-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
