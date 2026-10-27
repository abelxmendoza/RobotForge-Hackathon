'use client';
/* The take-apart viewer stage inside a Forge thread — the React
 * equivalent of forge.js's viewerStage(): the flat side/top views
 * from the same derivation the robot pages use (.fv markup, explode
 * slider starting at 20 mm), click a part for its detail. The
 * electrical overlay stays off in the thread, exactly as vanilla. */
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { ROOT } from './model';
import type { RobotSpec } from './model';
import {
  TA_DEFAULT_VIEW,
  TA_SPOTS,
  taBuildParts,
  taRenderSide,
  taRenderTop,
} from '../kit/takeapart';
import type { TaPart } from '../kit/takeapart';

export function ForgeViewer({ spec }: { spec: RobotSpec }) {
  const [explode, setExplode] = useState(20);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaPart | null>(null);
  const built = useMemo(() => taBuildParts(spec), [spec]);
  const view = { ...TA_DEFAULT_VIEW, explode, selected: highlight };
  const side = taRenderSide(spec, built.parts, built.pos, view);
  const top = taRenderTop(spec, built.parts, built.pos, view);

  const onViewsClick = (e: MouseEvent) => {
    const el = (e.target as Element).closest?.('.part-shape');
    if (!el) return;
    const p = built.parts.find((x) => x.id === el.getAttribute('data-part'));
    if (p) {
      setDetail(p);
      setHighlight(p.id);
    }
  };

  return (
    <div className="fv">
      <div className="ta-controls">
        <label>Explode</label>
        <input
          type="range"
          className="fv-explode"
          min={0}
          max={60}
          step={1}
          value={explode}
          onChange={(e) => {
            setExplode(Number(e.target.value));
            /* vanilla re-renders with the selection cleared */
            setHighlight(null);
          }}
        />
        <output>{explode} mm</output>
      </div>
      <div onClick={onViewsClick}>
        <div
          className="fv-side"
          dangerouslySetInnerHTML={{ __html: side }}
        />
        <div className="fv-top" dangerouslySetInnerHTML={{ __html: top }} />
      </div>
      <aside className="card fv-detail">
        {detail ? (
          <>
            <span className="qty">
              Qty {detail.qty} · {detail.file ?? ''}
            </span>
            <h3>{detail.name}</h3>
            {TA_SPOTS.includes(detail.id) && (
              <>
                <img
                  className="spot"
                  src={`${ROOT}assets/img/parts/${detail.id}.jpg`}
                  alt={`AI illustration of the ${detail.name}`}
                  loading="lazy"
                />
                <p
                  className="faint"
                  style={{ fontSize: 12, marginTop: 6 }}
                >
                  AI illustration (muse-image-1.0). The printable part itself
                  comes from <code>robotforge cad</code>.
                </p>
              </>
            )}
            <dl>
              <dt>What it is</dt>
              <dd>{detail.does}</dd>
              <dt>Key dimensions</dt>
              <dd className="m">{detail.dims}</dd>
              <dt>Beginner tweak</dt>
              <dd>{detail.tweak}</dd>
              <dt>Print note</dt>
              <dd>{detail.print}</dd>
            </dl>
          </>
        ) : (
          <>
            <h3>Pick a part</h3>
            <p
              className="muted"
              style={{ fontSize: 'var(--fs-sm)', marginTop: 8 }}
            >
              Click any part in either view to see what it is and its key
              dimensions from the spec.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
