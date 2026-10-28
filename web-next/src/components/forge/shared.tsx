'use client';
/* Render helpers shared by the Forge stages — the React equivalents
 * of assets/js/common.js (verdict, meter, specTable, rawJSON,
 * findings, drawTraj, codeBlock) and forge.js's docSpecTable. Markup
 * and class names mirror the vanilla output exactly; React escapes
 * text the way common.js's esc() did. */
import { useEffect, useRef, useState } from 'react';
import { mm, ROOT } from './model';
import type { GateCheck, PartialSpec, RobotSpec } from './model';

/* ---------- verdicts + meters (locked thresholds: pass <= 5, fail > 10) ---------- */
export const VCLS: Record<string, string> = {
  PASS: 'pass',
  MARGINAL: 'marginal',
  FAIL: 'fail',
  NOT_GATED: 'norun',
};
export const VLABEL: Record<string, string> = {
  PASS: 'Pass',
  MARGINAL: 'Marginal',
  FAIL: 'Fail',
  NOT_GATED: 'Not gated',
};

export function Verdict({
  status,
  extra,
}: {
  status: string;
  extra?: string;
}) {
  return (
    <span className={'verdict ' + (VCLS[status] || '') + (extra ? ' ' + extra : '')}>
      {VLABEL[status] || status}
    </span>
  );
}

const CHECK_LABEL: Record<string, string> = {
  drive_distance: 'Drive vs ground truth',
  turn_heading: 'Turn vs ground truth',
  odometry_distance: 'Odometry distance vs truth',
  odometry_heading: 'Odometry heading vs truth',
};

export function Meter({ check }: { check: GateCheck }) {
  const max = 15;
  const pct = (v: number) => Math.min(100, (Math.abs(v) / max) * 100);
  const unit = check.unit === 'deg' ? '°' : check.unit;
  return (
    <div className="metric">
      <div className="metric-top">
        <span className="metric-label">
          {CHECK_LABEL[check.name] || check.name}
        </span>
        <Verdict status={check.verdict} />
      </div>
      <div className="metric-value">
        {Number(check.error).toFixed(3)}
        <small>{unit}</small>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={
          Number(check.error).toFixed(2) +
          unit +
          ' against pass 5' +
          unit +
          ' and fail 10' +
          unit
        }
      >
        <span className="z-pass" style={{ width: pct(5) + '%' }} />
        <span
          className="z-marg"
          style={{ left: pct(5) + '%', width: pct(10) - pct(5) + '%' }}
        />
        <span
          className={'fill ' + (VCLS[check.verdict] || '')}
          style={{ width: pct(check.error).toFixed(1) + '%' }}
        />
      </div>
      <div className="meter-scale">
        <span>0</span>
        <span>pass ≤5{unit}</span>
        <span>fail &gt;10{unit}</span>
        <span>15</span>
      </div>
    </div>
  );
}

