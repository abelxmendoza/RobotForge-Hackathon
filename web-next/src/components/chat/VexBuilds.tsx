"use client";
/* Wrench cards for VEX V5 builds (lib/vexBuilds.ts):
 *  - VexBuildsCard: 1–3 suggested builds side by side, each with its
 *    drive numbers and "Add to Workshop". Word edits ("make #2 faster")
 *    replace a build in place before anything is saved.
 *  - VexEditCard: a word edit to the VEX robot open in the Workshop,
 *    shown as changes + before/after numbers. Apply saves a NEW
 *    version; nothing changes until then.
 * Numbers come from lib/drivetrain.ts, the same math as the Drive
 * train tab. */
import { useRef } from "react";
import { driveNumbers, v5rcBudget } from "@/lib/drivetrain";
import type { VexBuild } from "@/lib/vexBuilds";
import type { Spec } from "@/lib/garage";

const f = (v: number | null, d: number, u: string) => (v == null ? "—" : `${Number(v.toFixed(d))} ${u}`);

function Numbers({ spec }: { spec: Spec }) {
  const n = driveNumbers(spec);
  const b = v5rcBudget(spec);
  return (
    <dl className="vexb-nums">
      <div><dt>Top speed</dt><dd>{f(n.freeSpeedMps, 2, "m/s")}</dd></div>
      <div><dt>Wheel speed</dt><dd>{f(n.wheelRpm, 0, "rpm")}</dd></div>
      <div><dt title="Most push the motors can give, and where the wheels start to slip">Push: motors / grip</dt><dd>{n.stallPushN == null ? "—" : Math.round(n.stallPushN)} / {f(n.tractionPushN, 0, "N")}</dd></div>
      {b && <div><dt>Motor power</dt><dd>{b.driveW} of {b.capW} W</dd></div>}
    </dl>
  );
}

export function VexBuildsCard({ builds, onAdd, onClose }: { builds: VexBuild[]; onAdd: (b: VexBuild, index: number) => void; onClose: () => void }) {
  return (
    <section className="vexb" aria-label="Suggested VEX builds">
      <div className="vexb-head"><strong>VEX V5 build ideas</strong><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>
      <div className="vexb-grid">
        {builds.map((b, i) => (
          <article key={b.id + i} className="vexb-card">
            <span className="eyebrow">#{i + 1}</span>
            <h4>{b.spec.name}</h4>
            <p className="g-small">{b.why}</p>
            <p className="faint g-small">{b.spec.motor.count} motors · {b.spec.wheel.count} × {Math.round(b.spec.wheel.diameter_m / 0.0254 * 100) / 100} in {b.spec.drivetrain === "mecanum" ? "mecanum" : b.spec.wheel.kind ?? "omni"} · {b.spec.gearing.driving_teeth === b.spec.gearing.driven_teeth ? "direct drive" : `${b.spec.gearing.driving_teeth}:${b.spec.gearing.driven_teeth}`} · {b.spec.gearing.motor_free_rpm} rpm cartridge</p>
            <Numbers spec={b.spec} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onAdd(b, i)}>Add #{i + 1} to Workshop</button>
          </article>
        ))}
      </div>
      <p className="faint g-small">Change one with words, like “make #2 faster”, “give #1 six motors” or “switch #3 to mecanum”. Motor numbers are VEX’s ratings; masses and sizes are typical values, not measurements.</p>
    </section>
  );
}

export interface VexEditPlan { robotId: string; robotName: string; baseVersionId: string; phrase: string; before: Spec; after: Spec; changes: string[]; problems: string[] }

export function VexEditCard({ plan, onApply, onCancel }: { plan: VexEditPlan; onApply: () => void; onCancel: () => void }) {
  const once = useRef(false);
  return (
    <section className="vexb" aria-label={`Change ${plan.robotName}`}>
      <div className="vexb-head"><strong>Change {plan.robotName}: “{plan.phrase}”</strong></div>
      {plan.changes.length ? <ul className="g-small">{plan.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="g-small">Nothing would change.</p>}
      {plan.problems.map((p) => <p key={p} className="g-small" role="alert"><span className="fbadge planned">Check</span> {p}</p>)}
      <div className="vexb-grid">
        <article className="vexb-card"><span className="eyebrow">Now</span><Numbers spec={plan.before} /></article>
        <article className="vexb-card"><span className="eyebrow">After</span><Numbers spec={plan.after} /></article>
      </div>
      <div className="dt-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!plan.changes.length} onClick={() => { if (once.current) return; once.current = true; onApply(); }}>Apply as a new version</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
