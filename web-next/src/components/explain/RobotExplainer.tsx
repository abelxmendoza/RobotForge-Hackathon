"use client";
/* "How does my robot work?" — the step-through figure.
 *
 * Everything on screen is drawn from two pure functions in
 * lib/robotExplainer.ts: layoutExplainer (where each part sits) and
 * explainerFrame (what is lit, where every pulse is, which way every
 * wheel turns, at time t of a step). This component only keeps the
 * clock and the mode, so any frame can be drawn in any order.
 *
 * Manual (the default): only the next step can be pressed; it plays
 * once and holds. Auto: every step plays in a loop. The choice is
 * remembered in this browser.
 *
 * With ?render in the URL the clock stops and window.__rfExplainer.seek
 * (step, t) draws one exact frame: tools/check_explainer.cjs uses it
 * for stills at every step and the jump scan. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  along, channelsOf, EVIDENCE_LABEL, explainerFrame, explainerTimeline, FIG, layoutExplainer,
  type Evidence, type Explainer, type Frame, type Placement,
} from "@/lib/robotExplainer";

const MODE_KEY = "rf.explainMode.v1";

declare global {
  interface Window { __rfExplainer?: { steps: number; durations: number[]; seek: (step: number, t: number) => void } }
}

function readMode(): "manual" | "auto" {
  try { return window.localStorage.getItem(MODE_KEY) === "auto" ? "auto" : "manual"; } catch { return "manual"; }
}
function writeMode(m: "manual" | "auto") {
  try { window.localStorage.setItem(MODE_KEY, m); } catch { /* private window: fine */ }
}

