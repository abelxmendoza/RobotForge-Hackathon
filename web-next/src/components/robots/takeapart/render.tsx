import type { KeyboardEvent, ReactNode } from "react";
import {
  CAM_H, CAM_W, LIDAR_DISC_D, PLATE_T, POST_D, ULTRA_CAN_D, ULTRA_H,
  elecBad, elecDepths, elecStage, elecVolts, mm,
  taMotorXY,
  type RobotSpec, type TaPart, type WireNode, type Wiring,
} from "./spec";

/* SVG renderers ported from assets/js/robot.js: the same schematic
   language, palette, explode behaviour and dimension lines — values
   only from the spec. Interactions ride on the same hooks the vanilla
   code wires with addEventListener (click / Enter / Space). */

export interface TaViewState {
  spec: RobotSpec;
  parts: TaPart[];
  pos: [number, number][];
  explodeMm: number;
  elec: boolean;
  power: boolean;
  elecStage: number;
  selected: string | null;
  selNode: string | null;
  selWire: number | null;
  onSelectPart: (id: string) => void;
  onSelectNode: (id: string) => void;
  onSelectWire: (i: number) => void;
  onWireHover: (i: number) => void;
}

function keyActivate(fn: () => void) {
  return (ev: KeyboardEvent) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    fn();
  };
}

function Shape({ view, id, children }: { view: TaViewState; id: string; children: ReactNode }) {
  return (
    <g
      className={`part-shape${view.selected === id ? " sel" : ""}`}
      data-part={id}
      tabIndex={0}
      role="button"
      aria-label={id}
      onClick={() => view.onSelectPart(id)}
      onKeyDown={keyActivate(() => view.onSelectPart(id))}
    >
      {children}
    </g>
  );
}

function Svg({ vb, maxW, children }: { vb: string; maxW: number; children: ReactNode }) {
  return (
    <svg viewBox={vb} width="100%" role="img" style={{ maxWidth: maxW, display: "block" }}>
      {children}
    </svg>
  );
}

/* ---------------- dimension lines ---------------- */
function DimH({ x1, x2, y, text }: { x1: number; x2: number; y: number; text: string }) {
  return (
    <g className="dim">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} />
      <text x={(x1 + x2) / 2} y={y - 5} textAnchor="middle">{text}</text>
    </g>
  );
}
function DimV({ x, yTop, yBot, text, anchor }: {
  x: number; yTop: number; yBot: number; text: string; anchor: "start" | "end";
}) {
  const tx = anchor === "end" ? x - 5 : x + 5;
  return (
    <g className="dim">
      <line x1={x} y1={yTop} x2={x} y2={yBot} />
      <line x1={x - 4} y1={yTop} x2={x + 4} y2={yTop} />
      <line x1={x - 4} y1={yBot} x2={x + 4} y2={yBot} />
      <text x={tx} y={(yTop + yBot) / 2 + 3.5} textAnchor={anchor}>{text}</text>
    </g>
  );
}
function DimVR({ x, yTop, yBot, text }: { x: number; yTop: number; yBot: number; text: string }) {
  const my = (yTop + yBot) / 2;
  return (
    <g className="dim">
      <line x1={x} y1={yTop} x2={x} y2={yBot} />
      <line x1={x - 4} y1={yTop} x2={x + 4} y2={yTop} />
      <line x1={x - 4} y1={yBot} x2={x + 4} y2={yBot} />
      <text transform={`rotate(-90 ${x - 6} ${my})`} x={x - 6} y={my} textAnchor="middle">{text}</text>
    </g>
  );
}
function dimsSide(view: TaViewState, X: (x: number) => number, Z: (z: number) => number, S: number): ReactNode {
  const spec = view.spec;
  const L = spec.length_m, H = spec.height_m, C = spec.ground_clearance_m;
  const D = spec.wheel.diameter_m, r = D / 2;
  const wxF = Math.max(...view.pos.map((p) => p[0]));
  const cx = X(wxF), cy = Z(r), dd = r * S * 0.7071;
  return (
    <>
      <g className="dim">
        <line x1={cx - dd} y1={cy + dd} x2={cx + dd} y2={cy - dd} />
        <text x={cx} y={Z(2 * r) - 6} textAnchor="middle">Ø {mm(D)} mm</text>
      </g>
      <DimV x={X(-L / 2) - 12} yTop={Z(C)} yBot={Z(0)} text={`${mm(C)} mm`} anchor="end" />
      <DimV x={X(L / 2) + 14} yTop={Z(H)} yBot={Z(0)} text={`${mm(H)} mm`} anchor="start" />
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Z(0) + 30} text={`${mm(L)} mm`} />
    </>
  );
}
function dimsTop(view: TaViewState, X: (x: number) => number, Y: (y: number) => number, yMin: number): ReactNode {
  const spec = view.spec;
  const L = spec.length_m, W = spec.width_m, D = spec.wheel.diameter_m;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  const wxF = Math.max(...view.pos.map((p) => p[0]));
  return (
    <>
      <text className="dim-note" x={X(wxF)} y={Y(wy - spec.wheel.width_m / 2) + 16} textAnchor="middle">
        Ø {mm(D)} mm
      </text>
      <DimVR x={X(-L / 2) - 14} yTop={Y(W / 2)} yBot={Y(-W / 2)} text={`${mm(W)} mm`} />
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Y(yMin) + 18} text={`${mm(L)} mm`} />
    </>
  );
}

