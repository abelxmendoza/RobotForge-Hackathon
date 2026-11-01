"use client";

import { useState } from "react";
import { findRobot, physicsOf } from "@/lib/data";
import {
  buildGazeboLaunch,
  gazeboAvailability,
  type GazeboBundle,
  type GazeboInputs,
  type Px4SpecimenSource,
} from "@/lib/gazebo";
import { createZip } from "@/lib/zip";
import { assetPath } from "@/components/home/asset";

/* "Launch in Gazebo" for one Robodex entry.
 *
 * The copy in this section is the feature's honesty contract, and it
 * is deliberate: Gazebo does not run in a browser, so the section
 * never implies it does. What the button does — all of it locally,
 * no Worker calls — is assemble a launch package from the robot's
 * recorded model (lib/gazebo.ts) and hand over the download plus
 * the exact command. Entries whose recorded model Gazebo cannot
 * use show the reason instead of a button, mirroring the physics
 * section's no-data states. */

type BuildState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "error"; message: string }
  | { kind: "done"; bundle: GazeboBundle };

async function fetchText(url: string): Promise<string> {
  const res = await fetch(assetPath(url));
  if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${url}`);
  return res.text();
}

/** The X500's model source lives in its specimen record, not in
 *  catalog/physics.json (which only knows the model is not a URDF). */
async function px4Specimen(): Promise<Px4SpecimenSource | undefined> {
  try {
    const res = await fetch(assetPath("catalog/specimens/px4-x500.json"));
    if (!res.ok) return undefined;
    const doc = (await res.json()) as {
      specimen?: { source?: { repo?: string; commit?: string; sdf?: string; license?: string } };
    };
    const src = doc.specimen?.source;
    if (!src?.repo || !src?.commit || !src?.sdf) return undefined;
    return { repo: src.repo, commit: src.commit, sdfPath: src.sdf, license: src.license };
  } catch {
    return undefined;
  }
}

function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="card-head">
        <h3 style={{ fontSize: "var(--fs-md)" }}>{label}</h3>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p style={{ marginTop: 8, overflowX: "auto" }}>
        <code>{command}</code>
      </p>
    </div>
  );
}

function BundleResult({ bundle }: { bundle: GazeboBundle }) {
  const totalBytes = bundle.files.reduce((s, f) => s + byteSize(f.content), 0);
  const download = () => {
    const bytes = createZip(bundle.files);
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: "application/zip",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bundle.bundleRoot}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="card">
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Run it on your machine</h3>
          <span className="fbadge local">LOCAL</span>
        </div>
        <CommandBlock label="ROS 2 launch (primary)" command={bundle.primaryCommand} />
        {bundle.gzCommand ? (
          <CommandBlock label="Plain gz sim variant" command={bundle.gzCommand} />
        ) : null}
        <p style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={download}>
            Download {bundle.bundleRoot}.zip ({bundle.files.length} files,{" "}
            {Math.max(1, Math.round(totalBytes / 1024))} KB)
          </button>
        </p>
        {bundle.format === "xacro" ? (
          <p className="prov" style={{ marginTop: 8 }}>
            <span>
              The zip holds no model file: Andino&apos;s model is a xacro
              package, so the bundle&apos;s <code>fetch_model.sh</code> downloads
              the official repo on your machine and the launch expands the
              xacro there. That fetch is the one unpinned download in any
              RobotForge bundle — the catalogue records the repository but no
              commit for this model, and the bundle&apos;s README says so too.
            </span>
          </p>
        ) : bundle.meshDownloads.length > 0 ? (
          <p className="prov" style={{ marginTop: 8 }}>
            <span>
              The zip is text-only on purpose. The model&apos;s{" "}
              {bundle.meshDownloads.length} mesh files are upstream binaries
              and are not in it — <code>fetch_meshes.sh</code> inside the bundle
              downloads them from the same pinned upstream commit the model
              came from. Nothing is re-hosted here.
            </span>
          </p>
        ) : (
          <p className="prov" style={{ marginTop: 8 }}>
            <span>
              This model needs no mesh downloads — its geometry is primitives,
              so the zip is complete as it stands.
            </span>
          </p>
        )}
        {bundle.unresolvedMeshes.length > 0 ? (
          <p className="state-box" style={{ marginTop: 8 }}>
            The model references {bundle.unresolvedMeshes.length} file
            {bundle.unresolvedMeshes.length === 1 ? "" : "s"} RobotForge could
            not map to a download ({bundle.unresolvedMeshes.join(", ")}). The
            bundle&apos;s README lists them; those parts spawn without their
            mesh geometry until the files are placed by hand.
          </p>
        ) : null}
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr><th>In the bundle</th><th>Size</th></tr>
            </thead>
            <tbody>
              {bundle.files.map((f) => (
                <tr key={f.path}>
                  <td><code>{f.path.slice(bundle.bundleRoot.length + 1)}</code></td>
                  <td className="num">{byteSize(f.content).toLocaleString()} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bundle.notes.length > 0 ? (
          <>
            <p style={{ marginTop: 10 }}>
              <strong>Notes for this robot</strong>
            </p>
            <ul>
              {bundle.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function GazeboSection({ slug, robotName }: { slug: string; robotName: string }) {
  const physics = physicsOf(slug);
  const robot = findRobot(slug);
  const prov = (robot?.provenance ?? {}) as Record<string, unknown>;
  const inputs: GazeboInputs = {
    slug,
    robotName,
    physics,
    andinoRepoUrl: typeof prov.source_url === "string" ? prov.source_url : undefined,
  };
  const avail = gazeboAvailability(inputs);
  const [state, setState] = useState<BuildState>({ kind: "idle" });

  const build = async () => {
    setState({ kind: "building" });
    try {
      const full: GazeboInputs =
        slug === "px4-x500" ? { ...inputs, px4: await px4Specimen() } : inputs;
      const bundle = await buildGazeboLaunch(full, fetchText);
      setState({ kind: "done", bundle });
    } catch (e) {
      setState({
        kind: "error",
        message:
          `The bundle could not be built: ${(e as Error).message}. ` +
          "The model loads from its upstream repository at build time, so this is usually a network problem — nothing was packaged and nothing is shown in its place.",
      });
    }
  };

  return (
    <section className="section" id="gazebo">
      <h2>Launch in Gazebo</h2>
      <p className="sub">
        Gazebo doesn&apos;t run in a browser — not on this page, not anywhere —
        so this doesn&apos;t pretend to run it. Instead it does the real job a
        web app can do: it assembles a ready-to-run launch package from this
        robot&apos;s recorded model — the model file, a minimal generated
        world, a ROS 2 launch file and a plain <code>gz sim</code> variant —
        and hands you the download plus the exact command.{" "}
        <strong>Runs on your machine — Gazebo isn&apos;t in the browser.</strong>{" "}
        Reference stack: Ubuntu 24.04, ROS 2 Jazzy, Gazebo Harmonic. The
        package spawns the model at the origin in its zero pose; the original
        project&apos;s controllers and bringup are not wired.
      </p>
      {!avail.ok ? (
        <div className="card">
          <p className="state-box">{avail.reason}</p>
        </div>
      ) : (
        <>
          {physics?.source_label ? (
            <p className="prov">
              <span>
                <strong>Model:</strong> {physics.source_label}
                {physics.license ? <> · licence {physics.license}</> : null}. The
                bundle is built from that address at click time; the model is
                not re-hosted here.
              </span>
            </p>
          ) : slug === "andino" ? (
            <p className="prov">
              <span>
                <strong>Model:</strong> the official Ekumen-OS/andino repository
                (andino_description, xacro). The catalogue records the repository
                but no pinned commit for this model — the bundle says so wherever
                it matters.
              </span>
            </p>
          ) : (
            <p className="prov">
              <span>
                <strong>Model:</strong> the PX4 X500&apos;s recorded SDF, from
                its specimen import&apos;s pinned commit in PX4&apos;s Gazebo
                models repo.
              </span>
            </p>
          )}
          {state.kind === "idle" || state.kind === "error" ? (
            <>
              <button type="button" className="primary" onClick={build}>
                Build the Gazebo launch package for {robotName}
              </button>
              {state.kind === "error" ? (
                <p className="state-box" style={{ marginTop: 12 }}>{state.message}</p>
              ) : null}
            </>
          ) : null}
          {state.kind === "building" ? (
            <p className="state-box">
              Fetching the recorded model and assembling the bundle in this
              browser…
            </p>
          ) : null}
          {state.kind === "done" ? <BundleResult bundle={state.bundle} /> : null}
        </>
      )}
    </section>
  );
}