export default function RobotExplainer({ explainer: x, compact = false }: { explainer: Explainer; compact?: boolean }) {
  const layout = useMemo(() => layoutExplainer(x), [x]);
  const timeline = useMemo(() => explainerTimeline(x), [x]);
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  /* -1 = nothing pressed yet. `done` = the highest step finished in Manual. */
  const [step, setStep] = useState(-1);
  const [t, setT] = useState(0);
  const [done, setDone] = useState(-1);
  const render = useRef(false);
  const clock = useRef({ start: 0, g: 0 });
  const reduce = useRef(false);

  useEffect(() => {
    render.current = /[?&]render\b/.test(window.location.search);
    reduce.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const m = readMode();
    setMode(m);
    if (m === "auto" && !render.current) { setStep(0); setT(0); }
  }, []);

  /* The clock. Manual: t runs 0 → duration, then holds. Auto: a global
   * time walks the whole timeline in a loop. */
  useEffect(() => {
    if (render.current || step < 0) return;
    if (reduce.current) { setT(x.steps[step].duration * 0.5); return; }
    let raf = 0;
    const t0 = performance.now();
    const g0 = clock.current.g;
    const tick = (now: number) => {
      const el = (now - t0) / 1000;
      if (mode === "auto") {
        const g = g0 + el;
        clock.current.g = g;
        const at = timeline.at(g);
        setStep(at.step);
        setT(at.t);
      } else {
        const d = x.steps[step].duration;
        setT(Math.min(d, el));
        if (el >= d) { setDone((v) => Math.max(v, step)); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // In Auto the effect must not restart on every step change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mode === "manual" ? step : -2, timeline, x]);

  /* Seek hook for the frame checks. */
  useEffect(() => {
    window.__rfExplainer = {
      steps: x.steps.length,
      durations: x.steps.map((s) => s.duration),
      seek: (s: number, tt: number) => { setStep(s); setT(tt); },
    };
    return () => { delete window.__rfExplainer; };
  }, [x]);

  const press = useCallback((i: number) => {
    if (mode === "auto") return;
    setStep(i);
    setT(0);
  }, [mode]);

  const startOver = () => {
    clock.current.g = 0;
    setDone(-1);
    setT(0);
    setStep(mode === "auto" ? 0 : -1);
  };

  const toggle = (m: "manual" | "auto") => {
    writeMode(m);
    setMode(m);
    clock.current.g = 0;
    setDone(-1);
    setT(0);
    setStep(m === "auto" ? 0 : -1);
  };

  const frame: Frame | null = step >= 0 ? explainerFrame(x, step, t) : null;
  const cur = step >= 0 ? x.steps[step] : null;
  const next = mode === "manual" ? Math.min(done + 1, x.steps.length - 1) : -1;

  if (!x.steps.length) {
    return <div className="rx rx-empty"><p>{x.robotName}&rsquo;s record holds too little to explain yet: {x.gaps.join(" ")}</p></div>;
  }

  return (
    <div className={"rx" + (compact ? " rx-compact" : "")}>
      <div className="rx-steps" role="group" aria-label="Steps">
        <div className="rx-mode" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={mode === "manual"} className={mode === "manual" ? "on" : ""} onClick={() => toggle("manual")}>Manual</button>
          <button type="button" role="radio" aria-checked={mode === "auto"} className={mode === "auto" ? "on" : ""} onClick={() => toggle("auto")}>Auto</button>
        </div>
        <ol>
          {x.steps.map((s, i) => {
            const state = i === step ? "now" : i <= done ? "done" : i === next ? "next" : "later";
            const live = mode === "manual" && (i === next || i <= done || i === step);
            return (
              <li key={s.id}>
                <button type="button" className={"rx-step rx-" + state} disabled={!live} aria-current={i === step ? "step" : undefined} onClick={() => press(i)}>
                  <span className="rx-n" aria-hidden="true">{i <= done && i !== step ? "✓" : i + 1}</span>
                  <span>{s.button}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className="rx-over" onClick={startOver}>Start over</button>
      </div>

      <div className="rx-main">
        <p className="rx-hint" aria-live="polite">
          {cur ? cur.hint : mode === "manual" ? `Press step 1 to see how ${x.robotName} works.` : ""}
        </p>
        <div className="rx-stage">
          <Figure x={x} layout={layout} frame={frame} />
          <CutWindow x={x} frame={frame} />
        </div>
        {cur && (
          <ul className="rx-facts" aria-label="Numbers for this step">
            {cur.facts.map((f, i) => (
              <li key={i} className={"rx-fact ev-" + f.evidence.toLowerCase()}>
                <span className="rx-fl">{f.label}</span>
                <span className="rx-fv">{f.value}</span>
                <span className="rx-ev" title={EVIDENCE_LABEL[f.evidence as Evidence]}>{EVIDENCE_LABEL[f.evidence as Evidence]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="rx-big"><strong>The big idea:</strong> {x.bigIdea}</p>
        <p className="rx-basis faint">{x.basis}{x.gaps.length ? " " + x.gaps.join(" ") : ""}</p>
      </div>
    </div>
  );
}

/* ---------------- the figure ---------------- */

function centre(p: Placement): [number, number] { return [p.x + p.w / 2, p.y + p.h / 2]; }

function Figure({ x, layout, frame }: { x: Explainer; layout: ReturnType<typeof layoutExplainer>; frame: Frame | null }) {
  const lit = new Set(frame?.lit ?? []);
  const flow = new Set(frame ? x.steps[frame.step].flow : []);
  const glow = frame?.glow ?? 0;
  const fade = frame?.fade ?? 0;
  const { cx, cy, bw, bh } = FIG;
  const GRID = 28;
  const step = frame ? x.steps[frame.step] : null;
  const firstLit = layout.parts.find((p) => lit.has(p.node));
  const soundAt: [number, number] = step?.motion === "forward" || step?.motion === "turn"
    ? [cx + bw / 2 + 52, cy - bh / 2 + 30]
    : firstLit ? [centre(firstLit)[0] + 44, centre(firstLit)[1] - 22] : [cx, cy];
  const nodeLabel = (id: string) => x.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <svg className="rx-fig" viewBox={`0 0 ${FIG.w} ${FIG.h}`} role="img" aria-label={`${x.robotName}, seen from above${step ? ": " + step.button : ""}`}>
      <defs>
        <pattern id="rx-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${((frame?.floor ?? 0) * GRID).toFixed(2)})`}>
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} className="rx-gridline" />
        </pattern>
        <clipPath id="rx-tread"><rect x={-15} y={-50} width={30} height={100} rx={7} /></clipPath>
      </defs>
      <rect x={0} y={0} width={FIG.w} height={FIG.h} fill="url(#rx-grid)" className="rx-floor" />
      <g transform={`translate(${cx} ${cy}) scale(${(frame?.zoom ?? 1).toFixed(4)}) rotate(${(frame?.rot ?? 0).toFixed(2)}) translate(${-cx} ${-cy})`}>
        {/* body */}
        <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx={18} className="rx-body" />
        <path d={`M ${cx - 16} ${cy - bh / 2 + 10} L ${cx} ${cy - bh / 2 - 2} L ${cx + 16} ${cy - bh / 2 + 10}`} className="rx-nose" />
        {/* wheels */}
        {layout.wheels.map((w) => {
          const st = frame?.wheel[w.wheel];
          const dir = st?.dir ?? 0;
          const phase = st?.phase ?? 0;
          const spacing = 12;
          const off = -phase * spacing;
          const lines = [];
          for (let k = -6; k <= 9; k++) lines.push(<line key={k} x1={-15} x2={15} y1={k * spacing + off} y2={k * spacing + off} className="rx-treadline" />);
          const active = Math.abs(dir) > 0.05;
          return (
            <g key={w.wheel} transform={`translate(${w.x + w.w / 2} ${w.y + w.h / 2})`}>
              <rect x={-w.w / 2} y={-w.h / 2} width={w.w} height={w.h} rx={7} className={"rx-wheel" + (active ? " on" : "")} />
              <g clipPath="url(#rx-tread)" transform={`scale(${w.w / 30} ${w.h / 100})`}>{lines}</g>
              {active && (
                <path d={dir > 0 ? "M -7 6 L 0 -6 L 7 6" : "M -7 -6 L 0 6 L 7 -6"} className="rx-arrow" style={{ opacity: Math.min(1, Math.abs(dir)) }}
                  transform={`translate(${w.side === "left" ? -w.w / 2 - 14 : w.w / 2 + 14} 0)`} />
              )}
            </g>
          );
        })}
        {/* wires */}
        {layout.wires.map((wire, i) => {
          const e = x.edges.find((q) => q.id === wire.edge)!;
          const on = flow.has(e.id);
          return <polyline key={i} points={wire.pts.map((p) => p.join(",")).join(" ")}
            className={"rx-wire rx-" + e.kind + (on ? " on" : "") + (e.evidence === "INFERRED" ? " inferred" : "")} />;
        })}
        {/* parts */}
        {layout.parts.map((p, i) => {
          const on = lit.has(p.node);
          const wob = p.shape === "motor" && on ? 1 + 0.12 * (frame?.wobble ?? 0) : 1;
          const [pcx, pcy] = centre(p);
          return (
            <g key={i} className={"rx-part rx-" + p.shape + (on ? " on" : "")} style={on ? { opacity: 0.55 + 0.45 * glow } : undefined}
              transform={wob !== 1 ? `translate(${pcx} ${pcy}) scale(${wob}) translate(${-pcx} ${-pcy})` : undefined}>
              <title>{nodeLabel(p.node)}</title>
              {p.shape === "motor"
                ? <circle cx={pcx} cy={pcy} r={p.w / 2} />
                : <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.shape === "battery" ? 6 : 4} />}
              {p.shape === "battery" && <>
                <line x1={p.x + p.w * 0.5} y1={p.y + 4} x2={p.x + p.w * 0.5} y2={p.y + p.h - 4} className="rx-cellsep" />
              </>}
              {p.shape !== "motor" && p.w >= 40 && (
                <text x={pcx} y={pcy + 4} textAnchor="middle" className="rx-plabel">
                  {fit(x.nodes.find((n) => n.id === p.node)?.short ?? "", p.w)}
                </text>
              )}
              {p.shape === "motor" && <text x={pcx} y={pcy + 4} textAnchor="middle" className="rx-plabel rx-m">M</text>}
            </g>
          );
        })}
        {/* pulses */}
        {frame && fade > 0.01 && layout.wires.filter((w) => flow.has(w.edge)).map((w, i) =>
          frame.pulses.filter((pp) => pp.edge === w.edge).map((pp, k) => {
            const [px, py] = along(w.pts, pp.s);
            const kind = x.edges.find((e) => e.id === w.edge)?.kind;
            return <circle key={i + ":" + k} cx={px} cy={py} r={4} className={"rx-pulse rx-" + kind} style={{ opacity: fade }} />;
          }))}
        {/* sensing */}
        {frame && step?.motion === "sense" && layout.parts.filter((p) => lit.has(p.node)).map((p, i) => {
          const n = x.nodes.find((q) => q.id === p.node);
          const [sx] = centre(p);
          const sy = p.y;
          if (n?.sensor === "ultrasonic") {
            return <g key={i}>{[0, 0.5].map((o) => {
              const ph = (frame.ping + o) % 1;
              const r = 12 + ph * 70;
              return <path key={o} d={`M ${sx - r * 0.7} ${sy - r * 0.7} A ${r} ${r} 0 0 1 ${sx + r * 0.7} ${sy - r * 0.7}`} className="rx-ping" style={{ opacity: (1 - ph) * fade }} />;
            })}</g>;
          }
          if (n?.sensor === "camera" || n?.sensor === "depth") {
            return <path key={i} d={`M ${sx} ${sy} L ${sx - 46} ${sy - 80} L ${sx + 46} ${sy - 80} Z`} className="rx-cone" style={{ opacity: 0.6 * fade }} />;
          }
          if (n?.sensor === "lidar") {
            const a = frame.t * Math.PI * 2 * 0.8;
            return <line key={i} x1={sx} y1={p.y + p.h / 2} x2={sx + Math.cos(a) * 110} y2={p.y + p.h / 2 + Math.sin(a) * 110} className="rx-lidar" style={{ opacity: fade }} />;
          }
          if (n?.sensor === "ir") {
            return <g key={i}>{[-14, 0, 14].map((d) => <circle key={d} cx={sx + d} cy={p.y + p.h + 8} r={3} className="rx-ir" style={{ opacity: (0.4 + 0.6 * Math.abs(Math.sin(frame.t * 3 + d))) * fade }} />)}</g>;
          }
          return null;
        })}
      </g>
      {/* the sound word sits outside the turning body, so it stays readable */}
      {frame && step && (
        <text x={soundAt[0]} y={soundAt[1]} className="rx-sound" style={{ opacity: fade }} transform={`rotate(-8 ${soundAt[0]} ${soundAt[1]})`}>{step.sound}</text>
      )}
    </svg>
  );
}

function fit(s: string, w: number): string {
  const max = Math.max(3, Math.floor((w - 8) / 7));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* ---------------- the cut window ---------------- */

function CutWindow({ x, frame }: { x: Explainer; frame: Frame | null }) {
  const step = frame ? x.steps[frame.step] : null;
  const R = 110;
  const c = 120;
  if (!frame || !step) {
    return (
      <svg className="rx-win" viewBox="0 0 240 260" aria-hidden="true">
        <circle cx={c} cy={c} r={R} className="rx-lens" />
        <text x={c} y={c + 4} textAnchor="middle" className="rx-wtext faint">a look inside</text>
      </svg>
    );
  }
  const w = step.window;
  const fade = frame.fade;
  let inner: ReactNode = null;

  if (w.kind === "battery") {
    const m = /(\d+)\s*[×x]/.exec(w.lines[0] ?? "");
    const cells = Math.max(1, Math.min(4, m ? Number(m[1]) : 1));
    const cw = 150 / cells;
    inner = <g>
      {Array.from({ length: cells }, (_, i) => (
        <g key={i}>
          <rect x={45 + i * cw + 3} y={92} width={cw - 6} height={56} rx={8} className="rx-cell" />
          <text x={45 + i * cw + cw / 2} y={125} textAnchor="middle" className="rx-wtext">{i === 0 ? "+" : "− +"}</text>
        </g>
      ))}
      {Array.from({ length: 6 }, (_, k) => {
        const s = ((frame.t / 1.2) + k / 6) % 1;
        return <circle key={k} cx={45 + s * 150} cy={78} r={3.5} className="rx-pulse rx-power" style={{ opacity: fade }} />;
      })}
      <text x={c} y={178} textAnchor="middle" className="rx-wbig">{w.lines[1]}</text>
    </g>;
  } else if (w.kind === "compute") {
    const bars = 4;
    inner = <g>
      <rect x={70} y={70} width={100} height={100} rx={8} className="rx-chip" />
      {Array.from({ length: 7 }, (_, k) => <g key={k}>
        <line x1={78 + k * 14} y1={62} x2={78 + k * 14} y2={70} className="rx-pin" />
        <line x1={78 + k * 14} y1={170} x2={78 + k * 14} y2={178} className="rx-pin" />
      </g>)}
      {Array.from({ length: bars }, (_, k) => {
        const h = 18 + 22 * (0.5 + 0.5 * Math.sin(frame.t * 2.2 + k * 1.3));
        return <rect key={k} x={84 + k * 19} y={150 - h} width={12} height={h} rx={2} className="rx-bar" style={{ opacity: 0.4 + 0.6 * fade }} />;
      })}
      <text x={c} y={192} textAnchor="middle" className="rx-wtext">{w.lines[1]}</text>
    </g>;
  } else if (w.kind === "driver") {
    /* Channel pins from the recorded rows only. */
    const rows = x.edges.filter((e) => e.from === w.node);
    const motorRows = rows.map((e) => ({ e, n: x.nodes.find((q) => q.id === e.to), ch: channelsOf(e.detail) }));
    const pins = [...new Set(motorRows.flatMap((r) => r.ch.any))].sort((a, b) => a - b);
    const litPins = new Set<number>();
    if (step.motion === "turn") {
      for (const r of motorRows) {
        if (r.n?.side === "left" && r.ch.back != null) litPins.add(r.ch.back);
        if (r.n?.side === "right" && r.ch.fwd != null) litPins.add(r.ch.fwd);
      }
    } else if (pins.length) {
      litPins.add(pins[Math.floor(frame.t * 3) % pins.length]);
    }
    const cols = Math.min(8, Math.max(1, pins.length));
    inner = <g>
      <rect x={30} y={70} width={180} height={100} rx={8} className="rx-pcb" />
      {pins.length ? pins.map((ch, i) => {
        const px = 48 + (i % cols) * (144 / Math.max(1, cols - 1 || 1));
        const py = 100 + Math.floor(i / cols) * 40;
        const on = litPins.has(ch);
        return <g key={ch}>
          <circle cx={px} cy={py} r={8} className={"rx-chpin" + (on ? " on" : "")} style={on ? { opacity: 0.5 + 0.5 * fade } : undefined} />
          <text x={px} y={py + 22} textAnchor="middle" className="rx-wsmall">ch{ch}</text>
        </g>;
      }) : <text x={c} y={124} textAnchor="middle" className="rx-wtext">channels not recorded</text>}
      {step.motion === "turn"
        ? w.lines.map((l, i) => <text key={i} x={c} y={186 + i * 15} textAnchor="middle" className="rx-wtext">{l}</text>)
        : <text x={c} y={192} textAnchor="middle" className="rx-wtext">one channel at a time</text>}
    </g>;
  } else if (w.kind === "wheel") {
    const st = Object.values(frame.wheel)[0];
    const ang = (st?.phase ?? 0) * 360;
    inner = <g>
      <g transform={`rotate(${ang.toFixed(1)} ${c} ${c - 6})`}>
        <circle cx={c} cy={c - 6} r={62} className="rx-tyre" />
        <circle cx={c} cy={c - 6} r={40} className="rx-rim" />
        {Array.from({ length: 6 }, (_, k) => {
          const a = (k / 6) * Math.PI * 2;
          return <line key={k} x1={c} y1={c - 6} x2={c + Math.cos(a) * 40} y2={c - 6 + Math.sin(a) * 40} className="rx-spoke" />;
        })}
      </g>
      <text x={c} y={192} textAnchor="middle" className="rx-wtext">{w.lines[0]}</text>
    </g>;
  } else if (w.kind === "sensor") {
    const n = x.nodes.find((q) => q.id === w.node);
    if (n?.sensor === "ultrasonic") {
      inner = <g>
        <rect x={60} y={130} width={120} height={40} rx={6} className="rx-pcb" />
        <circle cx={92} cy={150} r={15} className="rx-can" /><circle cx={148} cy={150} r={15} className="rx-can" />
        {[0, 0.5].map((o) => { const ph = (frame.ping + o) % 1; const r = 20 + ph * 70; return <path key={o} d={`M ${c - r * 0.75} ${130 - r * 0.6} A ${r} ${r} 0 0 1 ${c + r * 0.75} ${130 - r * 0.6}`} className="rx-ping" style={{ opacity: (1 - ph) * fade }} />; })}
        <text x={c} y={190} textAnchor="middle" className="rx-wtext">sends a click, times the echo</text>
      </g>;
    } else {
      inner = <g>
        <circle cx={c} cy={c - 6} r={46} className="rx-can" />
        <circle cx={c} cy={c - 6} r={20} className="rx-lensglass" />
        <text x={c} y={192} textAnchor="middle" className="rx-wtext">{w.title}</text>
      </g>;
    }
  } else if (w.kind === "actuator") {
    const a = frame.wobble * 35;
    inner = <g>
      <circle cx={c} cy={140} r={20} className="rx-can" />
      <g transform={`rotate(${(a - 60).toFixed(1)} ${c} 140)`}><rect x={c - 7} y={50} width={14} height={90} rx={6} className="rx-arm" /></g>
      <text x={c} y={192} textAnchor="middle" className="rx-wtext">{w.lines[0]}</text>
    </g>;
  }

  return (
    <svg className="rx-win" viewBox="0 0 240 260" role="img" aria-label={"A look inside: " + w.title}>
      <defs><clipPath id="rx-lensclip"><circle cx={c} cy={c} r={R} /></clipPath></defs>
      <circle cx={c} cy={c} r={R} className="rx-lens" />
      <g clipPath="url(#rx-lensclip)">{inner}</g>
      <circle cx={c} cy={c} r={R} className="rx-lensring" />
      <text x={c} y={252} textAnchor="middle" className="rx-wtitle">{w.title}</text>
    </svg>
  );
}
