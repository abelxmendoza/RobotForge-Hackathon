'use client';
/* Workshop Overview: the robot on a slowly turning 3D stage.
 *
 * It is built from this robot's own spec (the same geometry as the
 * Build bench and the robot pages' take-apart), rendered with studio
 * lighting, soft shadows and an environment map. It is a model, not a
 * photo, and the caption says so. Parts only move when recorded data
 * licenses it (lib/stageAnimation via the Robodex stage record): for a
 * robot with no stage record the stage turns but nothing on it moves.
 * Without dimensions, or without WebGL, it falls back to the drawing. */
import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import type { RobotLife } from '@/components/kit/Robot3D';
import type { RobotSpec } from '@/components/forge/model';
import { stageRecordOf } from '@/lib/data';
import { robotCapability } from '@/lib/stageAnimation';
import { useStageAnimation } from '@/lib/useStageAnimation';

const Robot3D = dynamic(() => import('@/components/kit/Robot3D'), {
  ssr: false,
  loading: () => <p className="faint ws-turntable-wait">Loading the 3D view…</p>,
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function hasBody(spec: unknown): boolean {
  const s = (spec ?? {}) as Record<string, unknown>;
  return num(s.length_m) > 0 && num(s.width_m) > 0;
}

export default function OverviewTurntable({ spec, name, fallback, onNeedSpecs }: {
  spec: RobotSpec;
  name: string;
  fallback: React.ReactNode;
  onNeedSpecs: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [spin, setSpin] = useState(true);
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

  if (!body || failed) {
    return (
      <>
        {fallback}
        {!body && (
          <button type="button" className="ws-estnote" onClick={onNeedSpecs}>
            Add the robot&apos;s length and width to see it turning in 3D. <span>Open Specs →</span>
          </button>
        )}
      </>
    );
  }

  return (
    <figure className="ws-turntable" ref={stageRef}>
      <div className="ws-turntable-stage">
        <Robot3D
          spec={shown}
          life={life}
          explode={0}
          selected={null}
          onSelect={() => {}}
          onFail={() => setFailed(true)}
          quality="high"
          autoRotate={spin}
          showComMarker={false}
        />
        <button type="button" className="btn btn-sm ws-turntable-toggle" aria-pressed={!spin} onClick={() => setSpin((s) => !s)}>
          {spin ? 'Pause' : 'Spin'}
        </button>
      </div>
      <figcaption className="faint g-small">
        3D model built from {name}&apos;s spec, not a photo. Drag to turn it, pinch or scroll to zoom.
        {capability ? ' Moving parts follow the recorded robot data.' : ' Nothing on it moves until recorded data says it can.'}
      </figcaption>
    </figure>
  );
}
