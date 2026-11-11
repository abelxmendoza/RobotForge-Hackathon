"use client";
/* Wrench cards for one-part edits (lib/partEdit.ts):
 *  - PartEditCard: a SIZE edit ("make the wheels bigger"). Before and
 *    after in 3D with the part highlighted, the exact field changes,
 *    proof that nothing else in the spec changed, what the new size
 *    breaks or changes, and the Forge checks that are new. Apply
 *    saves a NEW version; nothing changes until then.
 *  - PartLookCard: a LOOK edit ("make the wheels look like knobby
 *    tyres"). Runs one text-to-3D job through the Worker
 *    (lib/partMesh.ts), shows the robot with the generated part
 *    fitted in, and keeps it only on "Keep this look". The spec is
 *    never changed by a look. */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RobotSpec } from "@/components/forge/model";
import type { Spec } from "@/lib/garage";
import { checkPartEdit, describeChanges, fmtMm, type PartEditPlan, type PartLookPlan } from "@/lib/partEdit";
import { fetchPartMeshFile, LOOK_CAPTION, partMeshStatus, startPartMesh, type MeshJob } from "@/lib/partMesh";

const Robot3D = dynamic(() => import("@/components/kit/Robot3D"), {
  ssr: false,
  loading: () => <p className="faint g-small">Loading the 3D view…</p>,
});

