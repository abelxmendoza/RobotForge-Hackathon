'use client';
/* Photo spin: real photos of the robot taken while walking around it,
 * played back as a view you drag to turn. This is the photorealistic
 * 360: it IS the robot, not a model of it. Photos (or a walk-around
 * video) are shrunk in the browser and stored with the robot. */
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { spinFrame, videoFrames } from '@/lib/image';
import {
  evenPick, frameAfterDrag, naturalOrder, removePhotoFromSet, stepFrame,
  SPIN_MAX_FRAMES, SPIN_MIN_FRAMES, SPIN_VIDEO_FRAMES, type PhotoSpin as Spin,
} from '@/lib/photoSpin';
import type { ScanMeta } from '@/lib/scan3d';
import { promptWrench } from '@/lib/wrenchPrompt';
import ScanMeasure, { type ScanDims } from './ScanMeasure';

const ScanView = dynamic(() => import('./ScanView'), {
  ssr: false,
  loading: () => <p className="faint scan-wait">Loading the 3D viewer…</p>,
});

export function PhotoSpinViewer({ spin, name }: { spin: Spin; name: string }) {
  const n = spin.frames.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Slow auto-turn until touched; about 4 seconds per turn.
  useEffect(() => {
    if (!playing || n < 2) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setPlaying(false); return; }
    const t = setInterval(() => setI((x) => stepFrame(x, 1, n)), Math.max(60, 4000 / n));
    return () => clearInterval(t);
  }, [playing, n]);

  // Decode every frame up front so dragging never flickers.
  useEffect(() => {
    spin.frames.forEach((src) => { const im = new Image(); im.src = src; });
  }, [spin.frames]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    setPlaying(false);
    drag.current = { x: e.clientX, start: i };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setI(frameAfterDrag(drag.current.start, e.clientX - drag.current.x, box.current?.clientWidth ?? 600, n));
  };
  const up = () => { drag.current = null; };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setPlaying(false);
      setI((x) => stepFrame(x, e.key === 'ArrowLeft' ? 1 : -1, n));
    }
  };

  return (
    <div className="ps-view">
      <div
        ref={box}
        className="ps-stage"
        role="img"
        aria-label={`Photo spin of ${name}, frame ${i + 1} of ${n}. Drag or use the arrow keys to turn it.`}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={spin.frames[i]} alt="" draggable={false} />
        <span className="ps-hint" aria-hidden="true">⟲ drag to turn</span>
      </div>
      <div className="ps-bar">
        <button type="button" className="btn btn-sm" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Spin'}
        </button>
        <input
          type="range" min={0} max={n - 1} value={i}
          aria-label="Turn the robot"
          onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
        />
        <span className="faint g-small">{i + 1}/{n}</span>
      </div>
    </div>
  );
}

/* Add, replace or remove the spin. onSave returns an error message when
 * the browser would not store it (usually: storage full). */
export function PhotoSpinEditor({ spin, onSave, compact }: {
  spin: Spin | undefined;
  onSave: (next: Spin | null) => string | null;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const photos = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);

  const save = (frames: string[], source: Spin['source']) => {
    const failure = onSave({ frames, source, addedAt: new Date().toISOString() });
    if (failure) setError(`${failure} A photo spin needs about ${Math.round(frames.reduce((a, f) => a + f.length, 0) / 1024)} KB.`);
  };

  const fromPhotos = async (list: FileList | null) => {
    setError(null);
    const files = naturalOrder(Array.from(list ?? []).filter((f) => f.type.startsWith('image/')));
    if (files.length < SPIN_MIN_FRAMES) {
      setError(`Pick at least ${SPIN_MIN_FRAMES} photos taken all the way around the robot (24 works well).`);
      return;
    }
    const picked = evenPick(files, SPIN_MAX_FRAMES);
    try {
      const frames: string[] = [];
      for (let k = 0; k < picked.length; k++) {
        setBusy(`Shrinking photo ${k + 1} of ${picked.length}…`);
        frames.push(await spinFrame(picked[k]));
      }
      save(frames, 'photos');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fromVideo = async (list: FileList | null) => {
    setError(null);
    const file = list?.[0];
    if (!file) return;
    try {
      setBusy(`Taking ${SPIN_VIDEO_FRAMES} frames from the video…`);
      save(await videoFrames(file, SPIN_VIDEO_FRAMES), 'video');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={'ps-edit' + (compact ? ' ps-edit-compact' : '')}>
      {!spin && !compact && (
        <p className="faint g-small">
          For a real 360 of your robot, walk around it once at the same height and take about
          24 photos (one every 15°), or record a slow 10-second video. Keep the robot in the middle of the frame.
        </p>
      )}
      <div className="ps-actions">
        <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => photos.current?.click()}>
          {spin ? 'Replace with photos' : 'Add photos'}
        </button>
        <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => video.current?.click()}>
          {spin ? 'Replace with a video' : 'Use a video'}
        </button>
        {spin && (confirmRemove ? (
          <span className="g-remove-confirm" role="alert">
            Remove the photo spin? <button type="button" className="btn btn-sm g-remove-yes" onClick={() => { onSave(null); setConfirmRemove(false); }}>Yes, remove</button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(true)}>Remove</button>
        ))}
        <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => { void fromPhotos(e.target.files); e.target.value = ''; }} />
        <input ref={video} type="file" accept="video/*" hidden onChange={(e) => { void fromVideo(e.target.files); e.target.value = ''; }} />
      </div>
      {busy && <p className="faint g-small" role="status">{busy}</p>}
      {error && <p className="g-error" role="alert">{error}</p>}
    </div>
  );
}

