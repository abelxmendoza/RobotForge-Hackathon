"use client";

import { useState } from "react";
import { physicsOf } from "@/lib/data";
import { massAudit } from "@/lib/physicsMath";
import { runPhysicsChecks, type PhysicsResult } from "@/lib/physicsEngine";

/* In-browser physics checks for one Robodex entry, on the entry's
 * official URDF (catalog/physics.json). The model loads from its
 * pinned upstream commit when — and only when — the visitor asks;
 * the checks then run locally in Rapier. A check is a computation
 * on the model, never a gate verdict, and the section keeps the
 * vocabulary separate on purpose ("stands / settles tilted /
 * topples" for the drop, margins for the statics — no PASS/FAIL).
 * Entries whose recorded model is not a plain URDF show the reason
 * instead of a button. */

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: PhysicsResult };

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

function SupportDiagram({ result }: { result: PhysicsResult }) {
  const st = result.stability;
  if (!st || st.hull.length < 2) return null;
  const pts: [number, number][] = [
    ...st.hull,
    ...st.contacts,
    [result.com[0], result.com[1]],
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 300, H = 210, PAD = 18;
  const scale = Math.min(
    (W - 2 * PAD) / Math.max(maxX - minX, 1e-6),
    (H - 2 * PAD) / Math.max(maxY - minY, 1e-6),
  );
  const px = (x: number) => PAD + (x - minX) * scale;
  const py = (y: number) => H - PAD - (y - minY) * scale;
  const hullPath = st.hull.map((p) => `${px(p[0])},${py(p[1])}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Top view: support polygon, ground contacts and centre of mass"
      style={{ maxWidth: W, width: "100%", height: "auto", display: "block" }}
    >
      {st.hull.length >= 3 ? (
        <polygon
          points={hullPath}
          fill="var(--surface-3)"
          stroke="var(--text)"
          strokeWidth="1.5"
        />
      ) : (
        <polyline points={hullPath} fill="none" stroke="var(--text)" strokeWidth="1.5" />
      )}
      {st.contacts.map((c, i) => (
        <circle key={i} cx={px(c[0])} cy={py(c[1])} r="3" fill="var(--accent)" />
      ))}
      <circle
        cx={px(result.com[0])}
        cy={py(result.com[1])}
        r="6"
        fill="none"
        stroke={st.inside ? "var(--pass)" : "var(--fail)"}
        strokeWidth="2.5"
      />
      <circle cx={px(result.com[0])} cy={py(result.com[1])} r="1.8" fill={st.inside ? "var(--pass)" : "var(--fail)"} />
    </svg>
  );
}

function Results({ result, catalogMassKg, catalogMassLabel }: {
  result: PhysicsResult;
  catalogMassKg: number | null;
  catalogMassLabel?: string;
}) {
  const audit = massAudit(result.totalMassKg, catalogMassKg);
  const st = result.stability;
  const se = result.settle;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="card">
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Mass audit</h3>
          <span className="fbadge local">LOCAL</span>
        </div>
        <p style={{ marginTop: 8 }}>
          The model&apos;s links sum to <strong>{fmt(result.totalMassKg)} kg</strong>.
          {audit ? (
            <>
              {" "}The catalogue states <strong>{catalogMassKg} kg</strong> —{" "}
              {catalogMassLabel}. The model is{" "}
              <strong>
                {audit.deltaPct >= 0 ? "+" : ""}
                {audit.deltaPct.toFixed(1)}%
              </strong>{" "}
              against that figure, which{" "}
              {audit.agrees
                ? "agrees within the ±5% band this audit uses."
                : "falls OUTSIDE the ±5% band this audit uses — the two sources genuinely differ, and both numbers stay on the record."}
            </>
          ) : (
            <> {catalogMassLabel}</>
          )}
        </p>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr><th>Link (heaviest first)</th><th>Mass from the URDF</th></tr>
            </thead>
            <tbody>
              {result.links.slice(0, 10).map((l) => (
                <tr key={l.name}>
                  <td><code>{l.name}</code></td>
                  <td className="num">{l.massKg < 0.01 ? `${(l.massKg * 1000).toFixed(1)} g` : `${fmt(l.massKg)} kg`}</td>
                </tr>
              ))}
              {result.links.length > 10 ? (
                <tr>
                  <td className="faint">… and {result.links.length - 10} more links</td>
                  <td className="num faint">
                    {fmt(result.links.slice(10).reduce((s, l) => s + l.massKg, 0))} kg together
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Static stability</h3>
          <span className="fbadge local">LOCAL</span>
        </div>
        {st ? (
          <>
            <p style={{ marginTop: 8 }}>
              Centre of mass at ({fmt(result.com[0])}, {fmt(result.com[1])},{" "}
              {fmt(result.com[2])}) m in the model&apos;s frame. Its ground
              projection lands{" "}
              {st.inside ? (
                <>
                  <strong>inside</strong> the support polygon,{" "}
                  <strong>{fmt(Math.abs(st.marginM) * 1000, 0)} mm</strong> from
                  the nearest edge
                  {st.tipAngleDeg !== null ? (
                    <> — a static tip-over angle of <strong>{st.tipAngleDeg.toFixed(1)}°</strong> about that edge</>
                  ) : null}
                  .
                </>
              ) : (
                <>
                  <strong>outside</strong> the support polygon,{" "}
                  <strong>{fmt(Math.abs(st.marginM) * 1000, 0)} mm</strong> past
                  the nearest edge: at rest, unbolted and unaided, this pose
                  cannot stand.
                </>
              )}
            </p>
            <SupportDiagram result={result} />
            <p className="prov">
              <span>
                Top view: the polygon is the convex hull of the model&apos;s
                ground contacts (blue dots); the ring is the centre of
                mass projected straight down.
              </span>
            </p>
          </>
        ) : (
          <p className="state-box" style={{ marginTop: 8 }}>
            No contact geometry could be read from the model, so there is
            no support polygon to measure against.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Settle test</h3>
          <span className="fbadge local">LOCAL</span>
        </div>
        {se ? (
          <p style={{ marginTop: 8 }}>
            Dropped {(se.dropM * 1000).toFixed(0)} mm onto a flat floor and
            simulated for {se.seconds.toFixed(0)} s, the model{" "}
            {se.verdict === "stands" ? (
              <>
                <strong>stands</strong>: it ends {se.tiltDeg.toFixed(1)}° off
                upright, having drifted {(se.displacementM * 1000).toFixed(0)} mm
                sideways, and comes to rest at its stance height (body
                origin at {fmt(se.finalZM)} m against {fmt(se.restZM)} m
                expected).
              </>
            ) : se.verdict === "settles-tilted" ? (
              <>
                <strong>settles tilted</strong>: it tips and comes to rest
                leaning at {se.tiltDeg.toFixed(1)}°, having drifted{" "}
                {(se.displacementM * 1000).toFixed(0)} mm sideways.
              </>
            ) : (
              <>
                <strong>topples</strong>: it ends {se.tiltDeg.toFixed(1)}° off
                upright — over, not standing.
              </>
            )}
          </p>
        ) : (
          <p className="state-box" style={{ marginTop: 8 }}>
            The settle test did not run: {result.settleUnavailable ?? "no collision geometry"}.
          </p>
        )}
        <p className="prov" style={{ marginTop: 8 }}>
          <span>
            How to read these: the model is one rigid body with its joints
            locked at the URDF&apos;s zero pose, dropped flat. That judges
            the resting stance of the model as published — not walking,
            not balance control, not the physical robot. Colliders:{" "}
            {result.shapesUsed} used
            {result.shapesMeshApprox
              ? `, ${result.shapesMeshApprox} of them bounding boxes of the model's collision meshes`
              : ""}
            {result.shapesSkipped
              ? `, ${result.shapesSkipped} skipped as unreadable`
              : ""}
            {result.massOnlyLinks
              ? `; ${result.massOnlyLinks} link(s) carry mass with no collision shape, counted as point masses at their centres`
              : ""}
            . Ground friction 1.0, body friction 0.9, gravity 9.81 m/s²,
            Rapier at 60 Hz.
          </span>
        </p>
      </div>
    </div>
  );
}