/* ---------- spec as a plain-words table ---------- */
export function SpecTable({ spec }: { spec: RobotSpec }) {
  const rows: [string, string][] = [
    ['Drivetrain', spec.drivetrain],
    [
      'Size (L × W × H)',
      mm(spec.length_m) +
        ' × ' +
        mm(spec.width_m) +
        ' × ' +
        mm(spec.height_m) +
        ' mm',
    ],
    ['Mass', spec.mass_kg + ' kg'],
    ['Ground clearance', mm(spec.ground_clearance_m ?? 0) + ' mm'],
    [
      'Wheels',
      spec.wheel
        ? spec.wheel.count +
          ' × ' +
          mm(spec.wheel.diameter_m) +
          ' mm, ' +
          mm(spec.wheel.width_m) +
          ' mm wide' +
          (spec.wheel.driven ? ', driven' : '')
        : '',
    ],
    [
      'Motors',
      spec.motor.count +
        ' × ' +
        (spec.motor.kind || '').replace(/_/g, ' ') +
        ', ' +
        spec.motor.voltage_v +
        ' V' +
        (spec.motor.stall_torque_nm != null
          ? ', stall ' + spec.motor.stall_torque_nm + ' N·m'
          : ''),
    ],
    [
      'Battery',
      (spec.battery.chemistry || '') +
        ' ' +
        spec.battery.voltage_v +
        ' V, ' +
        spec.battery.capacity_mah +
        ' mAh',
    ],
    [
      'Sensors',
      (spec.sensors || [])
        .map((s) => s.kind.replace(/_/g, ' ') + ' (' + s.position + ')')
        .join(', ') || 'none',
    ],
  ];
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Plain-words table for a possibly PARTIAL spec (document drafts
 * may carry only what the document printed): lists what is present
 * and nothing else. SpecTable assumes completeness. */
export function DocSpecTable({ spec }: { spec: PartialSpec }) {
  const rows: [string, string][] = [];
  const has = (k: string) => spec[k] !== undefined && spec[k] !== null;
  if (has('name')) rows.push(['Name', String(spec.name)]);
  if (has('drivetrain')) rows.push(['Drivetrain', String(spec.drivetrain)]);
  const dims: string[] = [];
  if (has('length_m')) dims.push('L ' + mm(spec.length_m as number) + ' mm');
  if (has('width_m')) dims.push('W ' + mm(spec.width_m as number) + ' mm');
  if (has('height_m')) dims.push('H ' + mm(spec.height_m as number) + ' mm');
  if (dims.length) rows.push(['Size', dims.join(' × ')]);
  if (has('mass_kg')) rows.push(['Mass', spec.mass_kg + ' kg']);
  if (has('ground_clearance_m')) {
    rows.push(['Ground clearance', mm(spec.ground_clearance_m as number) + ' mm']);
  }
  if (spec.wheel && typeof spec.wheel === 'object') {
    const w = spec.wheel;
    const bits: string[] = [];
    if (w.count != null) bits.push(w.count + ' ×');
    if (w.diameter_m != null) bits.push(mm(w.diameter_m) + ' mm');
    if (w.width_m != null) bits.push(mm(w.width_m) + ' mm wide');
    if (bits.length) rows.push(['Wheels', bits.join(' ')]);
  }
  if (spec.motor && typeof spec.motor === 'object') {
    const m = spec.motor;
    const bits: string[] = [];
    if (m.count != null) bits.push(m.count + ' ×');
    if (m.kind) bits.push(String(m.kind).replace(/_/g, ' '));
    if (m.voltage_v != null) bits.push(m.voltage_v + ' V');
    if (bits.length) rows.push(['Motors', bits.join(' ')]);
  }
  if (spec.battery && typeof spec.battery === 'object') {
    const b = spec.battery;
    const bits: string[] = [];
    if (b.chemistry) bits.push(b.chemistry);
    if (b.voltage_v != null) bits.push(b.voltage_v + ' V');
    if (b.capacity_mah != null) bits.push(b.capacity_mah + ' mAh');
    if (bits.length) rows.push(['Battery', bits.join(' ')]);
  }
  if (Array.isArray(spec.sensors) && spec.sensors.length) {
    rows.push([
      'Sensors',
      spec.sensors
        .map(
          (s) =>
            String(s.kind).replace(/_/g, ' ') + ' (' + s.position + ')',
        )
        .join(', '),
    ]);
  }
  if (!rows.length) {
    return <p className="intro">The draft carries no spec fields.</p>;
  }
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RawJSON({ obj, label }: { obj: unknown; label?: string }) {
  return (
    <details className="raw">
      <summary>{label || 'Raw JSON'}</summary>
      <pre>{JSON.stringify(obj, null, 2)}</pre>
    </details>
  );
}

/* ---------- validator findings ([SEVERITY] check: message) ---------- */
export function Findings({ lines }: { lines: string[] }) {
  return (
    <ul className="findings">
      {lines.map((l, i) => {
        const m = /^\[(\w+)\]\s+([^:]+):\s*(.*)$/.exec(l);
        if (!m) {
          return (
            <li className="finding" key={i}>
              <span />
              <span className="msg">{l}</span>
            </li>
          );
        }
        return (
          <li className="finding" key={i}>
            <span className={'sev ' + m[1].toLowerCase()}>{m[1]}</span>
            <span className="check">{m[2]}</span>
            <span className="msg">{m[3]}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- copyable command block ---------- */
export function CodeBlock({ text }: { text: string }) {
  const [label, setLabel] = useState('Copy');
  return (
    <div className="codeblock">
      <pre>
        <code>{text}</code>
      </pre>
      <button
        className="btn btn-sm copy"
        type="button"
        onClick={() => {
          const done = () => {
            setLabel('Copied');
            setTimeout(() => setLabel('Copy'), 1500);
          };
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(done, () =>
              setLabel('Select & copy'),
            );
          } else {
            setLabel('Select & copy');
          }
        }}
      >
        {label}
      </button>
    </div>
  );
}

/* ---------- ground-truth trajectory (common.js drawTraj) ---------- */
export function TrajCanvas({ pts }: { pts?: [number, number][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 480;
    const H = 240;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.font = '12px ui-monospace, Menlo, monospace';
    if (!pts || !pts.length) {
      ctx.fillStyle = '#9aa3ae';
      ctx.fillText('no trajectory recorded', 12, 20);
      return;
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minx = Math.min(...xs, 0);
    const maxx = Math.max(...xs, 0.2);
    const miny = Math.min(...ys, -0.2);
    const maxy = Math.max(...ys, 0.2);
    const pad = 22;
    const sc = Math.min(
      (W - 2 * pad) / (maxx - minx || 1),
      (H - 2 * pad) / (maxy - miny || 1),
    );
    const X = (x: number) => pad + (x - minx) * sc;
    const Y = (y: number) => H - pad - (y - miny) * sc;
    ctx.strokeStyle = '#2a2f38';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(minx), Y(0));
    ctx.lineTo(X(maxx), Y(0));
    ctx.stroke();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) =>
      i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])),
    );
    ctx.stroke();
    ctx.fillStyle = '#eceef2';
    ctx.beginPath();
    ctx.arc(X(pts[0][0]), Y(pts[0][1]), 4, 0, 7);
    ctx.fill();
    const last = pts[pts.length - 1];
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(X(last[0]), Y(last[1]), 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#6f7884';
    ctx.fillText('ground-truth path, metres', 10, 16);
  }, [pts]);
  return <canvas className="traj" ref={ref} />;
}

export { ROOT };