/* ---------------- electrical overlay ---------------- */
function elecShortLabel(node: WireNode): string {
  return node.label.split(" — ")[0].split(" (")[0];
}
function elecRails(w: Wiring): Record<string, [number, number]> {
  const deck = w.nodes.filter((n) => n.deck);
  const half = Math.ceil(deck.length / 2);
  const pos: Record<string, [number, number]> = {};
  deck.forEach((n, i) => {
    const rail = i < half ? 0 : 1;
    const k = rail ? i - half : i;
    const count = rail ? deck.length - half : half;
    pos[n.id] = [((k + 1) * 700) / (count + 1), rail ? 43 : 15];
  });
  return pos;
}
function elecAnchorsTop(view: TaViewState, X: (x: number) => number, Y: (y: number) => number) {
  const spec = view.spec, w = spec.wiring as Wiring;
  const pos = elecRails(w);
  const lp = view.parts.find((p) => p.id === "lidar");
  const cp = view.parts.find((p) => p.id === "camera");
  const up = view.parts.find((p) => p.id === "ultrasonic");
  w.nodes.forEach((n) => {
    if (pos[n.id]) return;
    if (n.kit === "lidar" && lp) pos[n.id] = [X(lp.x ?? 0), Y(lp.y ?? 0)];
    else if (n.kit === "camera" && cp) pos[n.id] = [X((cp.face ?? 1) * spec.length_m / 2), Y(0)];
    else if (n.kit === "ultrasonic" && up) pos[n.id] = [X((up.face ?? 1) * spec.length_m / 2), Y(0)];
  });
  return pos;
}
function elecAnchorsSide(view: TaViewState, X: (x: number) => number, Z: (z: number) => number) {
  const spec = view.spec, w = spec.wiring as Wiring;
  const pos = elecRails(w);
  const C = spec.ground_clearance_m, H = spec.height_m;
  const deckTop = C + PLATE_T;
  const lp = view.parts.find((p) => p.id === "lidar");
  const cp = view.parts.find((p) => p.id === "camera");
  const up = view.parts.find((p) => p.id === "ultrasonic");
  w.nodes.forEach((n) => {
    if (pos[n.id]) return;
    if (n.kit === "lidar" && lp) pos[n.id] = [X(lp.x ?? 0), Z(H)];
    else if (n.kit === "camera" && cp) pos[n.id] = [X((cp.face ?? 1) * spec.length_m / 2), Z(C + H / 2)];
    else if (n.kit === "ultrasonic" && up) pos[n.id] = [X((up.face ?? 1) * spec.length_m / 2), Z(deckTop + ULTRA_H / 2)];
  });
  return pos;
}
function ElecChip({ view, n, cx, cy, cls, depth }: {
  view: TaViewState; n: WireNode; cx: number; cy: number; cls: string; depth: number;
}) {
  const label = elecShortLabel(n);
  const wpx = Math.min(168, Math.max(label.length * 5.9, n.req_label.length * 5.4) + 16);
  return (
    <g
      className={`node-chip ${cls}`}
      data-node={n.id}
      data-depth={depth === Infinity ? "inf" : depth}
      tabIndex={0}
      role="button"
      aria-label={n.label}
      onClick={() => view.onSelectNode(n.id)}
      onKeyDown={keyActivate(() => view.onSelectNode(n.id))}
    >
      <rect x={cx - wpx / 2} y={cy - 13} width={wpx} height={27} rx={6} />
      <text className="nl" x={cx} y={cy - 1} textAnchor="middle">{label}</text>
      <text className="req" x={cx} y={cy + 10} textAnchor="middle">{n.req_label}</text>
    </g>
  );
}
function ElecOverlay({ view, anchors }: { view: TaViewState; anchors: Record<string, [number, number]> }) {
  const w = view.spec.wiring as Wiring;
  const depth = elecDepths(w), bad = elecBad(w);
  const pairCount: Record<string, number> = {}, pairSeen: Record<string, number> = {};
  w.connections.forEach((c) => {
    const k = [c.from, c.to].sort().join("|");
    pairCount[k] = (pairCount[k] || 0) + 1;
  });
  const wires: ReactNode[] = [], chips: ReactNode[] = [], labels: ReactNode[] = [];
  w.connections.forEach((c, i) => {
    const a = anchors[c.from], b = anchors[c.to];
    if (!a || !b) return;
    const k = [c.from, c.to].sort().join("|");
    const seen = pairSeen[k] || 0; pairSeen[k] = seen + 1;
    const off = (seen - (pairCount[k] - 1) / 2) * 16;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const cx = (a[0] + b[0]) / 2 + (-dy / len) * off;
    const cy = (a[1] + b[1]) / 2 + (dx / len) * off;
    const d = `M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`;
    const mx = 0.25 * a[0] + 0.5 * cx + 0.25 * b[0];
    const my = 0.25 * a[1] + 0.5 * cy + 0.25 * b[1];
    const stage = elecStage(w, depth, i);
    const on = view.power && stage <= view.elecStage;
    const isBad = bad.has(i);
    wires.push(
      <g
        key={`w${i}`}
        className={`wire-g${isBad ? " bad" : ""}${on ? " on" : ""}${view.selWire === i ? " sel" : ""}`}
        data-conn={i}
        data-stage={stage === Infinity ? "inf" : stage}
        tabIndex={0}
        onClick={() => view.onSelectWire(i)}
        onMouseEnter={() => view.onWireHover(i)}
        onKeyDown={keyActivate(() => view.onSelectWire(i))}
      >
        <path className="wire-hit" d={d} />
        <path className={`wire ${c.kind}${isBad ? " bad" : ""}${on ? " on" : ""}`} d={d} />
        {isBad ? (
          <text className="wire-badtag" x={mx} y={my - 8} textAnchor="middle">⚠ over-voltage</text>
        ) : null}
        <text className="wire-label" x={mx} y={my + 15} textAnchor="middle">
          {c.kind + (c.kind === "power" ? " · " + elecVolts(c.volts) : "")}
        </text>
      </g>,
    );
  });
  w.nodes.forEach((n) => {
    const a = anchors[n.id];
    if (!a) return;
    if (n.deck) {
      const on = view.power && depth[n.id] <= view.elecStage;
      const isBad = [...bad].some((i) => w.connections[i].to === n.id);
      chips.push(
        <ElecChip
          key={`c${n.id}`}
          view={view}
          n={n}
          cx={a[0]}
          cy={a[1]}
          cls={(on ? "on" : "") + (isBad ? " bad" : "") + (view.selNode === n.id ? " sel" : "")}
          depth={depth[n.id]}
        />,
      );
    } else {
      labels.push(
        <text key={`l${n.id}`} className="req-label" x={a[0]} y={a[1] - 12} textAnchor="middle">
          {n.req_label}
        </text>,
      );
    }
  });
  return <>{wires}{chips}{labels}</>;
}
function elecOverlayClass(view: TaViewState): ReactNode {
  return view.elec && view.spec.wiring
    ? <ElecOverlay view={view} anchors={elecRails(view.spec.wiring)} />
    : null;
}

