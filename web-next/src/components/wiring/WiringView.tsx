'use client';
/* The wiring harness: a schematic of a spec's `wiring` block, battery on
 * the left and loads to the right, every cable drawn once and labelled
 * from the data. React port of the vanilla assets/js/wiring.js view.
 * Solid line = power, dashed = data; amber power, blue data, red only for
 * a recorded over-voltage. Click a part to trace its paths and run the
 * "if this part dies" test; click a cable to read it. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { assetPath } from '@/components/home/asset';
import {
  badConns, cableField, callout, chipText, failure, layout, nodeMap, nodeStatus,
  shortLabel, stageOf, trace, volts, type Wiring,
} from '@/lib/wiring';

/* Electronics terms (AWG, BEC, ESC...) get their meaning on hover/tap. */
let glossaryCache: Record<string, string> | null = null;
function useGlossary() {
  const [g, setG] = useState<Record<string, string> | null>(glossaryCache);
  useEffect(() => {
    if (glossaryCache) return;
    fetch(assetPath('assets/js/glossary.json'), { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.terms) { glossaryCache = d.terms; setG(d.terms); } })
      .catch(() => {});
  }, []);
  return g;
}

function Marked({ text, g }: { text: string; g: Record<string, string> | null }) {
  const re = useMemo(() => {
    if (!g) return null;
    const terms = Object.keys(g).sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('\\b(' + terms.join('|') + ')\\b', 'gi');
  }, [g]);
  if (!re || !g) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = Object.keys(g).find((t) => t.toLowerCase() === m[0].toLowerCase());
    out.push(
      <span key={k++} className="term" tabIndex={0}>
        {m[0]}<span className="term-tip" role="tooltip">{key ? g[key] : ''}</span>
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Sel = { type: 'node'; id: string } | { type: 'conn'; i: number } | null;

export default function WiringView({ wiring: w }: { wiring: Wiring }) {
  const g = useGlossary();
  const L = useMemo(() => layout(w), [w]);
  const bad = useMemo(() => badConns(w), [w]);
  const nodes = useMemo(() => nodeMap(w), [w]);
  const [mode, setMode] = useState<'simple' | 'full'>('simple');
  const [sel, setSel] = useState<Sel>(null);
  const [tr, setTr] = useState<{ nodes: string[]; conns: number[] } | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [power, setPower] = useState(false);
  const [stage, setStage] = useState(0);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { setSel(null); setTr(null); setDead(null); }, [w]);

  /* Power on lights the cables in supply order, battery first. */
  const togglePower = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    const on = !power;
    setPower(on); setStage(0);
    if (!on) return;
    const stages = [...new Set(w.connections.map((_, i) => stageOf(w, L.depth, i)).filter(Number.isFinite))].sort((a, b) => a - b);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setStage(stages[stages.length - 1] ?? 0); return; }
    stages.forEach((s, k) => { timers.current.push(window.setTimeout(() => setStage(s), 80 + k * 190)); });
  };

  const lost = useMemo(() => new Set(dead ? failure(w, dead) : []), [w, dead]);
  const traceNodes = tr ? new Set(tr.nodes) : null;
  const traceConns = tr ? new Set(tr.conns) : null;
  const showAll = () => { setTr(null); setDead(null); setSel(null); };
  const pickNode = (id: string) => { setTr(trace(w, id)); setDead(null); setSel({ type: 'node', id }); };
  const pickConn = (i: number) => { setTr(null); setDead(null); setSel({ type: 'conn', i }); };

  const known = w.connections.filter((c) => c.cable?.length_mm != null);
  const total = known.reduce((s, c) => s + Number(c.cable?.length_mm ?? 0), 0);

  const print = () => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add('wv-printing');
    const clear = () => root.classList.remove('wv-printing');
    window.addEventListener('afterprint', clear, { once: true });
    setTimeout(clear, 1500);
    window.print();
  };

  let detail: ReactNode;
  if (sel?.type === 'node' && nodes[sel.id]) {
    const id = sel.id, node = nodes[id], st = nodeStatus(w, id);
    const conns = w.connections.map((c, i) => (c.from === id || c.to === id ? i : -1)).filter((i) => i >= 0);
    detail = (
      <>
        <span className="qty">Electrical component</span>
        <h3><Marked text={node.label} g={g} /></h3>
        <dl>
          <dt>Electrical requirement</dt><dd className="m"><Marked text={node.req_label || 'not specified'} g={g} /></dd>
          <dt>Supplied by</dt>
          <dd>{st.feeds.length ? st.feeds.map((c, k) => <Fragment key={k}>{k > 0 && <br />}{shortLabel(nodes[c.from])} · {c.volts != null ? volts(c.volts) : (c.label || 'no fixed voltage')}</Fragment>) : '— (it is a source)'}</dd>
          <dt>Status</dt>
          <dd>{st.state === 'bad' ? <span className="elec-bad">Over-voltage: a recorded feed exceeds this part’s rated maximum.</span>
            : st.state === 'ok' ? <span className="elec-ok">Within rating on the recorded values.</span>
            : <span className="elec-unchecked">Not checked: {st.reason}.</span>}</dd>
          <dt>Connections</dt>
          <dd>{conns.map((i, k) => { const c = w.connections[i]; const other = c.from === id ? c.to : c.from; return <Fragment key={i}>{k > 0 && <br />}{c.from === id ? '→ ' : '← '}{shortLabel(nodes[other])} · {c.kind}{c.kind === 'power' ? ' · ' + volts(c.volts) : ''}</Fragment>; })}</dd>
          {dead === id && <>
            <dt>If this part dies</dt>
            <dd>{lost.size ? <>These lose power: <strong>{[...lost].map((x) => shortLabel(nodes[x])).join(', ')}</strong>.</> : 'Nothing else loses power; no other part is fed only through this one.'}
              <br /><span className="faint">Power cables only; data links don’t keep a part alive.</span></dd>
          </>}
        </dl>
        <p className="wv-actions">
          <button type="button" className="btn btn-sm" onClick={() => setDead(dead === id ? null : id)}>{dead === id ? 'Clear the failure test' : 'If this part dies…'}</button>{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={showAll}>Show all</button>
        </p>
      </>
    );
  } else if (sel?.type === 'conn' && w.connections[sel.i]) {
    const i = sel.i, c = w.connections[i];
    detail = (
      <>
        <span className="qty">{c.kind === 'power' ? 'Power cable' : 'Data cable'}</span>
        <h3>{shortLabel(nodes[c.from])} → {shortLabel(nodes[c.to])}</h3>
        <p className="wv-callout"><Marked text={callout(w, i)} g={g} /></p>
        <dl>
          <dt>Type</dt><dd className="m">{c.kind}</dd>
          <dt>Volts</dt><dd className="m">{volts(c.volts)}</dd>
          <dt>Gauge</dt><dd className="m">{cableField(c.cable, 'gauge_awg')}</dd>
          <dt>Connector</dt><dd className="m"><Marked text={cableField(c.cable, 'connector')} g={g} /></dd>
          <dt>Length</dt><dd className="m">{cableField(c.cable, 'length_mm')}</dd>
          {c.label && <><dt>Recorded label</dt><dd className="m"><Marked text={c.label} g={g} /></dd></>}
          {bad.has(i) && <><dt>Status</dt><dd><span className="elec-bad">Over-voltage: above the target’s recorded rated maximum.</span></dd></>}
        </dl>
        <p className="wv-actions"><button type="button" className="btn btn-sm btn-ghost" onClick={showAll}>Show all</button></p>
      </>
    );
  } else {
    detail = (
      <>
        <h3>Wiring harness</h3>
        <p className="muted g-small">Tap a part to trace what it connects to. Tap a cable to read it. Anything the data doesn’t name reads “not specified”.</p>
        <dl className="wv-counts"><dt>Parts</dt><dd className="m">{w.nodes.length}</dd><dt>Cables</dt><dd className="m">{w.connections.length}</dd>{bad.size > 0 && <><dt>Over-voltage</dt><dd className="m elec-bad">{bad.size}</dd></>}</dl>
      </>
    );
  }

  return (
    <div className="wv" data-mode={mode} ref={rootRef}>
      <div className="wv-tools">
        <div className="g-tabs wv-mode" role="tablist" aria-label="Wiring detail level">
          {(['simple', 'full'] as const).map((m) => (
            <button key={m} type="button" className="chip" role="tab" aria-selected={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'simple' ? 'Simple' : 'Full labels'}</button>
          ))}
        </div>
        <button type="button" className={'btn btn-sm wv-power' + (power ? ' on' : '')} aria-pressed={power} onClick={togglePower}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0" /></svg>
          {power ? 'Power off' : 'Power on'}
        </button>
        {(tr || dead) && <button type="button" className="btn btn-sm btn-ghost" onClick={showAll}>Show all</button>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={print}>Print harness sheet</button>
      </div>
      {w.note && <details className="g-howto wv-notebox"><summary>About this harness</summary><p className="wv-note"><Marked text={w.note} g={g} /></p></details>}
      <div className="wv-stage">
        <div className="wv-diagram">
          <svg viewBox={`0 0 ${L.width} ${L.height}`} width="100%" role="img" aria-label="Wiring schematic" style={{ display: 'block', maxWidth: Math.min(L.width, 980) }}>
            {L.edges.map((e) => {
              if (!e) return null;
              const c = w.connections[e.i];
              const text = chipText(w, e.i, mode);
              const tw = Math.max(34, text.length * 6.1 + 12);
              const on = power && e.stage <= stage;
              const cls = ['wv-cable', bad.has(e.i) && 'bad', on && 'on', sel?.type === 'conn' && sel.i === e.i && 'sel',
                traceConns && !traceConns.has(e.i) && 'dim',
                dead != null && (c.from === dead || c.to === dead || lost.has(c.to)) && 'dead'].filter(Boolean).join(' ');
              return (
                <g key={e.i} className={cls} onClick={() => pickConn(e.i)}>
                  <path className="wv-hit" d={e.d} />
                  <path className={'wv-line ' + c.kind + (on ? ' on' : '')} d={e.d} />
                  {bad.has(e.i) && <text className="wv-badtag" x={e.mx} y={e.my - 12} textAnchor="middle">⚠ over-voltage</text>}
                  <g className="wv-chip">
                    <rect x={e.mx - tw / 2} y={e.my - 9} width={tw} height={17} rx={8} />
                    <text x={e.mx} y={e.my + 3.5} textAnchor="middle">{text}</text>
                  </g>
                </g>
              );
            })}
            {w.nodes.map((n) => {
              const p = L.pos[n.id];
              if (!p) return null;
              const d = L.depth[n.id];
              const label = shortLabel(n);
              const cls = ['wv-node', power && d <= stage && 'on', sel?.type === 'node' && sel.id === n.id && 'sel',
                traceNodes && !traceNodes.has(n.id) && 'dim', (dead === n.id || lost.has(n.id)) && 'dead'].filter(Boolean).join(' ');
              return (
                <g key={n.id} className={cls} tabIndex={0} role="button" aria-label={n.label}
                  onClick={() => pickNode(n.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickNode(n.id); } }}>
                  <rect x={p.x} y={p.y} width={L.box.w} height={L.box.h} rx={8} />
                  <text className="wv-nl" x={p.x + L.box.w / 2} y={p.y + 23} textAnchor="middle">{label.length > 27 ? label.slice(0, 26) + '…' : label}</text>
                  <text className="wv-req" x={p.x + L.box.w / 2} y={p.y + 40} textAnchor="middle">{n.req_label}</text>
                </g>
              );
            })}
          </svg>
          <p className="cap"><span className="wv-key power" /> power <span className="wv-key data" /> data · red is only ever a recorded over-voltage.</p>
        </div>
        <aside className="card ta-detail wv-detail" aria-live="polite">{detail}</aside>
      </div>
      <h3 className="wv-table-title">Cut list</h3>
      <div className="wv-tablewrap">
        <table className="wv-table">
          <thead><tr><th>From</th><th>To</th><th>Type</th><th>Volts</th><th>Gauge</th><th>Connector</th><th>Length</th></tr></thead>
          <tbody>
            {w.connections.map((c, i) => (
              <tr key={i} className={bad.has(i) ? 'wv-badrow' : undefined} aria-selected={sel?.type === 'conn' && sel.i === i} onClick={() => pickConn(i)}>
                <td><Marked text={shortLabel(nodes[c.from])} g={g} /></td>
                <td><Marked text={shortLabel(nodes[c.to])} g={g} /></td>
                <td className="m">{c.kind}</td>
                <td className="m">{volts(c.volts)}</td>
                <td className="m">{cableField(c.cable, 'gauge_awg')}</td>
                <td><Marked text={cableField(c.cable, 'connector')} g={g} /></td>
                <td className="m">{cableField(c.cable, 'length_mm')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint g-small wv-total">
          {known.length === w.connections.length && known.length
            ? `Total cable: ${total} mm across ${known.length} connections, every length recorded.`
            : `Lengths are recorded for ${known.length} of ${w.connections.length} cables, so no total is shown.`}
        </p>
      </div>
    </div>
  );
}
