"use client";

import { useState } from "react";
import { ENVIRONMENTS } from "@/lib/environments";

/* Simulate (Wave 3): the environment registry picker over the
   wheeled twins' world, with this robot's own simulation status
   badged ROADMAP in plain sight. The picker consumes the registry
   shape {id, name, format, source, engine_targets, license}; the
   upload contract is published as "prepared for" — the upload
   itself is post-hackathon and nothing here accepts a file. */

export default function SimulateSection() {
  const [sel, setSel] = useState(ENVIRONMENTS[0].id);
  const env = ENVIRONMENTS.find((e) => e.id === sel) ?? ENVIRONMENTS[0];

  return (
    <section className="section" id="simulate">
      <h2>Simulate it</h2>
      <p className="sub">
        Environments are picked from a registry — the same shape a
        custom upload will use. The presets below belong to the
        wheeled twins: the twin generator is wheeled-only today.
      </p>

      <div className="callout" style={{ marginBottom: 12 }}>
        <span>
          <span className="roadmap">Roadmap</span>{" "}
          <strong>Spot simulation.</strong> There is no legged twin:
          the twin&apos;s SDF builder dereferences the spec&apos;s
          wheel, the URDF exporter emits no leg geometry, and the
          gate is a wheeled odometry check. A legged model with gait
          and control is post-hackathon work — Boston Dynamics&apos;
          own SDK models are the honest source to study — so no
          simulation of this robot is shown or claimed.
        </span>
      </div>
      <div className="callout" style={{ marginBottom: 12 }}>
        <span>
          <span className="roadmap">Roadmap</span>{" "}
          <strong>Photo-derived 3D.</strong> The 3D model above is
          derived from the curated spec&apos;s numbers, not from the
          photograph — the two stay visibly distinct. No SAM 3D run
          exists for Spot; when one lands it will be badged
          AI-RECONSTRUCTED + ESTIMATED: a likeness from photos, never
          a measurement.
        </span>
      </div>

      <div className="toolbar" role="group" aria-label="Pick an environment">
        {ENVIRONMENTS.map((e) => (
          <button
            key={e.id}
            className="chip"
            type="button"
            aria-pressed={sel === e.id}
            onClick={() => setSel(e.id)}
          >
            {e.name}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>{env.name}</h3>
          {env.recorded ? (
            <span className="recorded">Recorded</span>
          ) : env.id === "realmforge-xr-slot" ? (
            <span className="roadmap">Roadmap</span>
          ) : (
            <span className="recorded">Generated preset</span>
          )}
        </div>
        <table className="kv" style={{ marginTop: 12 }}>
          <tbody>
            <tr><th>Format</th><td>{env.format.toUpperCase()}</td></tr>
            <tr><th>Source</th><td>{env.source}</td></tr>
            <tr>
              <th>Engine targets</th>
              <td>{env.engine_targets.join(", ")}</td>
            </tr>
            <tr><th>License</th><td>{env.license}</td></tr>
            <tr><th>Status</th><td>{env.status}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Custom environments — prepared for</h3>
          <span className="roadmap">Upload: post-hackathon</span>
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
          The registry is the contract an upload will be checked
          against: <strong>.sdf</strong> world files are accepted
          natively (Gazebo loads them as-is; the file must be valid
          XML, contain a <code>&lt;world&gt;</code>, and any embedded
          model includes must stay inside an allowlist);{" "}
          <strong>.glb / glTF</strong> arrives as visual-only terrain
          until collision is derived from it, and is labelled as
          such; <strong>USD</strong> belongs to the Isaac path only.
        </p>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Isaac Sim, concretely: this repo emits URDF + SDF and zero
          USD. The compatibility claimed is exactly that the URDF
          opens in Isaac Sim&apos;s own URDF importer, which converts
          it to USD — no native USD export is promised, and a
          URDF→USD converter step is post-hackathon.
        </p>
      </div>
    </section>
  );
}