/* ---------------- ground views ---------------- */
function GroundSide(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, H = spec.height_m, C = spec.ground_clearance_m;
  const r = spec.wheel.diameter_m / 2, e = view.explodeMm / 1000;
  const deckTop = C + PLATE_T;
  const xs = [...new Set(view.pos.map((p) => p[0]))];
  const xMin = -L / 2 - r - e - 0.03, xMax = L / 2 + r + e + 0.03;
  const zMax = H + e + 0.03;
  const Wpx = 700, Hpx = 330, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S, gy = Hpx - pad;
  const X = (x: number) => ox + x * S, Z = (z: number) => gy - z * S;
  const lp = view.parts.find((p) => p.id === "lidar");
  const cp = view.parts.find((p) => p.id === "camera");
  const up = view.parts.find((p) => p.id === "ultrasonic");
  const mw = Math.max(spec.wheel.width_m, 0.024);
  const casterCx = L / 2 - C;
  return (
    <Svg vb={`0 0 ${Wpx} ${Hpx + 38}`} maxW={700}>
      <line x1={4} y1={Z(0)} x2={Wpx - 4} y2={Z(0)} stroke="#454c59" strokeWidth={2} />
      <text x={8} y={Z(0) + 16} fill="#9aa3ae" fontSize={11}>ground (z = 0)</text>
      <Shape view={view} id="plate">
        <rect x={X(-L / 2)} y={Z(deckTop)} width={L * S} height={PLATE_T * S} rx={3}
          fill="#8a5a17" stroke="#f59e0b" strokeWidth={1.4} />
      </Shape>
      {spec.wheel.count === 2
        ? [-casterCx, casterCx].map((x0) => (
          <Shape key={`c${x0}`} view={view} id="caster">
            <circle cx={X(x0 + Math.sign(x0) * e)} cy={Z(C / 2 - e * 0.25)} r={(C / 2) * S}
              fill="#5b6472" stroke="#9aa3ae" strokeWidth={1.2} />
          </Shape>
        ))
        : null}
      {xs.map((x0) => (
        <Shape key={`m${x0}`} view={view} id="mount">
          <rect x={X(x0 + Math.sign(x0) * e * 0.7 - mw / 2)} y={Z(deckTop)} width={mw * S}
            height={deckTop * S} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ))}
      {xs.map((x0) => {
        const dz = x0 === 0 ? -e * 0.8 : 0;
        return (
          <Shape key={`w${x0}`} view={view} id="wheel">
            <circle cx={X(x0 + Math.sign(x0) * e * 0.7)} cy={Z(r + dz)} r={r * S}
              fill="#22262e" stroke="#e8eaee" strokeWidth={2} />
            <circle cx={X(x0 + Math.sign(x0) * e * 0.7)} cy={Z(r + dz)} r={r * S * 0.32}
              fill="none" stroke="#9aa3ae" strokeWidth={1.4} />
          </Shape>
        );
      })}
      {lp ? (
        <Shape view={view} id="lidar">
          <rect x={X((lp.x ?? 0) - POST_D / 2)} y={Z(H - 0.010 + e)} width={POST_D * S}
            height={(H - 0.010 - deckTop + e) * S} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
          <rect x={X((lp.x ?? 0) - LIDAR_DISC_D / 2)} y={Z(H + e)} width={LIDAR_DISC_D * S}
            height={0.010 * S} rx={3} fill="#22262e" stroke="#e8eaee" strokeWidth={1.6} />
        </Shape>
      ) : null}
      {cp ? (
        <Shape view={view} id="camera">
          <rect x={X((cp.face ?? 1) * (L / 2 + e) + ((cp.face ?? 1) > 0 ? 0 : -PLATE_T))}
            y={Z(C + H / 2 + e * 0.2 + CAM_H / 2)} width={PLATE_T * S} height={CAM_H * S}
            fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {up ? (
        <Shape view={view} id="ultrasonic">
          <rect x={X((up.face ?? 1) * (L / 2 + e) + ((up.face ?? 1) > 0 ? 0 : -PLATE_T))}
            y={Z(deckTop + e * 0.2 + ULTRA_H)} width={PLATE_T * S} height={ULTRA_H * S}
            fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
          <circle cx={X((up.face ?? 1) * (L / 2 + e) + (up.face ?? 1) * PLATE_T)}
            cy={Z(deckTop + e * 0.2 + ULTRA_H / 2)} r={(ULTRA_CAN_D / 2) * S}
            fill="#22262e" stroke="#e8eaee" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {view.elec && spec.wiring
        ? <ElecOverlay view={view} anchors={elecAnchorsSide(view, X, Z)} />
        : null}
      {dimsSide(view, X, Z, S)}
    </Svg>
  );
}
function GroundTop(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, W = spec.width_m, e = view.explodeMm / 1000;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  const xMin = -L / 2 - e - 0.03, xMax = L / 2 + e + 0.03;
  const yMin = -wy - spec.wheel.width_m / 2 - e - 0.03, yMax = -yMin;
  const Wpx = 700, Hpx = 300, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (yMax - yMin));
  const ox = pad - xMin * S, oy = pad - yMin * S;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
  const lp = view.parts.find((p) => p.id === "lidar");
  const cp = view.parts.find((p) => p.id === "camera");
  const up = view.parts.find((p) => p.id === "ultrasonic");
  const casterCx = L / 2 - spec.ground_clearance_m;
  const vbH = Math.max(Hpx, Y(yMin) + 44);
  return (
    <Svg vb={`0 0 ${Wpx} ${vbH}`} maxW={700}>
      <Shape view={view} id="plate">
        <rect x={X(-L / 2)} y={Y(W / 2)} width={L * S} height={W * S} rx={6}
          fill="#8a5a17" stroke="#f59e0b" strokeWidth={1.4} />
      </Shape>
      {spec.wheel.count === 2
        ? [-casterCx, casterCx].map((x0) => (
          <Shape key={`c${x0}`} view={view} id="caster">
            <circle cx={X(x0 + Math.sign(x0) * e * 0.5)} cy={Y(0)}
              r={(spec.ground_clearance_m / 2) * S} fill="#5b6472" stroke="#9aa3ae" strokeWidth={1.2} />
          </Shape>
        ))
        : null}
      {view.pos.map(([x0, y0], i) => (
        <g key={`p${i}`}>
          <Shape view={view} id="mount">
            <rect x={X(x0 - spec.wheel.diameter_m * 0.18)}
              y={Y(Math.sign(y0) * (W / 2 - 0.002))} width={spec.wheel.diameter_m * 0.36 * S}
              height={0.010 * S} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1} />
          </Shape>
          <Shape view={view} id="wheel">
            <rect x={X(x0 - spec.wheel.diameter_m / 2)}
              y={Y(y0 + Math.sign(y0) * e + spec.wheel.width_m / 2)}
              width={spec.wheel.diameter_m * S} height={spec.wheel.width_m * S} rx={4}
              fill="#22262e" stroke="#e8eaee" strokeWidth={1.8} />
          </Shape>
        </g>
      ))}
      {lp ? (
        <Shape view={view} id="lidar">
          <circle cx={X(lp.x ?? 0)} cy={Y(lp.y ?? 0)} r={(LIDAR_DISC_D / 2) * S}
            fill="#22262e" stroke="#e8eaee" strokeWidth={1.6} />
        </Shape>
      ) : null}
      {cp ? (
        <Shape view={view} id="camera">
          <rect x={X((cp.face ?? 1) * (L / 2 + e) + ((cp.face ?? 1) > 0 ? 0 : -PLATE_T))}
            y={Y(CAM_W / 2)} width={PLATE_T * S} height={CAM_W * S}
            fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {up ? (
        <Shape view={view} id="ultrasonic">
          <rect x={X((up.face ?? 1) * (L / 2 + e) + ((up.face ?? 1) > 0 ? 0 : -PLATE_T))}
            y={Y(0.026)} width={PLATE_T * S} height={0.052 * S}
            fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {view.elec && spec.wiring
        ? <ElecOverlay view={view} anchors={elecAnchorsTop(view, X, Y)} />
        : null}
      {dimsTop(view, X, Y, yMin)}
      <text x={Wpx - 8} y={vbH - 6} fill="#9aa3ae" fontSize={11} textAnchor="end">
        front is to the right
      </text>
    </Svg>
  );
}

/* ---------------- class views ---------------- */
function classFrame(xMin: number, xMax: number, zMax: number, Hpx: number) {
  const Wpx = 700, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S, gy = Hpx - pad;
  return { Wpx, Hpx, S, X: (x: number) => ox + x * S, Z: (z: number) => gy - z * S };
}
function GroundLine({ Z, Wpx, label }: { Z: (z: number) => number; Wpx: number; label: string }) {
  return (
    <>
      <line x1={4} y1={Z(0)} x2={Wpx - 4} y2={Z(0)} stroke="#454c59" strokeWidth={2} />
      <text x={8} y={Z(0) + 16} fill="#9aa3ae" fontSize={11}>{label}</text>
    </>
  );
}
function byId(view: TaViewState, id: string): TaPart | undefined {
  return view.parts.find((p) => p.id === id);
}

function AerialSide(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, H = spec.height_m;
  const pd = spec.rotors ? spec.rotors.prop_diameter_m : 0;
  const e = view.explodeMm / 1000, fz = H * 0.55;
  const { Wpx, S, X, Z } = classFrame(-L / 2 - pd / 2 - e - 0.03, L / 2 + pd / 2 + e + 0.03, H + e + 0.05, 300);
  return (
    <Svg vb={`0 0 ${Wpx} 338`} maxW={700}>
      <GroundLine Z={Z} Wpx={Wpx} label="ground (z = 0)" />
      {[-L / 2, L / 2].map((mx) => (
        <line key={mx} x1={X(mx)} y1={Z(fz)} x2={X(mx)} y2={Z(0)}
          stroke="#454c59" strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(0) - (L * 0.38 * S) / 2} y={Z(fz - 0.013 - e * 0.55)} width={L * 0.38 * S}
            height={0.026 * S} rx={3} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "frame") ? (
        <Shape view={view} id="frame">
          <rect x={X(0) - (L * 0.42 * S) / 2} y={Z(fz + 0.009 + e * 0.25)} width={L * 0.42 * S}
            height={0.018 * S} rx={3} fill="#8a5a17" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {[-1, 1].map((sd) => {
        const mx = (sd * L) / 2, ex = sd * e;
        const rx = mx + ex * 0.6, rz = fz + e * 0.7;
        return (
          <g key={sd}>
            {byId(view, "arm") ? (
              <Shape view={view} id="arm">
                <line x1={X(sd * L * 0.2)} y1={Z(fz + e * 0.25)} x2={X(mx + ex * 0.35)}
                  y2={Z(fz + e * 0.25)} stroke="#9aa3ae" strokeWidth={5} />
              </Shape>
            ) : null}
            {byId(view, "rotor") ? (
              <Shape view={view} id="rotor">
                <rect x={X(rx) - (0.011 * S) / 2} y={Z(rz + 0.012)} width={0.011 * S}
                  height={0.016 * S} fill="#22262e" stroke="#e8eaee" strokeWidth={1.2} />
                <line x1={X(rx - pd / 2)} y1={Z(rz + 0.016)} x2={X(rx + pd / 2)}
                  y2={Z(rz + 0.016)} stroke="#e8eaee" strokeWidth={2.4} />
              </Shape>
            ) : null}
          </g>
        );
      })}
      {byId(view, "fc") ? (
        <Shape view={view} id="fc">
          <rect x={X(0) - (0.042 * S) / 2} y={Z(fz + 0.03 + e)} width={0.042 * S}
            height={0.02 * S} rx={2} fill="#22262e" stroke="#34d399" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "camera") ? (
        <Shape view={view} id="camera">
          <rect x={X(L * 0.21 + e * 0.8)} y={Z(fz - 0.02)} width={0.012 * S}
            height={0.02 * S} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Z(0) + 30} text={`${mm(L)} mm motor-to-motor`} />
      <DimV x={X(L / 2 + pd / 2) + 14} yTop={Z(H)} yBot={Z(0)} text={`${mm(H)} mm`} anchor="start" />
      <text className="dim-note" x={X(-L / 2)} y={Z(fz + 0.016) - 8} textAnchor="middle">
        Ø {mm(pd)} mm prop
      </text>
    </Svg>
  );
}
function AerialTop(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, W = spec.width_m;
  const pd = spec.rotors ? spec.rotors.prop_diameter_m : 0;
  const e = view.explodeMm / 1000;
  const ext = Math.max(L, W) / 2 + pd / 2 + e + 0.03;
  const Wpx = 700, Hpx = 320, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (2 * ext), (Hpx - 2 * pad) / (2 * ext));
  const ox = Wpx / 2, oy = Hpx / 2;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
  return (
    <Svg vb={`0 0 ${Wpx} ${Hpx}`} maxW={700}>
      {taMotorXY(spec).map(([mx, my], i) => {
        const ex = Math.sign(mx) * e * 0.6, ey = Math.sign(my) * e * 0.6;
        return (
          <g key={i}>
            {byId(view, "arm") ? (
              <Shape view={view} id="arm">
                <line x1={X(0)} y1={Y(0)} x2={X(mx + ex)} y2={Y(my + ey)}
                  stroke="#9aa3ae" strokeWidth={6} />
              </Shape>
            ) : null}
            {byId(view, "rotor") ? (
              <Shape view={view} id="rotor">
                <circle cx={X(mx + ex)} cy={Y(my + ey)} r={(pd / 2) * S}
                  fill="rgba(232,234,238,0.05)" stroke="#e8eaee" strokeWidth={1.6} />
                <circle cx={X(mx + ex)} cy={Y(my + ey)} r={0.011 * S}
                  fill="#22262e" stroke="#e8eaee" strokeWidth={1.2} />
              </Shape>
            ) : null}
          </g>
        );
      })}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-L * 0.19)} y={Y(W * 0.15 - e * 0.55)} width={L * 0.38 * S}
            height={W * 0.3 * S} rx={4} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "frame") ? (
        <Shape view={view} id="frame">
          <rect x={X(-L * 0.21)} y={Y(W * 0.21 + e * 0.25)} width={L * 0.42 * S}
            height={W * 0.42 * S} rx={6} fill="rgba(138,90,23,0.55)" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "fc") ? (
        <Shape view={view} id="fc">
          <rect x={X(0) - (0.042 * S) / 2} y={Y(e) - (0.042 * S) / 2} width={0.042 * S}
            height={0.042 * S} rx={2} fill="#22262e" stroke="#34d399" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "camera") ? (
        <Shape view={view} id="camera">
          <rect x={X(L * 0.21 + e * 0.8)} y={Y(0) - 0.015 * S} width={0.012 * S}
            height={0.03 * S} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <line x1={X(-L / 2)} y1={Y(-W / 2)} x2={X(L / 2)} y2={Y(W / 2)}
        stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" />
      <text className="dim-note" x={X(0)} y={Y(0) - 8} textAnchor="middle">
        diagonal {mm(Math.hypot(L, W))} mm
      </text>
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Y(-ext) + 20} text={`${mm(L)} mm motor-to-motor`} />
      <DimVR x={X(-ext) - 6} yTop={Y(W / 2)} yBot={Y(-W / 2)} text={`${mm(W)} mm`} />
      <text x={Wpx - 8} y={Hpx - 6} fill="#9aa3ae" fontSize={11} textAnchor="end">
        front is to the right
      </text>
    </Svg>
  );
}

function QuadSide(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, H = spec.height_m;
  const e = view.explodeMm / 1000;
  const { Wpx, S, X, Z } = classFrame(-L / 2 - e - 0.05, L * 0.68 + e + 0.03, H + e + 0.04, 320);
  const legSide = (hx: number, far: boolean): ReactNode => {
    const bend = Math.sign(hx) * L * 0.045;
    const ex = Math.sign(hx) * e * 0.35, ez = -e * 0.1;
    const col = far ? "#454c59" : "#9aa3ae";
    const off = far ? -0.012 : 0;
    const inner = (
      <>
        <line x1={X(hx + off + ex)} y1={Z(H * 0.62 + ez)} x2={X(hx + bend / 2 + off + ex)}
          y2={Z(H * 0.28 + ez)} stroke={col} strokeWidth={7} strokeLinecap="round" />
        <line x1={X(hx + bend / 2 + off + ex)} y1={Z(H * 0.28 + ez)} x2={X(hx + bend + off + ex)}
          y2={Z(0.005 + ez)} stroke={col} strokeWidth={5.5} strokeLinecap="round" />
      </>
    );
    return far ? <g>{inner}</g> : <Shape view={view} id="leg">{inner}</Shape>;
  };
  return (
    <Svg vb={`0 0 ${Wpx} 358`} maxW={700}>
      <GroundLine Z={Z} Wpx={Wpx} label="ground (z = 0)" />
      {byId(view, "leg") ? <>{legSide(-L * 0.36, true)}{legSide(L * 0.36, true)}</> : null}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-L * 0.29)} y={Z(H * 0.875 + e)} width={L * 0.42 * S}
            height={H * 0.15 * S} rx={3} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2}
            strokeDasharray="4 3" />
        </Shape>
      ) : null}
      {byId(view, "body") ? (
        <Shape view={view} id="body">
          <rect x={X(-L * 0.46)} y={Z(H * 0.98 + e * 0.45)} width={L * 0.92 * S}
            height={H * 0.36 * S} rx={8} fill="#51606f" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "leg") ? <>{legSide(-L * 0.36, false)}{legSide(L * 0.36, false)}</> : null}
      {byId(view, "head") ? (
        <Shape view={view} id="head">
          <rect x={X(L * 0.435 + e * 0.85)} y={Z(H * 0.94 + e * 0.25)} width={L * 0.17 * S}
            height={H * 0.2 * S} rx={5} fill="#22262e" stroke="#e8eaee" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Z(0) + 30} text={`${mm(L)} mm`} />
      <DimV x={X(L * 0.68) + 12} yTop={Z(H)} yBot={Z(0)} text={`${mm(H)} mm standing`} anchor="start" />
    </Svg>
  );
}
function QuadTop(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, W = spec.width_m;
  const e = view.explodeMm / 1000;
  const Wpx = 700, Hpx = 300, pad = 14;
  const xMin = -L / 2 - e - 0.04, xMax = L * 0.68 + e + 0.03;
  const yExt = W / 2 + 0.035 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S, oy = Hpx / 2;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
  const legPts: [number, number][] = [
    [L * 0.36, W * 0.44], [L * 0.36, -W * 0.44], [-L * 0.36, W * 0.44], [-L * 0.36, -W * 0.44],
  ].slice(0, spec.legs ? spec.legs.count : 0) as [number, number][];
  return (
    <Svg vb={`0 0 ${Wpx} ${Hpx}`} maxW={700}>
      {byId(view, "leg")
        ? legPts.map(([hx, hy], i) => (
          <Shape key={i} view={view} id="leg">
            <rect x={X(hx + Math.sign(hx) * e * 0.35 - 0.016)}
              y={Y(hy + Math.sign(hy) * (0.013 + e * 0.65))} width={0.032 * S}
              height={0.026 * S} rx={3} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.1} />
          </Shape>
        ))
        : null}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-L * 0.29)} y={Y(W * 0.25 + e)} width={L * 0.42 * S}
            height={W * 0.5 * S} rx={4} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2}
            strokeDasharray="4 3" />
        </Shape>
      ) : null}
      {byId(view, "body") ? (
        <Shape view={view} id="body">
          <rect x={X(-L * 0.46)} y={Y(W * 0.45 + e * 0.45)} width={L * 0.92 * S}
            height={W * 0.9 * S} rx={8} fill="rgba(81,96,111,0.75)" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "head") ? (
        <Shape view={view} id="head">
          <rect x={X(L * 0.435 + e * 0.85)} y={Y(W * 0.26 + e * 0.25)} width={L * 0.17 * S}
            height={W * 0.52 * S} rx={5} fill="#22262e" stroke="#e8eaee" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Y(-yExt) + 20} text={`${mm(L)} mm`} />
      <DimVR x={X(-L / 2) - 16} yTop={Y(W / 2)} yBot={Y(-W / 2)} text={`${mm(W)} mm`} />
      <text x={Wpx - 8} y={Hpx - 6} fill="#9aa3ae" fontSize={11} textAnchor="end">
        front is to the right
      </text>
    </Svg>
  );
}

