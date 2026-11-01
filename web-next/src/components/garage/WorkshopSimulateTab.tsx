"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { physicsOf, robots, robotSlug } from "@/lib/data";
import { runPhysicsChecks, type PhysicsResult } from "@/lib/physicsEngine";
import { massAudit } from "@/lib/physicsMath";
import {
  gazeboState, resolveCatalogueSlug, simAvailability,
} from "@/lib/workshopSim";

/* The Workshop's Simulate tab: what can honestly be simulated about
 * the robot on this bench, reusing the robot pages' own physics
 * engine (lib/physicsEngine — the same code, not a copy) and
 * rendering its results as summary cards here, with the robot
 * page's full Physics section one link away.
 *
 * A Workshop robot simulates only when it maps to a Robodex
 * catalogue robot with a recorded model (lib/workshopSim: narrow,
 * provable matching, no fuzzy inheritance). Without one, the tab
 * states the reason plainly — no fake run, no borrowed numbers. */

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "error"; message: string }
  | { phase: "done"; result: PhysicsResult };

export default function WorkshopSimulateTab({
  robotName,
  specName,
}: {
  robotName: string;
  specName: unknown;
}) {
  const knownSlugs = useMemo(
    () => new Set(robots.map((r) => robotSlug(r))),
    [],
  );
  const slug = resolveCatalogueSlug(robotName, specName, knownSlugs);
  const entry = slug ? physicsOf(slug) : undefined;
  const avail = simAvailability(slug, entry);
  const gz = gazeboState(slug, entry);
  const [run, setRun] = useState<RunState>({ phase: "idle" });

  const startRun = async () => {
    if (avail.kind !== "urdf") return;
    setRun({ phase: "running" });
    try {
      const result = await runPhysicsChecks(avail.entry);
      setRun({ phase: "done", result });
    } catch (e) {
      setRun({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const audit =
    run.phase === "done" && avail.kind === "urdf"
      ? massAudit(run.result.totalMassKg, avail.entry.catalog_mass_kg)
      : null;

  return (
    <section className="ws-pane" aria-label="Simulate">
      <p className="sub">
        Simulation runs on recorded models only. If this robot maps to a
        Robodex catalogue robot, the same physics engine the robot pages
        use runs here, in your browser, on the recorded URDF — nothing is
        uploaded and nothing is approximated silently.
      </p>

      {avail.kind === "not-catalogue" ? (
        <div className="ws-empty" style={{ marginTop: 12 }}>
          <p>
            <strong>No recorded model for this robot.</strong> It does not
            map to a Robodex catalogue robot, so there is no recorded URDF
            to run physics on and nothing a Gazebo bundle could be built
            from. Naming it after a catalogue robot is not enough — the
            match has to be the robot&apos;s own recorded identity.
          </p>
        </div>
      ) : null}

      {avail.kind === "no-urdf" ? (
        <div className="ws-empty" style={{ marginTop: 12 }}>
          <p>
            <strong>Physics checks cannot run on this robot.</strong>{" "}
            {avail.reason}
          </p>
        </div>
      ) : null}

      {avail.kind === "urdf" ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: "var(--fs-md)" }}>
            Physics checks — {slug}
          </h3>
          <p className="sub">
            Mass audit against the catalogue figure, centre-of-mass
            stability, and a settle test, computed from the recorded model
            by the robot pages&apos; engine.{" "}
            <Link href={`/robots/${slug}/`}>
              Open the full Physics section →
            </Link>
          </p>
          {run.phase === "idle" ? (
            <p>
              <button type="button" className="primary" onClick={startRun}>
                Run physics checks
              </button>
            </p>
          ) : null}
          {run.phase === "running" ? (
            <p className="sub">Running — parsing the recorded model…</p>
          ) : null}
          {run.phase === "error" ? (
            <p className="state-box">
              The checks could not run: {run.message}
            </p>
          ) : null}
          {run.phase === "done" ? (
            <div className="sim-cards">
              <div className="sim-card">
                <h4>Mass audit</h4>
                <p>
                  Model: {run.result.totalMassKg.toFixed(3)} kg
                  {avail.entry.catalog_mass_kg != null ? (
                    <>
                      {" "}· catalogue: {avail.entry.catalog_mass_kg} kg
                      {audit ? (
                        audit.agrees ? (
                          <> — agrees within ±5%.</>
                        ) : (
                          <>
                            {" "}— differs by {audit.deltaPct.toFixed(1)}%,
                            flagged rather than smoothed over.
                          </>
                        )
                      ) : null}
                    </>
                  ) : (
                    <> — no catalogue mass recorded to audit against.</>
                  )}
                </p>
              </div>
              <div className="sim-card">
                <h4>Stability</h4>
                <p>
                  {run.result.stability
                    ? run.result.stability.inside
                      ? `Centre of mass sits inside the support polygon (margin ${(run.result.stability.marginM * 1000).toFixed(0)} mm).`
                      : `Centre of mass falls OUTSIDE the support polygon by ${Math.abs(run.result.stability.marginM * 1000).toFixed(0)} mm — this build would tip as modelled.`
                    : "No ground-contact shapes in the model, so stability cannot be computed."}
                </p>
              </div>
              <div className="sim-card">
                <h4>Settle test</h4>
                <p>
                  {run.result.settle
                    ? run.result.settle.verdict === "stands"
                      ? `Stands — settles at ${run.result.settle.tiltDeg.toFixed(1)}° of tilt.`
                      : run.result.settle.verdict === "settles-tilted"
                        ? `Settles tilted at ${run.result.settle.tiltDeg.toFixed(1)}° — it does not fall, but it does not stand straight either.`
                        : `Topples — ends at ${run.result.settle.tiltDeg.toFixed(1)}° of tilt.`
                    : (run.result.settleUnavailable ??
                      "The settle test could not run on this model.")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: "var(--fs-md)" }}>Launch in Gazebo</h3>
        <p className="sub">
          Gazebo runs on your machine — it is not in the browser. {gz.note}
        </p>
        {slug ? (
          <p className="sub">
            The recorded model and its provenance live on{" "}
            <Link href={`/robots/${slug}/`}>this robot&apos;s page</Link>.
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: "var(--fs-md)" }}>Kit stage</h3>
        <p className="sub">
          The 3D Kit stage is where parts are placed and builds take
          shape — the visual side of the bench, beside these checks.
        </p>
        <p>
          <Link className="btn btn-sm" href="/kit/">
            Open the Kit stage →
          </Link>
        </p>
      </div>
    </section>
  );
}
