'use client';
/* Build tab: Take apart / Assemble — the take-apart skill over the
 * selected robot's own records (lib/takeApart.ts).
 *
 * The diagram is 2D and says so: recorded parts as draggable cards,
 * recorded connections as lines. The record is never edited here —
 * positions are view state, so the app always remembers how the
 * parts connect and Assemble can always put them back. Steps walk
 * the recorded connections (Assemble in order, Take apart in exact
 * reverse). A robot with recorded parts but no recorded connections
 * gets the free canvas only; a robot with neither gets the honest
 * empty state, never an invented build.
 *
 * Above the diagram, a 3D turntable shows a model that EXISTS for
 * this robot — resolved twin → attached scan/model → the site's
 * spec-built stage → none (lib/takeApart resolveModelSource) — by
 * reusing the twin viewer, the scan viewer and the Overview stage.
 * The twin and the scan stay view-only (rotation and orbit); the
 * spec-built stage is the Overview stage itself, where parts can be
 * clicked for their card and dragged off by hand, and put back with
 * its Reassemble button or by asking Wrench. Every reused viewer
 * already honours prefers-reduced-motion (it starts paused) and
 * pauses its spin behind its own control while the user orbits. */
import { useMemo, useRef, useState } from 'react';
import TwinView from './TwinView';
import ScanView from './ScanView';
import OverviewTurntable, { hasBody } from './OverviewTurntable';
import { omega1Rover } from '@/lib/omega1Twin';
import { OMEGA1_ROBOT_ID } from '@/lib/omega1Garage';
import type { GarageRobot, Spec } from '@/lib/garage';
import type { RobotSpec } from '@/components/forge/model';
import {
  assembleSteps, deriveTakeApart, disassembleSteps, explodedPos, isHomeAt,
  resolveModelSource, restoredCount, TA_H, TA_SNAP,
  type TakeModel,
} from '@/lib/takeApart';

type Pos = { x: number; y: number };
type Mode = 'free' | 'assemble' | 'disassemble';

const explodedAll = (model: TakeModel): Record<string, Pos> =>
  Object.fromEntries(model.parts.map((p) => [p.id, explodedPos(model, p.id)]));

export function BuildTurntable({ robot, spec, onNeedSpecs }: {
  robot: GarageRobot; spec: Spec; onNeedSpecs?: () => void;
}) {
  const kind = resolveModelSource({
    isOmega1: robot.id === OMEGA1_ROBOT_ID,
    scanFormat: robot.scan?.format ?? null,
    hasDims: hasBody(spec),
  });
  if (kind === 'none') {
    return <p className="faint g-small ta-nomodel">No 3D model for this robot yet — the parts diagram below is the build view. Nothing here generates or fakes one.</p>;
  }
  return (
    <div className="ta-turntable">
      {kind === 'twin' && <TwinView subject={omega1Rover} />}
      {kind === 'scan' && robot.scan && (
        <>
          <ScanView robotId={robot.id} scan={robot.scan} name={spec?.name || robot.name} />
          <p className="faint g-small">
            {robot.scan.format === 'ply'
              ? 'Your own scan, shown as a point preview — the shape your scanner captured, not a photoreal model.'
              : 'Your own attached model file, shown as uploaded.'}
          </p>
        </>
      )}
      {kind === 'stage' && (
        <OverviewTurntable
          spec={spec as unknown as RobotSpec}
          name={spec?.name || robot.name}
          fallback={<p className="faint g-small ta-nomodel">No 3D model for this robot yet — the parts diagram below is the build view.</p>}
          onNeedSpecs={onNeedSpecs ?? (() => undefined)}
        />
      )}
      <p className="faint g-small">360° turntable — drag to orbit, scroll or pinch to zoom. Viewing only: taking apart happens on the diagram below.</p>
    </div>
  );
}