function HumanoidSide(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, H = spec.height_m;
  const e = view.explodeMm / 1000;
  const xw = L * 0.31 + H * 0.06;
  const { Wpx, S, X, Z } = classFrame(-xw - e - 0.03, xw + e + 0.05, H + e + 0.04, 360);
  const lw = H * 0.042 * S;
  const aw = H * 0.032 * S, ax = L * 0.31 + H * 0.01;
  return (
    <Svg vb={`0 0 ${Wpx} 398`} maxW={700}>
      <GroundLine Z={Z} Wpx={Wpx} label="ground (z = 0)" />
      {byId(view, "leg") ? (
        <Shape view={view} id="leg">
          <rect x={X(0) - lw / 2} y={Z(H * 0.5 - e * 0.05)} width={lw}
            height={H * 0.25 * S} rx={4} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
          <rect x={X(H * 0.008) - lw / 2} y={Z(H * 0.25 - e * 0.05)} width={lw}
            height={H * 0.25 * S} rx={4} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
          <rect x={X(H * 0.032 - H * 0.0575)} y={Z(H * 0.028 - e * 0.05)} width={H * 0.115 * S}
            height={H * 0.028 * S} rx={3} fill="#22262e" stroke="#e8eaee" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "pelvis") ? (
        <Shape view={view} id="pelvis">
          <rect x={X(-H * 0.0475)} y={Z(H * 0.59 + e * 0.1)} width={H * 0.095 * S}
            height={H * 0.09 * S} rx={4} fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-L * 0.3 - H * 0.045 - e * 0.8)} y={Z(H * 0.825 + e * 0.4)} width={H * 0.045 * S}
            height={H * 0.17 * S} rx={3} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "torso") ? (
        <Shape view={view} id="torso">
          <rect x={X(-L * 0.31)} y={Z(H * 0.89 + e * 0.55)} width={L * 0.62 * S}
            height={H * 0.3 * S} rx={6} fill="#51606f" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "arm") ? (
        <Shape view={view} id="arm">
          <rect x={X(ax + e * 0.1)} y={Z(H * 0.87 + e * 0.25)} width={aw}
            height={H * 0.19 * S} rx={4} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
          <rect x={X(ax + H * 0.012 + e * 0.1)} y={Z(H * 0.68 + e * 0.25)} width={aw}
            height={H * 0.17 * S} rx={4} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "head") ? (
        <Shape view={view} id="head">
          <rect x={X(-H * 0.0475)} y={Z(H + e)} width={H * 0.095 * S}
            height={H * 0.115 * S} rx={5} fill="#22262e" stroke="#e8eaee" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimV x={X(xw) + 16} yTop={Z(H)} yBot={Z(0)} text={`${mm(H)} mm tall`} anchor="start" />
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Z(0) + 30} text={`${mm(L)} mm deep`} />
    </Svg>
  );
}
function HumanoidTop(view: TaViewState) {
  const spec = view.spec;
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const e = view.explodeMm / 1000;
  const Wpx = 700, Hpx = 300, pad = 14;
  const xExt = L / 2 + e + 0.04, yExt = W / 2 + H * 0.05 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (2 * xExt), (Hpx - 2 * pad) / (2 * yExt));
  const ox = Wpx / 2, oy = Hpx / 2;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
  return (
    <Svg vb={`0 0 ${Wpx} ${Hpx}`} maxW={700}>
      {byId(view, "arm")
        ? [W / 2 + H * 0.03, -(W / 2 + H * 0.03)].slice(0, spec.arms ? spec.arms.count : 0).map((y0, i) => (
          <Shape key={`a${i}`} view={view} id="arm">
            <rect x={X(-H * 0.019)} y={Y(y0 + Math.sign(y0) * e * 0.8 + H * 0.016)}
              width={H * 0.038 * S} height={H * 0.032 * S} rx={3}
              fill="#51606f" stroke="#9aa3ae" strokeWidth={1.1} />
          </Shape>
        ))
        : null}
      {byId(view, "leg")
        ? [W * 0.22, -W * 0.22].slice(0, spec.legs ? spec.legs.count : 0).map((y0, i) => (
          <Shape key={`l${i}`} view={view} id="leg">
            <rect x={X(-H * 0.025)} y={Y(y0 + Math.sign(y0) * e * 0.55 + H * 0.021)}
              width={H * 0.05 * S} height={H * 0.042 * S} rx={3}
              fill="#3d4656" stroke="#9aa3ae" strokeWidth={1.1} />
          </Shape>
        ))
        : null}
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-L * 0.3 - H * 0.045 - e * 0.8)} y={Y(W * 0.26 + e * 0.4)} width={H * 0.045 * S}
            height={W * 0.52 * S} rx={3} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "torso") ? (
        <Shape view={view} id="torso">
          <rect x={X(-L * 0.31)} y={Y(W * 0.47 + e * 0.55)} width={L * 0.62 * S}
            height={W * 0.94 * S} rx={6} fill="rgba(81,96,111,0.8)" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "pelvis") ? (
        <Shape view={view} id="pelvis">
          <rect x={X(-H * 0.0475)} y={Y(W * 0.41 + e * 0.1)} width={H * 0.095 * S}
            height={W * 0.82 * S} rx={4} fill="none" stroke="#9aa3ae" strokeWidth={1}
            strokeDasharray="4 3" />
        </Shape>
      ) : null}
      {byId(view, "head") ? (
        <Shape view={view} id="head">
          <circle cx={X(0)} cy={Y(e)} r={H * 0.05 * S}
            fill="#22262e" stroke="#e8eaee" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(-L / 2)} x2={X(L / 2)} y={Y(-yExt) + 20} text={`${mm(L)} mm deep`} />
      <DimVR x={X(-xExt) - 6} yTop={Y(W / 2)} yBot={Y(-W / 2)} text={`${mm(W)} mm wide`} />
      <text x={Wpx - 8} y={Hpx - 6} fill="#9aa3ae" fontSize={11} textAnchor="end">
        front is to the right
      </text>
    </Svg>
  );
}

