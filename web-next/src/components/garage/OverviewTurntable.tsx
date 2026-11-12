'use client';
/* Workshop Overview: the robot on a slowly turning 3D stage.
 *
 * It is built from this robot's own spec (the same geometry as the
 * Build bench and the robot pages' take-apart), rendered with studio
 * lighting, soft shadows and an environment map. It is a model, not a
 * photo, and the caption says so. Parts only move when recorded data
 * licenses it (lib/stageAnimation via the Robodex stage record): for a
 * robot with no stage record the stage turns but nothing on it moves.
 * Without dimensions, or without WebGL, it falls back to the drawing.
 *
 * Take-apart by hand: click a part and its card opens beside the
 * stage (the kit record for that part); drag a part with the pointer
 * and it comes off and stays where it is dropped. None of it edits
 * the robot's record — positions are view state, so Reassemble (the
 * button below the stage, or asking Wrench in the chat) always puts
 * every part back. */
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RobotLife } from '@/components/kit/Robot3D';
import type { RobotSpec } from '@/components/forge/model';
import { taBuildParts } from '@/components/kit/takeapart';
import { stageRecordOf } from '@/lib/data';
import { robotCapability } from '@/lib/stageAnimation';
import { useStageAnimation } from '@/lib/useStageAnimation';
import { WORKSHOP_REASSEMBLE_EVENT, type ReassembleResult } from '@/lib/workshopContext';
import { LOOK_CAPTION, readLookFiles, type PartLook } from '@/lib/partMesh';

