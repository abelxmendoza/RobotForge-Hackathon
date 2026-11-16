'use client';
/* The arena from above: drag boxes to move them, pick one to change its
 * size, add or remove boxes. The car starts at the cross in the middle,
 * facing right; that spot has to stay clear. */
import { useRef, useState } from 'react';
import { ARENA_HALF, BOX_LIMITS, MAX_BOXES, coversStart, fitBox, START_CLEAR_M, type ArenaBox } from '@/lib/buildGuide';

const S = 100; // svg units per metre
const TONE: Record<ArenaBox['tone'], string> = { card: '#c9965a', wood: '#a8743f', blue: '#4f86c6' };

export default function ArenaEditor({ boxes, onChange, car }: { boxes: ArenaBox[]; onChange: (b: ArenaBox[]) => void; car?: { x: number; y: number; heading: number } }) {
  const svg = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<string | null>(boxes[0]?.id ?? null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const picked = boxes.find((b) => b.id === sel) ?? null;

  const toWorld = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * ARENA_HALF * 2 - ARENA_HALF, sy = ((e.clientY - r.top) / r.height) * ARENA_HALF * 2 - ARENA_HALF;
    return { x: sx, y: -sy }; // svg y grows down; world y is left
  };
  const update = (id: string, patch: Partial<ArenaBox>) => onChange(boxes.map((b) => (b.id === id ? fitBox({ ...b, ...patch }) : b)));
  const add = () => {
    if (boxes.length >= MAX_BOXES) return;
    let n = 1; while (boxes.some((b) => b.id === 'b' + n)) n++;
    // First free spot on a ring around the start.
    const spots = Array.from({ length: 16 }, (_, i) => ({ x: Math.cos(i * 0.9) * (0.6 + (i % 3) * 0.3), y: Math.sin(i * 0.9) * (0.6 + (i % 3) * 0.3) }));
    const spot = spots.find((p) => !boxes.some((b) => Math.abs(b.x - p.x) < (b.w + 0.2) / 2 && Math.abs(b.y - p.y) < (b.d + 0.2) / 2)) ?? spots[0];
    const box = fitBox({ id: 'b' + n, ...spot, w: 0.2, d: 0.2, h: 0.15, tone: (['card', 'wood', 'blue'] as const)[n % 3] });
    onChange([...boxes, box]); setSel(box.id);
  };
  const remove = () => { if (!picked) return; onChange(boxes.filter((b) => b.id !== picked.id)); setSel(null); };

  const blocked = boxes.filter(coversStart);
  return (
    <div className="bg-arena">
      <svg ref={svg} viewBox={`${-ARENA_HALF * S} ${-ARENA_HALF * S} ${ARENA_HALF * 2 * S} ${ARENA_HALF * 2 * S}`} className="bg-arena-map"
        role="application" aria-label="Arena seen from above. Drag a box to move it."
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const p = toWorld(e); update(d.id, { x: p.x - d.dx, y: p.y - d.dy });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
        onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}>
        <defs><pattern id="bg-grid" width={S / 4} height={S / 4} patternUnits="userSpaceOnUse"><path d={`M${S / 4},0 L0,0 0,${S / 4}`} className="bg-arena-grid" /></pattern></defs>
        <rect x={-ARENA_HALF * S} y={-ARENA_HALF * S} width={ARENA_HALF * 2 * S} height={ARENA_HALF * 2 * S} fill="url(#bg-grid)" className="bg-arena-floor" />
        <circle r={START_CLEAR_M * S} className="bg-arena-start" />
        <path d="M-10,0 L10,0 M0,-10 L0,10" className="bg-arena-cross" />
        {boxes.map((b) => (
          <rect key={b.id} x={(b.x - b.w / 2) * S} y={(-b.y - b.d / 2) * S} width={b.w * S} height={b.d * S} rx={2}
            fill={TONE[b.tone]} className={'bg-arena-box' + (b.id === sel ? ' sel' : '') + (coversStart(b) ? ' bad' : '')}
            tabIndex={0} role="button" aria-label={`Box ${Math.round(b.w * 100)} by ${Math.round(b.d * 100)} cm`} aria-pressed={b.id === sel}
            onFocus={() => setSel(b.id)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02, k = e.key;
              const m = k === 'ArrowLeft' ? [-step, 0] : k === 'ArrowRight' ? [step, 0] : k === 'ArrowUp' ? [0, step] : k === 'ArrowDown' ? [0, -step] : null;
              if (m) { e.preventDefault(); update(b.id, { x: b.x + m[0], y: b.y + m[1] }); }
              if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); onChange(boxes.filter((x) => x.id !== b.id)); setSel(null); }
            }}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setSel(b.id); const p = toWorld(e); drag.current = { id: b.id, dx: p.x - b.x, dy: p.y - b.y }; }} />
        ))}
        {car && <g transform={`translate(${car.x * S},${-car.y * S}) rotate(${-car.heading})`} className="bg-arena-car"><rect x={-12} y={-7} width={24} height={14} rx={3} /><path d="M12,0 L6,-4 L6,4 z" /></g>}
      </svg>
      <div className="bg-arena-side">
        <div className="bg-row">
          <button className="btn btn-sm" onClick={add} disabled={boxes.length >= MAX_BOXES}>+ Box</button>
          <button className="btn btn-sm" onClick={remove} disabled={!picked}>Remove</button>
        </div>
        {picked ? (
          <div className="bg-arena-fields">
            {(['w', 'd', 'h'] as const).map((k) => (
              <label key={k}><span>{k === 'w' ? 'Length' : k === 'd' ? 'Width' : 'Height'}</span>
                <input type="range" min={BOX_LIMITS[k][0] * 100} max={BOX_LIMITS[k][1] * 100} step={1} value={Math.round(picked[k] * 100)}
                  onChange={(e) => update(picked.id, { [k]: Number(e.target.value) / 100 })} />
                <output>{Math.round(picked[k] * 100)} cm</output>
              </label>
            ))}
          </div>
        ) : <p className="faint g-small">Pick a box to size it. Arrow keys nudge the picked box.</p>}
        {blocked.length > 0 && <p className="bg-warn g-small" role="status">A box covers the start. Move it off the circle.</p>}
      </div>
    </div>
  );
}
