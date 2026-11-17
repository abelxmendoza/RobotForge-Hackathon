'use client';
/* The visual code walkthrough: the obstacle avoider as a flowchart.
 * While the car drives itself, the box it is in lights up, and the
 * path of its last decision stays lit. Pick a box to see the sketch
 * lines behind it. */
import { useMemo } from 'react';
import { FLOW, FLOW_EDGES, flowLines, type FlowId } from '@/lib/buildGuide';

const W = 156, H = 42, GX = 176, GY = 70, PAD = 30;
const at = (id: FlowId) => { const n = FLOW.find((f) => f.id === id)!; return { x: PAD + n.col * GX, y: PAD + n.row * GY }; };

function edgePath(from: FlowId, to: FlowId): { d: string; lx: number; ly: number } {
  const a = at(from), b = at(to);
  const ac = { x: a.x + W / 2, y: a.y + H / 2 }, bc = { x: b.x + W / 2, y: b.y + H / 2 };
  const dc = Math.round((b.x - a.x) / GX), dr = Math.round((b.y - a.y) / GY);
  if (dr === 0 && Math.abs(dc) === 1) { const s = Math.sign(dc); const x1 = ac.x + s * W / 2, x2 = bc.x - s * W / 2; return { d: `M${x1},${ac.y} L${x2},${bc.y}`, lx: (x1 + x2) / 2, ly: ac.y - 5 }; }
  if (dc === 0 && Math.abs(dr) === 1) { const s = Math.sign(dr); const y1 = ac.y + s * H / 2, y2 = bc.y - s * H / 2; return { d: `M${ac.x},${y1} L${bc.x},${y2}`, lx: ac.x + 6, ly: (y1 + y2) / 2 + 4 }; }
  if (dc === 0) { // same column, skipping boxes: loop out to the left
    const x = ac.x - W / 2, out = x - 24; return { d: `M${x},${ac.y} C${out},${ac.y} ${out},${bc.y} ${x},${bc.y}`, lx: out, ly: (ac.y + bc.y) / 2 };
  }
  if (dr === 0) { // same row, skipping boxes: loop underneath
    const y = ac.y + H / 2, dip = y + 22; return { d: `M${ac.x},${y} C${ac.x},${dip} ${bc.x},${dip} ${bc.x},${y}`, lx: (ac.x + bc.x) / 2, ly: dip };
  }
  // Diagonal: leave from the side, arrive at the top or bottom.
  const sx = Math.sign(dc) || -1, sy = Math.sign(dr);
  const x1 = ac.x + sx * W / 2, y2 = bc.y - sy * H / 2;
  return { d: `M${x1},${ac.y} C${bc.x},${ac.y} ${bc.x},${ac.y} ${bc.x},${y2}`, lx: (x1 + bc.x) / 2, ly: ac.y - 5 };
}

export function FlowChart({ live, trail, picked, onPick }: { live: FlowId | null; trail: FlowId[]; picked: FlowId | null; onPick: (id: FlowId) => void }) {
  const edges = useMemo(() => FLOW_EDGES.map((e) => ({ ...e, ...edgePath(e.from, e.to) })), []);
  const cols = Math.max(...FLOW.map((f) => f.col)), rows = Math.max(...FLOW.map((f) => f.row));
  const width = PAD * 2 + cols * GX + W, height = PAD * 2 + rows * GY + H;
  return (
    <svg className="bg-flow" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Flowchart of the obstacle avoider">
      <defs>
        <marker id="bg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" className="bg-arrowhead" /></marker>
      </defs>
      {edges.map((e) => (
        <g key={e.from + e.to} className={'bg-edge' + (trail.includes(e.to) && trail.includes(e.from) ? ' lit' : '')}>
          <path d={e.d} markerEnd="url(#bg-arrow)" />
          {e.label && <text x={e.lx} y={e.ly} textAnchor="middle">{e.label}</text>}
        </g>
      ))}
      {FLOW.map((n) => {
        const p = at(n.id), cls = ['bg-node', n.kind, live === n.id ? 'live' : '', trail.includes(n.id) ? 'trail' : '', picked === n.id ? 'picked' : ''].join(' ');
        return (
          <g key={n.id} className={cls} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-pressed={picked === n.id}
            aria-label={`${n.label}${live === n.id ? ' (running now)' : ''}`}
            onClick={() => onPick(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(n.id); } }}>
            <rect width={W} height={H} rx={n.kind === 'ask' ? 20 : 6} />
            <text x={W / 2} y={H / 2 + 5} textAnchor="middle">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The sketch lines behind one box, with its line numbers. */
export function FlowCode({ code, id, file }: { code: string; id: FlowId; file: string }) {
  const node = FLOW.find((f) => f.id === id)!;
  const { lines } = useMemo(() => flowLines(code, id), [code, id]);
  return (
    <div className="bg-flowcode">
      <p className="bg-flowcode-say"><b>{node.label}</b> {node.say}</p>
      <pre aria-label={`${file}, lines ${lines[0].n} to ${lines.at(-1)!.n}`}>
        {lines.map((l) => <span key={l.n} className={l.text.includes('// ▸') ? 'mark' : ''}><i>{l.n}</i>{l.text + '\n'}</span>)}
      </pre>
      <p className="faint g-small">{file} · lines {lines[0].n}–{lines.at(-1)!.n}</p>
    </div>
  );
}
