'use client';
/* Wiring tab: three views over the SAME records the Connections
 * list above edits — these views only ever READ spec.connections;
 * the list/editor stays the source of truth.
 *
 *  - Full robot: the Build tab's turntable, reused as-is (a model
 *    that exists for this robot, or the honest no-model line).
 *  - Connections: the recorded connection map drawn as a diagram —
 *    lines between the parts, grouped and filterable by a kind
 *    derived from each connection's own detail text
 *    (lib/connectionKind.ts). Tapping a line, a part or a row shows
 *    the recorded detail. The lines are LOGICAL: the record carries
 *    endpoints and detail text, not cable routes or 3D positions,
 *    so no line is drawn on the 3D model — the small print says so.
 *  - Photos: a board of images that already exist in the app — the
 *    owner's own photos, Robodex photos with their credits, and
 *    (Omega1) the twin subjects' preview renders, each labelled as
 *    what it is. Nothing is generated for this view. Under the
 *    board, the recorded connections as callouts, evidence badges
 *    included where the record carries them. */
import { useMemo, useState } from 'react';
import { BuildTurntable } from './TakeApartPanel';
import { deriveTakeApart, TA_H } from '@/lib/takeApart';
import { connectionKind, CONNECTION_KINDS, type ConnectionKind } from '@/lib/connectionKind';
import { OMEGA1_ROBOT_ID } from '@/lib/omega1Garage';
import { twinSubjects } from '@/lib/omega1Twin';
import { assetPath } from '@/components/home/asset';
import { robots as dexRobots } from '@/lib/data';
import type { GarageRobot, Spec } from '@/lib/garage';

type WvMode = 'robot' | 'connections' | 'photos';
type KindFilter = 'All' | ConnectionKind;

interface BoardPhoto { src: string; title: string; credit: string }

const KIND_CLASS: Record<ConnectionKind, string> = {
  Power: 'k-power', 'I2C / comms': 'k-comms', GPIO: 'k-gpio', CSI: 'k-csi', Other: 'k-other',
};