export default function PhysicsSection({ slug, robotName }: { slug: string; robotName: string }) {
  const entry = physicsOf(slug);
  const [state, setState] = useState<RunState>({ kind: "idle" });
  if (!entry) return null;

  const run = async () => {
    setState({ kind: "running" });
    try {
      const result = await runPhysicsChecks(entry);
      setState({ kind: "done", result });
    } catch (e) {
      setState({
        kind: "error",
        message:
          `The checks could not run: ${(e as Error).message}. ` +
          "The model loads from its upstream repository at run time, so this is usually a network problem — nothing was computed and nothing is shown in its place.",
      });
    }
  };

  return (
    <section className="section" id="physics">
      <h2>Physics checks</h2>
      <p className="sub">
        Three computations on this robot&apos;s own model, run in your
        browser when you ask: a mass audit (the URDF&apos;s link masses
        against the catalogue&apos;s stated figure), a static stability
        check (centre of mass against the support polygon), and a settle
        test (the model dropped 30 mm in the Rapier physics engine,
        joints locked at the model&apos;s zero pose). These are checks on
        the model as published — computations, not gate verdicts, and
        not measurements of a physical robot.
      </p>
      {entry.status === "none" ? (
        <div className="card">
          <p className="state-box">{entry.reason}</p>
        </div>
      ) : (
        <>
          <p className="prov">
            <span>
              <strong>Model:</strong> {entry.source_label} · licence{" "}
              {entry.license}. The file loads from that address at run
              time; it is not re-hosted here.
            </span>
          </p>
          {entry.model_note ? (
            <div className="callout" style={{ margin: "12px 0" }}>
              <span>{entry.model_note}</span>
            </div>
          ) : null}
          {state.kind === "idle" || state.kind === "error" ? (
            <>
              <button type="button" className="primary" onClick={run}>
                Run the physics checks for {robotName}
              </button>
              {state.kind === "error" ? (
                <p className="state-box" style={{ marginTop: 12 }}>{state.message}</p>
              ) : null}
            </>
          ) : null}
          {state.kind === "running" ? (
            <p className="state-box">
              Loading the model and running the checks in this browser…
              (A mesh-collision model can take a while — its collision
              meshes load from the same pinned commit.)
            </p>
          ) : null}
          {state.kind === "done" ? (
            <Results
              result={state.result}
              catalogMassKg={entry.catalog_mass_kg ?? null}
              catalogMassLabel={entry.catalog_mass_label}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