function ArmSide(view: TaViewState) {
  const spec = view.spec;
  const R = spec.length_m, H = spec.height_m;
  const e = view.explodeMm / 1000;
  const { Wpx, S, X, Z } = classFrame(-R * 0.5 - e - 0.03, R + e + 0.04, H + e + 0.04, 320);
  const pts: [number, number][] = [[0, 0.03], [0, H * 0.45], [R * 0.52, H * 0.47], [R * 0.79, H * 0.4]];
  const segs = Math.min(spec.arms ? spec.arms.segments : 0, 3);
  return (
    <Svg vb={`0 0 ${Wpx} 358`} maxW={700}>
      <GroundLine Z={Z} Wpx={Wpx} label="table (z = 0)" />
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-R * 0.34 - 0.0475 - e * 0.5)} y={Z(0.032 - e * 0.6)} width={0.095 * S}
            height={0.032 * S} rx={3} fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "base") ? (
        <Shape view={view} id="base">
          <rect x={X(-0.05)} y={Z(0.03)} width={0.1 * S} height={0.03 * S} rx={3}
            fill="#8a5a17" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "link")
        ? Array.from({ length: segs }, (_, i) => {
          const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
          const ex = e * 0.25 * (i + 1), ez = e * 0.3 * (i + 1);
          return (
            <Shape key={i} view={view} id="link">
              <line x1={X(x1 + ex)} y1={Z(z1 + ez)} x2={X(x2 + ex)} y2={Z(z2 + ez)}
                stroke="#9aa3ae" strokeWidth={8} strokeLinecap="round" />
            </Shape>
          );
        })
        : null}
      {byId(view, "gripper") ? (
        <Shape view={view} id="gripper">
          <line x1={X(R * 0.83 + e * 0.9)} y1={Z(H * 0.4 + spec.width_m / 2 + e * 0.1)}
            x2={X(R * 0.83 + e * 0.9 + 0.045)} y2={Z(H * 0.4 + spec.width_m / 2 + e * 0.1)}
            stroke="#e8eaee" strokeWidth={4} />
          <line x1={X(R * 0.83 + e * 0.9)} y1={Z(H * 0.4 - spec.width_m / 2 + e * 0.1)}
            x2={X(R * 0.83 + e * 0.9 + 0.045)} y2={Z(H * 0.4 - spec.width_m / 2 + e * 0.1)}
            stroke="#e8eaee" strokeWidth={4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(0)} x2={X(R)} y={Z(0) + 30} text={`reach ${mm(R)} mm`} />
      <DimV x={X(R) + 14} yTop={Z(H)} yBot={Z(0)} text={`${mm(H)} mm`} anchor="start" />
    </Svg>
  );
}
function ArmTop(view: TaViewState) {
  const spec = view.spec;
  const R = spec.length_m;
  const e = view.explodeMm / 1000;
  const Wpx = 700, Hpx = 280, pad = 14;
  const xMin = -R * 0.5 - e - 0.03, xMax = R + e + 0.04;
  const yExt = R * 0.42 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S, oy = Hpx / 2;
  const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
  return (
    <Svg vb={`0 0 ${Wpx} ${Hpx}`} maxW={700}>
      {byId(view, "battery") ? (
        <Shape view={view} id="battery">
          <rect x={X(-R * 0.34 - 0.0475 - e * 0.5)} y={Y(-R * 0.34 + 0.0275 - e * 0.6)}
            width={0.095 * S} height={0.055 * S} rx={3}
            fill="#51606f" stroke="#9aa3ae" strokeWidth={1.2} />
        </Shape>
      ) : null}
      {byId(view, "link") ? (
        <Shape view={view} id="link">
          <line x1={X(0)} y1={Y(0)} x2={X(R * 0.79 + e * 0.75)} y2={Y(0)}
            stroke="#9aa3ae" strokeWidth={8} strokeLinecap="round" />
        </Shape>
      ) : null}
      {byId(view, "base") ? (
        <Shape view={view} id="base">
          <circle cx={X(0)} cy={Y(0)} r={Math.min(0.06, R * 0.16) * S}
            fill="#8a5a17" stroke="#f59e0b" strokeWidth={1.4} />
        </Shape>
      ) : null}
      {byId(view, "gripper") ? (
        <Shape view={view} id="gripper">
          <line x1={X(R * 0.83 + e * 0.9)} y1={Y(spec.width_m / 2)}
            x2={X(R * 0.83 + e * 0.9 + 0.045)} y2={Y(spec.width_m / 2)}
            stroke="#e8eaee" strokeWidth={4} />
          <line x1={X(R * 0.83 + e * 0.9)} y1={Y(-spec.width_m / 2)}
            x2={X(R * 0.83 + e * 0.9 + 0.045)} y2={Y(-spec.width_m / 2)}
            stroke="#e8eaee" strokeWidth={4} />
        </Shape>
      ) : null}
      {elecOverlayClass(view)}
      <DimH x1={X(0)} x2={X(R)} y={Y(-yExt) + 20} text={`reach ${mm(R)} mm`} />
      <text x={Wpx - 8} y={Hpx - 6} fill="#9aa3ae" fontSize={11} textAnchor="end">
        the arm reaches to the right
      </text>
    </Svg>
  );
}

/* ---------------- dispatch (taRender) ---------------- */
export function renderSide(view: TaViewState, cls: string): ReactNode {
  if (cls === "aerial") return AerialSide(view);
  if (cls === "quadruped") return QuadSide(view);
  if (cls === "humanoid") return HumanoidSide(view);
  if (cls === "arm") return ArmSide(view);
  return GroundSide(view);
}
export function renderTop(view: TaViewState, cls: string): ReactNode {
  if (cls === "aerial") return AerialTop(view);
  if (cls === "quadruped") return QuadTop(view);
  if (cls === "humanoid") return HumanoidTop(view);
  if (cls === "arm") return ArmTop(view);
  return GroundTop(view);
}