export default function TakeApartPanel({ robot, spec, onNeedSpecs }: {
  robot: GarageRobot; spec: Spec; onNeedSpecs?: () => void;
}) {
  const model = useMemo(() => deriveTakeApart(spec), [spec]);
  const [positions, setPositions] = useState<Record<string, Pos>>(() => ({ ...model.home }));
  const [mode, setMode] = useState<Mode>('free');
  const [stepIdx, setStepIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [show3d, setShow3d] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const steps = mode === 'assemble' ? assembleSteps(model) : mode === 'disassemble' ? disassembleSteps(model) : [];
  const restored = restoredCount(model, positions);
  const total = model.connections.length;

  const enterMode = (m: Mode) => {
    setMode(m);
    setStepIdx(0);
    if (m === 'assemble') setPositions(explodedAll(model));
    if (m === 'disassemble') setPositions({ ...model.home });
  };

  const stepNext = () => {
    const step = steps[stepIdx];
    if (!step) return;
    setPositions((prev) => {
      const next = { ...prev };
      if (step.verb === 'connect') {
        next[step.fromId] = model.home[step.fromId];
        next[step.toId] = model.home[step.toId];
      } else {
        next[step.toId] = explodedPos(model, step.toId);
      }
      return next;
    });
    setStepIdx((i) => Math.min(i + 1, steps.length));
  };

  const stepBack = () => {
    const step = steps[stepIdx - 1];
    if (!step) return;
    setPositions((prev) => {
      const next = { ...prev };
      if (step.verb === 'connect') next[step.toId] = explodedPos(model, step.toId);
      else next[step.toId] = model.home[step.toId];
      return next;
    });
    setStepIdx((i) => Math.max(i - 1, 0));
  };

  const toPct = (e: React.PointerEvent): Pos => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: TA_H / 2 };
    return {
      x: Math.min(94, Math.max(6, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(TA_H - 6, Math.max(6, ((e.clientY - rect.top) / rect.height) * TA_H)),
    };
  };

  const onDown = (e: React.PointerEvent, id: string) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPct(e);
    const cur = positions[id] ?? model.home[id];
    dragRef.current = { id, dx: cur.x - p.x, dy: cur.y - p.y };
    setSelected(id);
  };

  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toPct(e);
    setPositions((prev) => ({ ...prev, [drag.id]: { x: p.x + drag.dx, y: p.y + drag.dy } }));
  };

  const onUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setPositions((prev) => {
      const pos = prev[drag.id];
      if (!pos) return prev;
      /* Snap home from near home — and from next to a recorded mate:
       * the connection is made at home, so snapping into it is
       * snapping home. Either way the record decides the place. */
      if (isHomeAt(pos, model.home[drag.id])) return { ...prev, [drag.id]: model.home[drag.id] };
      const nearMate = model.connections.some((c) => {
        const mateId = c.fromId === drag.id ? c.toId : c.toId === drag.id ? c.fromId : null;
        if (!mateId) return false;
        const mate = prev[mateId];
        return !!mate && Math.hypot(pos.x - mate.x, pos.y - mate.y) <= TA_SNAP * 1.8;
      });
      return nearMate ? { ...prev, [drag.id]: model.home[drag.id] } : prev;
    });
  };

  const current = steps[stepIdx] ?? null;

  return (
    <section className="forge-block ta-panel" aria-label="Take apart and assemble">
      <h3>Take apart / Assemble <span className="fbadge local">PARTS DIAGRAM</span></h3>
      <p className="faint g-small">
        A 2D parts diagram of this robot&rsquo;s recorded build — not a 3D physics scene. Drag parts
        around freely; the app remembers how they connect, so they can always auto-connect back.
      </p>

      <div className="ta-3dbar">
        <button type="button" className="btn btn-sm" aria-expanded={show3d} onClick={() => setShow3d((v) => !v)}>
          {show3d ? 'Hide the 3D turntable' : 'Show the 3D turntable'}
        </button>
      </div>
      {show3d && <BuildTurntable robot={robot} spec={spec} onNeedSpecs={onNeedSpecs} />}

      {model.source === 'none' ? (
        <div className="ws-empty ta-empty">
          <p>
            <strong>No recorded build to take apart yet.</strong> This robot&rsquo;s record names no
            parts and no connections, so there is nothing honest to draw — RobotForge does not invent
            a build for it. Add parts or connections to the record (Specs, or the Wiring tab&rsquo;s
            connection map) and the diagram appears here.
          </p>
        </div>
      ) : (
        <>
          {total > 0 ? (
            <div className="ta-controls" role="group" aria-label="Take-apart mode">
              <button type="button" className={`btn btn-sm${mode === 'free' ? ' btn-primary' : ''}`} aria-pressed={mode === 'free'} onClick={() => enterMode('free')}>Free play</button>
              <button type="button" className={`btn btn-sm${mode === 'assemble' ? ' btn-primary' : ''}`} aria-pressed={mode === 'assemble'} onClick={() => enterMode('assemble')}>Assemble</button>
              <button type="button" className={`btn btn-sm${mode === 'disassemble' ? ' btn-primary' : ''}`} aria-pressed={mode === 'disassemble'} onClick={() => enterMode('disassemble')}>Take apart</button>
              <button type="button" className="btn btn-sm" onClick={() => { setPositions({ ...model.home }); setStepIdx(mode === 'assemble' ? steps.length : 0); }}>Assemble all</button>
              <button type="button" className="btn btn-sm" onClick={() => { setPositions(explodedAll(model)); setStepIdx(mode === 'disassemble' ? steps.length : 0); }}>Take all apart</button>
              {selected && (
                <button type="button" className="btn btn-sm" onClick={() => setPositions((prev) => ({ ...prev, [selected]: model.home[selected] }))}>
                  Snap back: {model.parts.find((p) => p.id === selected)?.label ?? selected}
                </button>
              )}
            </div>
          ) : (
            <div className="ta-controls" role="group" aria-label="Take-apart controls">
              <button type="button" className="btn btn-sm" onClick={() => setPositions(explodedAll(model))}>Take all apart</button>
              <button type="button" className="btn btn-sm" onClick={() => setPositions({ ...model.home })}>Put all back</button>
              {selected && (
                <button type="button" className="btn btn-sm" onClick={() => setPositions((prev) => ({ ...prev, [selected]: model.home[selected] }))}>
                  Snap back: {model.parts.find((p) => p.id === selected)?.label ?? selected}
                </button>
              )}
            </div>
          )}

          {total > 0 && mode !== 'free' && (
            <div className="ta-step" aria-live="polite">
              {current ? (
                <p><strong>Step {current.n} of {current.total}:</strong> {current.text}</p>
              ) : (
                <p><strong>Done.</strong> {mode === 'assemble' ? 'Every recorded connection is made.' : 'Every recorded connection is undone.'}</p>
              )}
              <div className="ta-step-btns">
                <button type="button" className="btn btn-sm" onClick={stepBack} disabled={stepIdx === 0}>Back</button>
                <button type="button" className="btn btn-sm btn-primary" onClick={stepNext} disabled={!current}>Next</button>
                <span className="faint g-small">{restored} of {total} connections made</span>
              </div>
            </div>
          )}
          {total > 0 && mode === 'free' && (
            <p className="faint g-small ta-progress">{restored} of {total} connections made — drag a part home, or next to the part it connects to, and it snaps in.</p>
          )}
          {total === 0 && (
            <p className="faint g-small ta-progress">
              This record names parts but no connections between them, so there are no steps to walk —
              take it apart freely; every part still knows its place and snaps back.
            </p>
          )}

          <div
            className="ta-canvas"
            ref={canvasRef}
            role="application"
            aria-label="Parts diagram. Drag a part to move it; double-tap a part to snap it back to its place."
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <svg className="ta-lines" viewBox={`0 0 100 ${TA_H}`} preserveAspectRatio="none" aria-hidden="true">
              {model.connections.map((c, i) => {
                const a = positions[c.fromId] ?? model.home[c.fromId];
                const b = positions[c.toId] ?? model.home[c.toId];
                if (!a || !b) return null;
                const on = isHomeAt(a, model.home[c.fromId]) && isHomeAt(b, model.home[c.toId]);
                const hot = !!current && current.conn === i;
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={`ta-line${on ? ' on' : ''}${hot ? ' hot' : ''}`}
                    vectorEffect="non-scaling-stroke" />
                );
              })}
            </svg>
            {model.parts.map((p) => {
              const pos = positions[p.id] ?? model.home[p.id];
              const home = isHomeAt(pos, model.home[p.id]);
              const hot = !!current && (current.fromId === p.id || current.toId === p.id);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.label}${p.detail ? ` — ${p.detail}` : ''}. ${home ? 'In place.' : 'Moved out.'} Press Enter to snap back.`}
                  className={`ta-part${selected === p.id ? ' sel' : ''}${home ? ' home' : ''}${hot ? ' hot' : ''}`}
                  style={{ left: `${pos.x}%`, top: `${(pos.y / TA_H) * 100}%` }}
                  onPointerDown={(e) => onDown(e, p.id)}
                  onDoubleClick={() => setPositions((prev) => ({ ...prev, [p.id]: model.home[p.id] }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPositions((prev) => ({ ...prev, [p.id]: model.home[p.id] }));
                    }
                  }}
                >
                  <strong>{p.label}</strong>
                  {p.detail && <span className="faint g-small">{p.detail}</span>}
                  <span className="ta-part-state">{home ? 'in place' : 'out'}</span>
                </div>
              );
            })}
          </div>

          <p className="faint g-small ta-smallprint">
            {model.homeSource === 'placement'
              ? 'Part positions: the Forge Engine’s recorded placement for this robot. '
              : 'Part positions: a tidy layout computed for this diagram — the record carries no positions, so “home” is where the diagram places each part. '}
            Positions and steps on this diagram are view-only: dragging a part never changes the
            robot&rsquo;s saved record. The parts and connections themselves come from the record —
            that record is what persists, and it is why Assemble can always put everything back.
          </p>
        </>
      )}
    </section>
  );
}