function Model({ spec, viewId, looks, label }: { spec: Spec; viewId: string; looks?: Record<string, ArrayBuffer>; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="faint g-small">3D is unavailable in this browser. The numbers below still apply.</p>;
  return (
    <div className="pe-model" aria-label={label}>
      <Robot3D spec={spec as RobotSpec} explode={0} selected={viewId} onSelect={() => {}} onFail={() => setFailed(true)}
        animate={false} autoRotate showComMarker={false} partLooks={looks} viewHeight={190} />
    </div>
  );
}

export interface PartEditRequest {
  robotId: string;
  robotName: string;
  baseVersionId: string;
  before: Spec;
  after: Spec;
  plan: PartEditPlan;
  /* Forge check lines that the new size adds (ERROR/WARN only). */
  newChecks: string[];
  looks?: Record<string, ArrayBuffer>;
}

export function PartEditCard({ req, onApply, onCancel }: { req: PartEditRequest; onApply: () => void; onCancel: () => void }) {
  const once = useRef(false);
  const check = useMemo(() => checkPartEdit(req.before, req.after, req.plan), [req]);
  const blocked = !check.restKept;
  return (
    <section className="vexb pe-card" aria-label={`Change ${req.plan.partLabel} on ${req.robotName}`}>
      <div className="vexb-head"><strong>Change {req.plan.partLabel} on {req.robotName}</strong></div>
      <p className="g-small faint">“{req.plan.phrase}”</p>
      <ul className="g-small">
        {req.plan.changes.map((c) => <li key={c.path}>{c.label}: {fmtMm(c.before)} → <strong>{fmtMm(c.after)}</strong></li>)}
      </ul>
      <p className="g-small">
        <span className={"fbadge " + (check.restKept ? "pe-ok" : "planned")}>{check.restKept ? "Only this part" : "Check"}</span>{" "}
        {check.restKept
          ? `Every other spec field is unchanged (${check.changedPaths.length} field${check.changedPaths.length === 1 ? "" : "s"} change, all of them ${req.plan.partLabel}).`
          : `Something outside ${req.plan.partLabel} would change (${check.changedPaths.join(", ")}), so this can't be applied.`}
      </p>
      {check.problems.map((p) => <p key={p} className="g-small" role="alert"><span className="fbadge planned">Problem</span> {p}</p>)}
      {req.newChecks.map((p) => <p key={p} className="g-small" role="alert"><span className="fbadge planned">New check</span> {p}</p>)}
      <div className="vexb-grid">
        <article className="vexb-card"><span className="eyebrow">Now</span><Model spec={req.before} viewId={req.plan.viewId} looks={req.looks} label={`${req.robotName} now`} /></article>
        <article className="vexb-card"><span className="eyebrow">After</span><Model spec={req.after} viewId={req.plan.viewId} looks={req.looks} label={`${req.robotName} after the change`} /></article>
      </div>
      <ul className="g-small faint">{check.effects.map((e) => <li key={e}>{e}</li>)}</ul>
      <div className="dt-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={blocked}
          onClick={() => { if (once.current) return; once.current = true; onApply(); }}>
          {check.problems.length ? "Apply anyway as a new version" : "Apply as a new version"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      <p className="faint g-small">The 3D models are drawn from the spec’s numbers, not CAD. Apply saves {describeChanges(req.plan)} as a new version; the current one stays in History.</p>
    </section>
  );
}

export interface PartLookRequest {
  robotId: string;
  robotName: string;
  spec: Spec;
  plan: PartLookPlan;
  looks?: Record<string, ArrayBuffer>;
}

type LookState =
  | { step: "starting" }
  | { step: "running"; job: MeshJob }
  | { step: "ready"; job: MeshJob; data: ArrayBuffer }
  | { step: "failed"; message: string };

const POLL_MS = 4000;
const GIVE_UP_MS = 6 * 60 * 1000;

export function PartLookCard({ req, onKeep, onCancel }: {
  req: PartLookRequest;
  onKeep: (data: ArrayBuffer, job: MeshJob) => void;
  onCancel: (why?: string) => void;
}) {
  const [state, setState] = useState<LookState>({ step: "starting" });
  const once = useRef(false);
  useEffect(() => {
    let live = true;
    const started = Date.now();
    (async () => {
      try {
        let job = await startPartMesh(req.plan.viewId, req.plan.description);
        if (!live) return;
        setState({ step: "running", job });
        while (live && job.status !== "SUCCEEDED") {
          if (job.status === "FAILED" || job.status === "CANCELED") throw new Error("The 3D service could not make that part. Try different words.");
          if (Date.now() - started > GIVE_UP_MS) throw new Error("The 3D service is taking too long. Try again later.");
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (!live) return;
          job = await partMeshStatus(job.id);
          if (live) setState({ step: "running", job });
        }
        const data = await fetchPartMeshFile(job.id);
        if (live) setState({ step: "ready", job, data });
      } catch (e) {
        if (live) setState({ step: "failed", message: (e as Error).message });
      }
    })();
    return () => { live = false; };
  }, [req]);

  const looks = useMemo(() => (state.step === "ready" ? { ...(req.looks ?? {}), [req.plan.viewId]: state.data } : req.looks), [state, req]);
  return (
    <section className="vexb pe-card" aria-label={`New look for ${req.plan.partLabel} on ${req.robotName}`}>
      <div className="vexb-head"><strong>New 3D look for {req.plan.partLabel} on {req.robotName}</strong></div>
      <p className="g-small faint">“{req.plan.description}”</p>
      {state.step === "starting" && <p className="g-small" aria-live="polite">Asking the 3D service…</p>}
      {state.step === "running" && (
        <p className="g-small" aria-live="polite">
          Generating {req.plan.partLabel}: {state.job.status === "PENDING" ? "waiting in the queue" : `${state.job.progress}%`}. This usually takes one to three minutes.
          <progress className="pe-progress" max={100} value={state.job.progress} />
        </p>
      )}
      {state.step === "failed" && <p className="g-small" role="alert"><span className="fbadge planned">Not made</span> {state.message} Nothing changed.</p>}
      {state.step === "ready" && (
        <>
          <div className="vexb-grid">
            <article className="vexb-card"><span className="eyebrow">Now</span><Model spec={req.spec} viewId={req.plan.viewId} looks={req.looks} label={`${req.robotName} now`} /></article>
            <article className="vexb-card"><span className="eyebrow">New look</span><Model spec={req.spec} viewId={req.plan.viewId} looks={looks} label={`${req.robotName} with the new look`} /></article>
          </div>
          <p className="faint g-small">{LOOK_CAPTION}</p>
        </>
      )}
      <div className="dt-actions">
        {state.step === "ready" && (
          <button type="button" className="btn btn-primary btn-sm"
            onClick={() => { if (once.current) return; once.current = true; onKeep(state.data, state.job); }}>Keep this look</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancel(state.step === "failed" ? state.message : undefined)}>
          {state.step === "ready" ? "Discard" : state.step === "failed" ? "Close" : "Stop"}
        </button>
      </div>
    </section>
  );
}