const Robot3D = dynamic(() => import('@/components/kit/Robot3D'), {
  ssr: false,
  loading: () => <p className="faint ws-turntable-wait">Loading the 3D view…</p>,
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function hasBody(spec: unknown): boolean {
  const s = (spec ?? {}) as Record<string, unknown>;
  return num(s.length_m) > 0 && num(s.width_m) > 0;
}

export default function OverviewTurntable({ spec, name, fallback, onNeedSpecs, robotId, looks }: {
  spec: RobotSpec;
  name: string;
  fallback: React.ReactNode;
  onNeedSpecs: () => void;
  /* Parts regenerated with Wrench (lib/partMesh.ts): their GLBs are
   * read from this browser and fitted into the model. */
  robotId?: string;
  looks?: PartLook[];
}) {
  const [lookFiles, setLookFiles] = useState<Record<string, ArrayBuffer> | undefined>(undefined);
  const lookSig = (looks ?? []).map((l) => l.viewId + l.createdAt).join('|');
  useEffect(() => {
    let live = true;
    if (!robotId || !looks?.length) { setLookFiles(undefined); return; }
    void readLookFiles(robotId, looks).then((files) => { if (live) setLookFiles(Object.keys(files).length ? files : undefined); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotId, lookSig]);
  const shownLooks = (looks ?? []).filter((l) => lookFiles && lookFiles[l.viewId]);
  const [failed, setFailed] = useState(false);
  const [spin, setSpin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detachedIds, setDetachedIds] = useState<string[]>([]);
  const [resetNonce, setResetNonce] = useState(0);
  const [restoreRequest, setRestoreRequest] = useState<{ id: string; nonce: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useStageAnimation(stageRef);
  const body = hasBody(spec);
  const shown: RobotSpec = useMemo(() => ({
    ...spec,
    height_m: num(spec.height_m) || Math.max(num(spec.length_m), num(spec.width_m)) * 0.6,
  }), [spec]);
  const capability = useMemo(() => {
    const rec = stageRecordOf(String(spec?.name ?? '')) ?? stageRecordOf(name);
    return rec ? robotCapability(rec) : null;
  }, [spec, name]);
  const life: RobotLife | undefined = useMemo(() => {
    if (!capability) return undefined;
    const travel = capability.tracks.find((t) => t.kind === 'travel');
    return {
      playing: spin && stage.playingNow(false),
      speed: stage.controls.speed,
      // The sensor overlay (lidar range disc) hides the robot at this size.
      sensors: false,
      hover: capability.tracks.some((t) => t.kind === 'hover'),
      lidarSweep: false,
      gripperTravelM: travel?.joints?.[0]?.amplitude ?? null,
    };
  }, [capability, stage, spin]);

  const kitParts = useMemo(() => (body ? taBuildParts(shown).parts : []), [body, shown]);
  const selectedPart = selectedId ? kitParts.find((p) => p.id === selectedId) ?? null : null;
  const selectedOff = selectedId ? detachedIds.includes(selectedId) : false;

  /* Wrench bridge: "reassemble" / "put it back together" in the chat
   * lands here while this stage is on screen and answers with what
   * actually happened, so the chat never claims work it didn't do. */
  useEffect(() => {
    if (!body || failed) return;
    const onReassemble = (e: Event) => {
      const detail = (e as CustomEvent<ReassembleResult>).detail;
      detail.handled = true;
      if (detachedIds.length > 0) {
        const n = detachedIds.length;
        setResetNonce((x) => x + 1);
        detail.message = `Putting ${n === 1 ? 'the part' : `all ${n} parts`} back on ${name} — watch the 3D model come back together.`;
      } else {
        detail.message = `${name} is already fully assembled — no parts are off it.`;
      }
    };
    window.addEventListener(WORKSHOP_REASSEMBLE_EVENT, onReassemble);
    return () => window.removeEventListener(WORKSHOP_REASSEMBLE_EVENT, onReassemble);
  }, [body, failed, detachedIds, name]);

  if (!body || failed) {
    return (
      <>
        {fallback}
        {!body && (
          <button type="button" className="ws-estnote" onClick={onNeedSpecs}>
            Add the robot&apos;s length and width to preview a concept in 3D. <span>Open Specs →</span>
          </button>
        )}
      </>
    );
  }

  return (
    <figure className="ws-turntable" ref={stageRef}>
      <div className="ws-turntable-flex">
        <div className="ws-turntable-stage">
          <Robot3D
            spec={shown}
            life={life}
            explode={0}
            selected={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onFail={() => setFailed(true)}
            quality="high"
            autoRotate={spin}
            showComMarker={false}
            partDrag
            resetNonce={resetNonce}
            restoreRequest={restoreRequest}
            onDetachedChange={setDetachedIds}
            partLooks={lookFiles}
          />
          <button type="button" className="btn btn-sm ws-turntable-toggle" aria-pressed={!spin} onClick={() => setSpin((s) => !s)}>
            {spin ? 'Pause' : 'Spin'}
          </button>
        </div>
        {selectedPart && (
          <aside className="ws-partbar" aria-label={`About the ${selectedPart.name}`}>
            <div className="ws-partbar-head">
              <h3>{selectedPart.name}</h3>
              <button type="button" className="btn btn-sm" aria-label="Close the part card" onClick={() => setSelectedId(null)}>✕</button>
            </div>
            <p className={'ws-partbar-state' + (selectedOff ? ' is-off' : '')}>
              {selectedOff ? 'Taken off the robot' : 'On the robot'}
            </p>
            {selectedPart.does && <p>{selectedPart.does}</p>}
            <dl className="ws-partbar-facts">
              {selectedPart.dims && (<><dt>Size</dt><dd>{selectedPart.dims}</dd></>)}
              {selectedPart.qty > 1 && (<><dt>On this robot</dt><dd>× {selectedPart.qty}</dd></>)}
              {selectedPart.print && (<><dt>Making it</dt><dd>{selectedPart.print}</dd></>)}
              {selectedPart.tweak && (<><dt>Worth tweaking</dt><dd>{selectedPart.tweak}</dd></>)}
              {selectedPart.file && (<><dt>Part file</dt><dd>{selectedPart.file}</dd></>)}
            </dl>
            {selectedOff ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setRestoreRequest({ id: selectedPart.id, nonce: Date.now() })}>
                Put this part back
              </button>
            ) : (
              <p className="faint g-small">Drag it in the model to take it off, or drag empty space to turn the robot.</p>
            )}
          </aside>
        )}
      </div>
      <div className="ws-turntable-bar">
        {detachedIds.length > 0 ? (
          <>
            <span role="status">{detachedIds.length} {detachedIds.length === 1 ? 'part' : 'parts'} off the robot</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setResetNonce((x) => x + 1)}>
              Reassemble
            </button>
            <span className="faint g-small">or ask Wrench to put it back together</span>
          </>
        ) : (
          <span className="faint g-small">Click a part for its card. Drag a part to take it off — piece by piece, as far as you like.</span>
        )}
      </div>
      <figcaption className="faint g-small">
        Concept model built from {name}&apos;s spec, not a photo or a measured twin. Drag empty space to turn it, pinch or scroll to zoom.
        {capability ? ' Moving parts follow the recorded robot data.' : ' Nothing on it moves until recorded data says it can.'}
        {shownLooks.length > 0 && (
          <span className="ws-looks">
            {shownLooks.map((l) => <span key={l.viewId} className="fbadge planned" title={`“${l.description}”`}>New look: {l.partLabel.replace(/^the /, '')}</span>)}
            <span>{LOOK_CAPTION}</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
