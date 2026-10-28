'use client';
/* The spec-driven take-apart panel — the React equivalent of
 * robot.js's TA_PANEL + initTakeApart wiring: explode slider,
 * electrical overlay with power sequencing, 2D/3D tabs over the
 * same kit, and the click-a-part detail panel. Used on the kit
 * page; the robot pages' own port uses the same component.
 * Everything drawn derives from the spec's numbers — no verdicts,
 * no invented data. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { RobotSpec } from '../forge/model';
import {
  TA_DEFAULT_VIEW,
  elecDepths,
  elecStage,
  taBuildParts,
  taClass,
  taIsEstimated,
  taRenderViews,
} from './takeapart';
import { TaNodeDetail, TaPartDetail, WIRE_INFO_DEFAULT, wireInfoText } from './detail';

const Robot3D = dynamic(() => import('./Robot3D'), { ssr: false });

export default function TakeApartViewer({ spec }: { spec: RobotSpec }) {
  const [explode, setExplode] = useState(0);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [elec, setElec] = useState(false);
  const [power, setPower] = useState(false);
  const [elecStageN, setElecStageN] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selWire, setSelWire] = useState<number | null>(null);
  const [wireInfo, setWireInfo] = useState<ReactNode>(WIRE_INFO_DEFAULT);
  const [threeFailed, setThreeFailed] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const built = useMemo(() => taBuildParts(spec), [spec]);
  const cls = taClass(spec);
  const view = {
    ...TA_DEFAULT_VIEW,
    explode,
    selected,
    elec,
    power,
    elecStage: elecStageN,
    selNode,
    selWire,
  };
  const views = taRenderViews(spec, built.parts, built.pos, view);
  const selPart = built.parts.find((p) => p.id === selected) || null;
  const wiring = spec.wiring;

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };
  useEffect(() => clearTimers, []);

  const setPowerSeq = (on: boolean) => {
    clearTimers();
    setPower(on);
    if (!on || !wiring) {
      setElecStageN(0);
      return;
    }
    /* light the wiring in supply order: battery first, then
       whatever it feeds, then whatever that feeds */
    const depth = elecDepths(wiring);
    const stages = Array.from(
      new Set(
        wiring.connections
          .map((c, i) => elecStage(wiring, depth, i))
          .filter((s) => Number.isFinite(s)),
      ),
    ).sort((a, b) => a - b);
    setElecStageN(0);
    stages.forEach((s, k) => {
      timersRef.current.push(
        setTimeout(() => setElecStageN(s), 80 + k * 190),
      );
    });
  };

  const toggleElec = () => {
    const next = !elec;
    setElec(next);
    if (next) {
      setWireInfo(WIRE_INFO_DEFAULT);
    } else {
      setPowerSeq(false);
      setSelWire(null);
    }
  };

  const selectPart = (id: string) => {
    setSelected(id);
    setSelNode(null);
    setSelWire(null);
  };
  const selectNode = (id: string) => {
    setSelNode(id);
    setSelWire(null);
    setSelected(null);
  };
  const selectWire = (i: number) => {
    setSelWire(i);
    setSelNode(null);
    setWireInfo(wireInfoText(spec, i));
  };

  const onViewsClick = (e: MouseEvent) => {
    const t = e.target as Element;
    const wg = t.closest?.('.wire-g');
    if (wg) {
      selectWire(Number(wg.getAttribute('data-conn')));
      return;
    }
    const nc = t.closest?.('.node-chip');
    if (nc) {
      selectNode(nc.getAttribute('data-node') as string);
      return;
    }
    const ps = t.closest?.('.part-shape');
    if (ps) selectPart(ps.getAttribute('data-part') as string);
  };
  const onViewsKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as Element;
    if (
      t.closest?.('.wire-g') ||
      t.closest?.('.node-chip') ||
      t.closest?.('.part-shape')
    ) {
      e.preventDefault();
      onViewsClick(e as unknown as MouseEvent);
    }
  };
  const hoverWireRef = useRef<number | null>(null);
  const onViewsHover = (e: MouseEvent) => {
    const wg = (e.target as Element).closest?.('.wire-g');
    const i = wg ? Number(wg.getAttribute('data-conn')) : null;
    if (i !== hoverWireRef.current) {
      hoverWireRef.current = i;
      if (i !== null) setWireInfo(wireInfoText(spec, i));
    }
  };

  const ground = cls === 'ground';

  return (
    <div id="ta">
      <div>
        {taIsEstimated(spec) ? (
          <span className="est">
            Estimated — drafted from a photo, not measured
          </span>
        ) : null}
      </div>
      <div className="ta-controls">
        <label htmlFor="ta-explode">Explode</label>
        <input
          type="range"
          id="ta-explode"
          min={0}
          max={60}
          step={1}
          value={explode}
          onChange={(e) => setExplode(Number(e.target.value))}
        />
        <output htmlFor="ta-explode">{explode} mm</output>
      </div>
      {wiring ? (
        <div className="ta-controls" id="ta-elec-controls">
          <button
            className="btn btn-sm ta-toggle"
            id="ta-elec"
            type="button"
            aria-pressed={elec ? 'true' : 'false'}
            onClick={toggleElec}
          >
            Electrical
          </button>
          <button
            className="btn btn-sm ta-toggle"
            id="ta-power"
            type="button"
            aria-pressed={power ? 'true' : 'false'}
            disabled={!elec}
            onClick={() => setPowerSeq(!power)}
          >
            {power ? 'Power off' : 'Power on'}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            Amber is power, blue is data, grey is unpowered — red is a recorded
            over-voltage. Power lights the wiring in supply order, battery
            first.
          </span>
        </div>
      ) : null}
      {elec ? (
        <p id="ta-wire-info" className="ta-wire-info">
          {wireInfo}
        </p>
      ) : null}
      {elec && wiring ? (
        <p
          id="ta-elec-note"
          className="faint"
          style={{ fontSize: 'var(--fs-xs)', marginTop: 8 }}
        >
          {wiring.note}
        </p>
      ) : null}
      <div className="ta-controls" id="ta-view-controls">
        <div className="tabs" role="tablist" aria-label="Take-apart view">
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={mode === '2d' ? 'true' : 'false'}
            onClick={() => setMode('2d')}
          >
            2D views
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={mode === '3d' ? 'true' : 'false'}
            onClick={() => setMode('3d')}
          >
            3D
          </button>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>
          Same kit, same explode slider, same click-a-part panel.
        </span>
      </div>
      {mode === '3d' ? (
        <p className="callout" style={{ marginBottom: 12 }}>
          <span>
            The 3D view is a schematic of the same kit. The electrical overlay
            and the dimension lines are <strong>2D-only</strong> for now —
            switch back to 2D views for those.
          </span>
        </p>
      ) : null}
      <div className="ta-stage">
        <div>
          {mode === '2d' ? (
            <div
              id="ta-2d"
              onClick={onViewsClick}
              onKeyDown={onViewsKey}
              onMouseOver={onViewsHover}
            >
              <div className="ta-view">
                <div dangerouslySetInnerHTML={{ __html: views.side }} />
                <p className="cap">
                  {ground
                    ? 'Side view. Rear is left, front is right; ground is z = 0 and axles sit at wheel-radius height.'
                    : 'Side view. Front is to the right; z = 0 is the ground (the table, for a fixed arm).'}
                </p>
              </div>
              <div className="ta-view">
                <div dangerouslySetInnerHTML={{ __html: views.top }} />
                <p className="cap">
                  {ground ? (
                    <>
                      Top view. Explode moves the wheels outward, like the
                      kit's <code>explode_mm</code>.
                    </>
                  ) : (
                    'Top view. The explode slider separates the same parts, the same way, as the 3D view.'
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="ta-view" id="ta-3dwrap">
              <div id="ta-3d">
                <Robot3D
                  spec={spec}
                  explode={explode}
                  selected={selected}
                  onSelect={selectPart}
                  onFail={() => setThreeFailed(true)}
                />
              </div>
              <p className="cap">
                3D take-apart. Drag to orbit, pinch or scroll to zoom, tap a part —
                the panel beside it is the same one the flat views use.
              </p>
              {threeFailed ? (
                <p className="state-box" id="ta-3d-fallback">
                  3D unavailable here — the 2D take-apart still works.
                </p>
              ) : null}
            </div>
          )}
        </div>
        <aside className="card ta-detail" id="ta-detail" aria-live="polite">
          {selNode && wiring ? (
            <TaNodeDetail spec={spec} nodeId={selNode} />
          ) : selPart ? (
            <TaPartDetail spec={spec} part={selPart} />
          ) : (
            <>
              <h3>Pick a part</h3>
              <p
                className="muted"
                style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}
              >
                {ground
                  ? 'Click any part in either view to see what it is, its key dimensions from the spec, one beginner tweak, and a print suggestion.'
                  : 'Click any part in either view to see what it is and its key dimensions from the spec.'}
              </p>
            </>
          )}
        </aside>
      </div>
      <p
        className="faint"
        id="ta-foot"
        style={{ fontSize: 'var(--fs-xs)', marginTop: 12 }}
      >
        {ground ? (
          <>
            A layout viewer built from the spec's numbers, not a CAD render.{' '}
            <code>robotforge cad</code> writes the printable files, one
            OpenSCAD file per part.
          </>
        ) : (
          'A schematic layout viewer built from the spec’s numbers, not a CAD render. Printable kits (robotforge cad) cover ground robots today; this class is drawn from its published spec instead.'
        )}
      </p>
    </div>
  );
}