/* The Overview's picture: the robot in 3D first — the owner's own 3D
 * scan when there is one, otherwise the 3D model (Omega1's digital
 * twin, or the stage built from the robot's spec) — with the photo
 * views one switch away, and ways to add either. */
export type ReferencePhoto = { url: string; caption: string; source?: string; position?: string };
type View = 'photos' | 'scan' | 'model' | 'reference';
export function OverviewMedia({ robotId, spin, scan, name, model, modelReady = false, modelNote, photo, photoSet, photoAddedAt, referencePhoto, concept = false, onPhotoSave, onPhotosSave, onSave, onScanSave, onApplyScanSize, onRealsenseScan }: {
  robotId: string;
  spin: Spin | undefined;
  scan: ScanMeta | undefined;
  name: string;
  model: ReactNode;
  /* A real 3D model exists to open on (the twin, or a spec with a
   * body). Without one the Overview keeps opening on the photo. */
  modelReady?: boolean;
  /* The honest label over the model view; defaults to the concept
   * wording. Omega1 passes its digital-twin wording. */
  modelNote?: string;
  concept?: boolean;
  photo?: string;
  photoSet?: string[];
  photoAddedAt?: string;
  referencePhoto?: ReferencePhoto;
  onPhotoSave?: (photo: string | null) => string | null;
  /* Replace or clear the owner's uploaded still photos as one set
   * (photo is photoSet[0]; null clears photo, photoSet and
   * photoAddedAt together). Only the owner's own photos get removal
   * controls — a reference photo is not theirs to delete. */
  onPhotosSave?: (next: { photo: string; photoSet: string[]; photoAddedAt: string } | null) => string | null;
  onSave: (next: Spin | null) => string | null;
  onScanSave: (next: ScanMeta | null) => string | null;
  /* Turn the scan's measured size into spec dimensions (Garage saves
   * it as a new version). Optional: without it the scan is view-only. */
  onApplyScanSize?: (dims: ScanDims, scanName: string, unitNote: string) => void;
  /* Opens the RealSense camera window for this robot. */
  onRealsenseScan?: () => void;
}) {
  const [pick, setPick] = useState<View | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState<'one' | 'all' | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [failedPhoto, setFailedPhoto] = useState('');
  const [busyPhoto, setBusyPhoto] = useState(false);
  const image = (photo && (photoSet?.[photoIndex] || photo)) || referencePhoto?.url;
  const view: View = pick === 'model' ? 'model'
    : pick === 'photos' && spin ? 'photos'
    : pick === 'scan' && scan ? 'scan'
    : pick === 'reference' ? 'reference'
    : scan ? 'scan' : modelReady ? 'model'
    : photo && photoAddedAt && photoAddedAt > (spin?.addedAt ?? '') ? 'reference' : spin ? 'photos' : concept && !photo && !referencePhoto ? 'model' : 'reference';
  const ownPhotos: string[] = photoSet && photoSet.length ? photoSet : photo ? [photo] : [];
  const removePhotoAt = (index: number) => {
    if (!onPhotosSave) return;
    const next = removePhotoFromSet(ownPhotos, index);
    setConfirmRemovePhoto(null);
    if (!next) { removeAllPhotos(); return; }
    const failure = onPhotosSave({ photo: next[0], photoSet: next, photoAddedAt: photoAddedAt ?? new Date().toISOString() });
    setPhotoError(failure ?? '');
    if (!failure) setPhotoIndex((i) => Math.max(0, Math.min(i - (index < i ? 1 : 0), next.length - 1)));
  };
  const removeAllPhotos = () => {
    if (!onPhotosSave) return;
    setConfirmRemovePhoto(null);
    const failure = onPhotosSave(null);
    setPhotoError(failure ?? '');
    if (!failure) { setPhotoIndex(0); setPick(null); }
  };
  return (
    <div className="ps-overview">
      <div className="ps-switch" role="group" aria-label="Overview picture">
        <button type="button" className="btn btn-sm" aria-pressed={view === 'reference'} onClick={() => setPick('reference')}>{photo ? 'Your photo' : 'Reference photo'}</button>
        {spin && <button type="button" className="btn btn-sm" aria-pressed={view === 'photos'} onClick={() => setPick('photos')}>Photo 360</button>}
        {scan && <button type="button" className="btn btn-sm" aria-pressed={view === 'scan'} onClick={() => setPick('scan')}>Your 3D scan</button>}
        <button type="button" className="btn btn-sm" aria-pressed={view === 'model'} onClick={() => setPick('model')}>3D model</button>
      </div>
      {view === 'photos' && spin ? (
        <figure className="ps-figure">
          <PhotoSpinViewer key={spin.addedAt} spin={spin} name={name} />
          <figcaption className="faint g-small">
            Your own photos of {name} ({spin.frames.length} {spin.source === 'video' ? 'frames from a video' : 'photos'}).
          </figcaption>
        </figure>
      ) : view === 'scan' && scan ? (
        <ScanView key={scan.addedAt} robotId={robotId} scan={scan} name={name} />
      ) : view === 'model' ? <><p className="faint g-small">{modelNote ?? 'Concept model · approximate geometry, not a measured digital twin.'}</p>{model}</> : (
        image && failedPhoto !== image ? <figure className="ws-real-photo">
          <img src={image} alt={photo ? `Your photo of ${name}` : `Reference image for ${name}`} referrerPolicy="no-referrer" style={{objectPosition: photo ? 'center' : referencePhoto?.position}} onError={() => setFailedPhoto(image)} />
          <figcaption className="faint g-small">{photo ? 'Your uploaded photo.' : referencePhoto?.caption}{!photo && referencePhoto?.source && <> <a href={referencePhoto.source} target="_blank" rel="noreferrer">Source</a></>}</figcaption>
        </figure> : <div className="ws-media-empty"><h3>{image ? 'Photo could not load' : 'No photo of this robot yet'}</h3><p>Add a photo, a photo 360 or a scan of your build. The concept model is available above.</p></div>
      )}
      {view === 'reference' && photoSet && photoSet.length > 1 && <div className="ws-photo-thumbs" role="group" aria-label="Your robot photos">{photoSet.map((src,i) => <button type="button" className="btn btn-sm" aria-pressed={photoIndex===i} key={i} onClick={() => setPhotoIndex(i)}><img src={src} alt={`Photo ${i+1}`} /></button>)}</div>}
      {view === 'reference' && photo && onPhotosSave && (
        <div className="ps-actions">
          {confirmRemovePhoto === 'one' ? (
            <span className="g-remove-confirm" role="alert">
              Remove this photo? <button type="button" className="btn btn-sm g-remove-yes" onClick={() => removePhotoAt(photoIndex)}>Yes, remove</button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmRemovePhoto(null)}>Cancel</button>
            </span>
          ) : confirmRemovePhoto === 'all' ? (
            <span className="g-remove-confirm" role="alert">
              Remove {ownPhotos.length > 1 ? `all ${ownPhotos.length} photos` : 'this photo'}? This can&apos;t be undone. If you saved this robot to your account, press Save afterwards to remove {ownPhotos.length > 1 ? 'them' : 'it'} there too. <button type="button" className="btn btn-sm g-remove-yes" onClick={removeAllPhotos}>Yes, remove</button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmRemovePhoto(null)}>Cancel</button>
            </span>
          ) : (
            <>
              {ownPhotos.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setConfirmRemovePhoto('one')}>Remove this photo</button>}
              <button type="button" className="btn btn-sm" onClick={() => setConfirmRemovePhoto('all')}>{ownPhotos.length > 1 ? 'Remove all photos' : 'Remove photo'}</button>
            </>
          )}
        </div>
      )}
      {photoError && <p className="g-error" role="alert">{photoError}</p>}
      <div className="ps-actions">
        <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Update this robot with these photos.',attach:true})}>Add photos through Wrench</button>
        <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Add this 3D scan to my robot.',attach:true})}>Upload a scan file</button>
        {onRealsenseScan && <button type="button" className="btn btn-sm btn-primary" onClick={onRealsenseScan}>Scan with RealSense camera</button>}
      </div>
    </div>
  );
}