export default function WiringViews({ robot, spec, onNeedSpecs }: {
  robot: GarageRobot; spec: Spec; onNeedSpecs?: () => void;
}) {
  const [mode, setMode] = useState<WvMode>('robot');
  const [kind, setKind] = useState<KindFilter>('All');
  const [selected, setSelected] = useState<number | null>(null);
  const model = useMemo(() => deriveTakeApart(spec), [spec]);

  /* Evidence lives on the raw connection rows; the derived model
   * keeps only endpoints + detail, so look badges up by name pair. */
  const rawConns: { from: string; to: string; evidence?: string; verifiedAt?: string }[] =
    Array.isArray(spec?.connections) ? spec.connections : [];
  const evidenceOf = (fromId: string, toId: string) =>
    rawConns.find((c) => c.from === fromId && c.to === toId);

  const kinds = useMemo(() => model.connections.map((c) => connectionKind(c.detail)), [model]);
  const shown = model.connections
    .map((c, i) => ({ c, i, k: kinds[i] }))
    .filter(({ k }) => kind === 'All' || k === kind);
  const sel = selected !== null ? model.connections[selected] : null;

  const photos = useMemo<BoardPhoto[]>(() => {
    const out: BoardPhoto[] = [];
    (robot.spin?.frames ?? []).slice(0, 6).forEach((src, i) => out.push({
      src, title: `Your photo ${i + 1} of ${robot.name}`,
      credit: 'A real photo of this robot, from its photo spin in this app.',
    }));
    if (robot.id === OMEGA1_ROBOT_ID) {
      twinSubjects.forEach((s) => out.push({
        src: assetPath(s.preview), title: s.name,
        credit: 'Generator preview render of the estimated twin subject — not a photo of the real robot.',
      }));
    } else {
      const dex = dexRobots.find((x) => x.name === (spec?.name || robot.name)) as
        unknown as { image_url?: string; image_credit?: string } | undefined;
      if (dex?.image_url) out.push({
        src: dex.image_url.startsWith('assets/') ? assetPath(dex.image_url) : dex.image_url,
        title: spec?.name || robot.name,
        credit: dex.image_credit || 'Photo from the Robodex entry.',
      });
    }
    return out;
  }, [robot, spec]);

  return (
    <section className="forge-block wv" aria-label="Wiring views">
      <h3>Wiring views <span className="fbadge local">3D + PHOTOS</span></h3>
      <div className="wv-switch" role="group" aria-label="Choose a wiring view">
        <button type="button" className={`btn btn-sm${mode === 'robot' ? ' btn-primary' : ''}`} aria-pressed={mode === 'robot'} onClick={() => setMode('robot')}>Full robot</button>
        <button type="button" className={`btn btn-sm${mode === 'connections' ? ' btn-primary' : ''}`} aria-pressed={mode === 'connections'} onClick={() => setMode('connections')}>Connections</button>
        <button type="button" className={`btn btn-sm${mode === 'photos' ? ' btn-primary' : ''}`} aria-pressed={mode === 'photos'} onClick={() => setMode('photos')}>Photos</button>
      </div>

      {mode === 'robot' && (
        <>
          <BuildTurntable robot={robot} spec={spec} onNeedSpecs={onNeedSpecs} />
          <p className="faint g-small">The plain 360° turntable — the same view as the Build tab.</p>
        </>
      )}

      {mode === 'connections' && (
        <>
          <BuildTurntable robot={robot} spec={spec} onNeedSpecs={onNeedSpecs} />
          {model.connections.length === 0 ? (
            <p className="faint g-small">
              No connections are recorded for this robot, so there is no map to light up. Connections
              recorded on the list above (or seeded from a robot&rsquo;s records) appear here.
            </p>
          ) : (
            <>
              <div className="wv-kinds" role="group" aria-label="Filter connections by kind">
                {(['All', ...CONNECTION_KINDS] as KindFilter[]).map((k) => (
                  <button key={k} type="button" className={`btn btn-sm${kind === k ? ' btn-primary' : ''}`}
                    aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {k}{k !== 'All' && ` (${kinds.filter((x) => x === k).length})`}
                  </button>
                ))}
              </div>
              <div className="ta-canvas wv-canvas" role="img"
                aria-label="Connection map diagram. Lines join the parts each recorded connection joins; choose a connection from the list below for its recorded detail.">
                <svg className="ta-lines" viewBox={`0 0 100 ${TA_H}`} preserveAspectRatio="none" aria-hidden="true">
                  {shown.map(({ c, i, k }) => {
                    const a = model.home[c.fromId]; const b = model.home[c.toId];
                    if (!a || !b) return null;
                    return (
                      <g key={i}>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`wv-line ${KIND_CLASS[k]}${selected === i ? ' hot' : ''}`} vectorEffect="non-scaling-stroke" />
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wv-hit" vectorEffect="non-scaling-stroke"
                          onClick={() => setSelected(i)}>
                          <title>{`${c.fromId} → ${c.toId}${c.detail ? ` — ${c.detail}` : ''}`}</title>
                        </line>
                      </g>
                    );
                  })}
                </svg>
                {model.parts.map((p) => {
                  const pos = model.home[p.id];
                  const hot = !!sel && (sel.fromId === p.id || sel.toId === p.id);
                  return (
                    <div key={p.id} role="button" tabIndex={0}
                      aria-label={`${p.label}. Choose to highlight its connections.`}
                      className={`ta-part home${hot ? ' hot' : ''}`}
                      style={{ left: `${pos.x}%`, top: `${(pos.y / TA_H) * 100}%` }}
                      onClick={() => {
                        const idx = model.connections.findIndex((c) => c.fromId === p.id || c.toId === p.id);
                        if (idx >= 0) setSelected(idx);
                      }}>
                      <strong>{p.label}</strong>
                      {p.detail && <span className="faint g-small">{p.detail}</span>}
                    </div>
                  );
                })}
              </div>
              <ul className="wv-list">
                {shown.map(({ c, i, k }) => {
                  const ev = evidenceOf(c.fromId, c.toId);
                  return (
                    <li key={i}>
                      <button type="button" className={`wv-row${selected === i ? ' sel' : ''}`} aria-pressed={selected === i} onClick={() => setSelected(i)}>
                        <span className={`fbadge ${KIND_CLASS[k]}`}>{k}</span>{' '}
                        <strong>{c.fromId} → {c.toId}</strong>
                        {c.detail && <span className="faint"> · {c.detail}</span>}
                        {ev?.evidence && <span className="fbadge">{ev.evidence}</span>}
                        {ev?.verifiedAt && <span className="faint g-small"> confirmed {ev.verifiedAt}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {sel && (
                <p className="wv-detail" aria-live="polite">
                  <strong>{sel.fromId} → {sel.toId}</strong>
                  {sel.detail ? ` — ${sel.detail}` : ' — no detail recorded for this connection.'}
                </p>
              )}
              <p className="faint g-small">
                Lines show the recorded LOGICAL connection, not a measured wire path. The record
                carries endpoints and detail text — no cable routes and no 3D positions for the
                parts — so the lines are drawn on this diagram (a computed layout), not on the 3D
                model. Where the view above shows the twin, its geometry is ESTIMATED.
              </p>
            </>
          )}
        </>
      )}

      {mode === 'photos' && (
        <>
          <p className="faint g-small">
            Real images only: this board uses photos and renders already in the app, each labelled
            as what it is — nothing here is generated for this view. The callouts under the board
            are the recorded connection map itself{robot.id === OMEGA1_ROBOT_ID ? ' — for Omega1, the DOCUMENTED records' : ''},
            with each connection&rsquo;s evidence badge where the record carries one.
          </p>
          {photos.length === 0 ? (
            <p><strong>No photos of this robot in the app yet.</strong> The connection callouts below are the recorded map on their own.</p>
          ) : (
            <div className="twin-grid wv-board">
              {photos.map((p, i) => (
                <article key={i} className="twin-card" style={{ cursor: 'default' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={p.title} loading="lazy" />
                  <strong>{p.title}</strong>
                  <span className="faint g-small">{p.credit}</span>
                </article>
              ))}
            </div>
          )}
          {model.connections.length === 0 ? (
            <p className="faint g-small">No connections are recorded for this robot, so there is nothing to call out.</p>
          ) : (
            CONNECTION_KINDS.map((k) => {
              const rows = model.connections.filter((c) => connectionKind(c.detail) === k);
              if (!rows.length) return null;
              return (
                <div key={k} className="wv-callouts">
                  <h4>{k}</h4>
                  <ul className="forge-list">
                    {rows.map((c, i) => {
                      const ev = evidenceOf(c.fromId, c.toId);
                      return (
                        <li key={i}>
                          <strong>{c.fromId} → {c.toId}</strong>
                          {c.detail && <span className="faint"> · {c.detail}</span>}
                          {ev?.evidence && <> <span className="fbadge">{ev.evidence}</span></>}
                          {ev?.verifiedAt && <span className="faint g-small"> confirmed {ev.verifiedAt}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </>
      )}
    </section>
  );
}
