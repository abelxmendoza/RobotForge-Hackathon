"use client";

/* Import a repo — paste a public GitHub robot repo and RobotForge
 * reads it: hardware story, parts, images, a simulation where the
 * model allows one, and a specimen record in your Garage with the
 * repo attached. All reads happen in this browser against the
 * GitHub API; the deterministic extraction is lib/repoImport.ts.
 * The Muse hardware pass is the only live call, and it follows the
 * app's usual gate: signed-in only, through the Worker, off in demo
 * mode — everything else about the import works without it. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  blobUrl, buildImportedSdfBundle, buildSpecimen, commitUrl, filterVendored,
  MAX_TREE_ENTRIES,
  gatherRequestFor, imageGate, parseRepoInput, parseRepoList, physicsEntryFor, toggleCardImage,
  pickFiles, rawUrl, slugifyRepo, validateHardwareItems,
  withCatalogMatches, GATHER_REQUESTS_KEY,
  type ImportSdfBundle, type RepoRef, type RepoSpecimen, type Snapshot,
} from "@/lib/repoImport";
import { REPO_IMPORT_EVENT } from "@/lib/repoLink";
import { repoImportFixture, RECORDED_SNAPSHOT_LABEL } from "@/lib/repoImportFixture";
import { parts as catalogParts, simReadyProps } from "@/lib/data";
import { attachRepo, detachRepo, GARAGE_KEY, robotRepos, sameRepo, type GarageRobot } from "@/lib/garage";
import { readStore, uid, useStore, writeStore } from "@/lib/store";
import { useBuildList } from "@/lib/buildList";
import { addToBuildList, buildPaletteItems } from "@/lib/palette";
import { runPhysicsChecks, type PhysicsResult } from "@/lib/physicsEngine";
import { buildGazeboLaunch, type GazeboBundle } from "@/lib/gazebo";
import { createZip } from "@/lib/zip";
import { liveHealth, postJSON, routeOn } from "@/components/forge/live";
import { loadSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/demoMode";

type GatherRequest = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* GitHub fetch (client-side, unauthenticated, honest errors)          */
/* ------------------------------------------------------------------ */

async function ghJson(url: string): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  } catch {
    throw new Error("GitHub could not be reached from this browser.");
  }
  if (r.status === 404) {
    throw new Error(
      "That repo was not found. Repo import reads public repos only — " +
      "a private repo (or a typo) answers exactly like a missing one.",
    );
  }
  if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(r.headers.get("x-ratelimit-reset") || 0);
    const when = reset
      ? new Date(reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "later";
    throw new Error(
      `GitHub's unauthenticated API limit (60 requests/hour) is used up on this network. It resets around ${when}.`,
    );
  }
  if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status} for ${url.split("github.com/")[1] || url}.`);
  return r.json();
}

async function fetchTextOrNull(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

async function fetchSnapshot(ref: RepoRef): Promise<Snapshot> {
  const meta = await ghJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}`);
  const branch = meta.default_branch || "main";
  const head = await ghJson(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?per_page=1&sha=${encodeURIComponent(branch)}`,
  );
  const sha: string = head[0]?.sha;
  if (!sha) throw new Error("The repo has no commits on its default branch to pin the import to.");
  const treeDoc = await ghJson(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${sha}?recursive=1`,
  );
  const rawPaths: string[] = (treeDoc.tree || [])
    .filter((t: any) => t.type === "blob")
    .map((t: any) => String(t.path));
  // Committed venvs, node_modules and copied-in third-party source trees
  // can be most of a tree; drop them before the cap so the robot's own
  // files make it in.
  const ownPaths = filterVendored(rawPaths);
  const truncated = Boolean(treeDoc.truncated) || ownPaths.length > MAX_TREE_ENTRIES;
  const treePaths = ownPaths.slice(0, MAX_TREE_ENTRIES);
  const picked = pickFiles(treePaths, ref.repo);

  const [readme, licenseText, bomText] = await Promise.all([
    picked.readme ? fetchTextOrNull(rawUrl(ref, sha, picked.readme)) : Promise.resolve(null),
    picked.license ? fetchTextOrNull(rawUrl(ref, sha, picked.license)) : Promise.resolve(null),
    picked.bom ? fetchTextOrNull(rawUrl(ref, sha, picked.bom)) : Promise.resolve(null),
  ]);
  const modelText = picked.primaryModel?.format === "urdf"
    ? await fetchTextOrNull(rawUrl(ref, sha, picked.primaryModel.path))
    : null;

  // package.xml names → the packages map physics/gazebo mesh
  // resolution uses (package://…), pinned at the import commit.
  const packages: Record<string, string> = {};
  for (const p of picked.packageXml.slice(0, 8)) {
    const text = await fetchTextOrNull(rawUrl(ref, sha, p));
    const pkgName = text ? /<name>\s*([^<\s]+)\s*<\/name>/.exec(text)?.[1] : null;
    if (pkgName) {
      packages[pkgName] = rawUrl(ref, sha, p.replace(/[^/]*$/, ""));
    }
  }

  return {
    ref,
    description: meta.description || "",
    headSha: sha,
    apiLicenseSpdx: meta.license?.spdx_id ?? null,
    treePaths,
    treeTruncated: truncated,
    texts: { readme, licenseText, bomText, modelText, packages },
    importedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* the Muse hardware pass (signed-in, Worker, quote-validated)       */
/* ------------------------------------------------------------------ */

async function claudeHardwarePass(
  specimen: RepoSpecimen,
  snap: Snapshot,
): Promise<{ specimen: RepoSpecimen; note: string }> {
  const session = loadSession();
  if (!session) {
    return { specimen, note: "Deterministic extraction only — sign in to add the Muse hardware pass." };
  }
  const health = await liveHealth();
  if (!routeOn(health, "chat")) {
    return { specimen, note: "Deterministic extraction only — the live endpoint is not available right now." };
  }
  const sourceText = [snap.texts.bomText || "", snap.texts.readme || ""].join("\n");
  const excerpt = sourceText.slice(0, 1400);
  if (excerpt.trim().length < 40) {
    return { specimen, note: "The repo's text is too short for a hardware pass; deterministic results only." };
  }
  const message =
    "You extract the hardware list from a robot project's repo text for RobotForge. " +
    "Reply with ONLY a JSON array (no prose, no code fences) of objects " +
    '{"name": "...", "category": "computer|motor|driver|sensor|power|other", "quote": "..."} ' +
    "where quote is a VERBATIM phrase copied from the text that names the item. " +
    "At most 16 items. Text:\n" + excerpt;
  try {
    const res = await postJSON<{ answer: string }>("/chat", { message });
    const start = res.answer.indexOf("[");
    const end = res.answer.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("no JSON array in the answer");
    const items = validateHardwareItems(JSON.parse(res.answer.slice(start, end + 1)), sourceText);
    if (!items.length) {
      return { specimen, note: "The Muse pass proposed nothing that could be verified against the repo text, so nothing was added." };
    }
    return {
      specimen: { ...specimen, hardware: { claudePass: true, items } },
      note: `Muse hardware pass: ${items.length} items, each tied to a quoted line from the repo.`,
    };
  } catch (e) {
    return { specimen, note: `The Muse hardware pass did not complete (${(e as Error).message}); deterministic results only.` };
  }
}

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

/* ------------------------------------------------------------------ */
/* the specimen detail                                                 */
/* ------------------------------------------------------------------ */

function SpecimenDetail({
  specimen, onChange, savedId,
}: {
  specimen: RepoSpecimen;
  onChange: (next: RepoSpecimen) => void;
  savedId: string | null;
}) {
  const prov = specimen.provenance;
  const ref: RepoRef = { owner: prov.owner, repo: prov.repo };
  const gate = imageGate(prov.license, specimen.imagesAttested);
  const [requests, setRequests] = useStore<GatherRequest[]>(GATHER_REQUESTS_KEY, []);
  const [buildEntries, saveBuildEntries] = useBuildList();
  const paletteItems = useMemo(() => buildPaletteItems(catalogParts, simReadyProps), []);
  const [physicsState, setPhysicsState] = useState<
    | { kind: "idle" } | { kind: "running" }
    | { kind: "error"; message: string } | { kind: "done"; result: PhysicsResult }
  >({ kind: "idle" });
  const [bundleState, setBundleState] = useState<
    | { kind: "idle" } | { kind: "building" }
    | { kind: "error"; message: string }
    | { kind: "done"; root: string; command: string; files: { path: string; content: string }[] }
  >({ kind: "idle" });

  const entry = physicsEntryFor(specimen, specimen.packages);
  const requestedNames = new Set(
    requests.filter((r) => r.repo === prov.repoUrl).map((r) => String(r.name)),
  );

  const requestGather = (partName: string) => {
    const part = specimen.parts.find((p) => p.name === partName);
    if (!part) return;
    const line = gatherRequestFor(part, specimen, new Date().toISOString());
    setRequests([line, ...requests]);
  };

  const exportRequests = () => {
    const text = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
    downloadBytes("gather-requests.jsonl", new TextEncoder().encode(text), "application/jsonl");
  };

  const addToBuild = (catalogId: string, qty: number | null) => {
    const item = paletteItems.find((i) => i.kind === "catalog-part" && i.refId === catalogId);
    if (!item) return;
    saveBuildEntries(addToBuildList(buildEntries, item, qty ?? 1, "palette", () => uid("build")));
  };

  const runPhysics = async () => {
    setPhysicsState({ kind: "running" });
    try {
      const result = await runPhysicsChecks(entry);
      const summary = {
        totalMassKg: result.totalMassKg,
        linkCount: result.links.length,
        com: result.com,
        stabilityInside: result.stability ? result.stability.inside : null,
        stabilityMarginM: result.stability ? result.stability.marginM : null,
        settleVerdict: result.settle ? result.settle.verdict : null,
        settleTiltDeg: result.settle ? result.settle.tiltDeg : null,
        runAt: new Date().toISOString(),
      };
      onChange({ ...specimen, physics: summary });
      setPhysicsState({ kind: "done", result });
    } catch (e) {
      setPhysicsState({ kind: "error", message: (e as Error).message });
    }
  };

  const buildBundle = async () => {
    setBundleState({ kind: "building" });
    try {
      if (specimen.model?.format === "urdf") {
        const bundle: GazeboBundle = await buildGazeboLaunch(
          {
            slug: slugifyRepo(ref),
            robotName: specimen.name,
            physics: entry,
          },
          async (url) => {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`fetch ${r.status} ${url}`);
            return r.text();
          },
        );
        setBundleState({
          kind: "done", root: bundle.bundleRoot,
          command: bundle.gzCommand || bundle.primaryCommand,
          files: bundle.files,
        });
      } else if (specimen.model?.format === "sdf") {
        const text = await fetchTextOrNull(rawUrl(ref, prov.commitSha, specimen.model.path));
        if (!text) throw new Error("the model file could not be fetched");
        const bundle: ImportSdfBundle = buildImportedSdfBundle(specimen, text);
        setBundleState({
          kind: "done", root: bundle.bundleRoot,
          command: bundle.gzCommand, files: bundle.files,
        });
      }
    } catch (e) {
      setBundleState({ kind: "error", message: (e as Error).message });
    }
  };

  const srcFile = (path?: string) =>
    path ? (
      <a href={blobUrl(ref, prov.commitSha, path.split(" (")[0])} target="_blank" rel="noreferrer">
        {path}
      </a>
    ) : (
      <span className="faint">not in this repo</span>
    );

  return (
    <div className="repo-import-detail">
      <div className="page-head">
        <div>
          <h2>{specimen.name}</h2>
          <p className="lede">
            <span className="fbadge live">From repo</span>{" "}
            <a href={prov.repoUrl} target="_blank" rel="noreferrer">{prov.owner}/{prov.repo}</a>{" "}
            · commit{" "}
            <a href={commitUrl(ref, prov.commitSha)} target="_blank" rel="noreferrer">
              {prov.commitSha.slice(0, 7)}
            </a>{" "}
            · license {prov.license.label}
            {prov.license.family === "nc" && (
              <> · <span className="fbadge planned">Non-commercial license</span></>
            )}
            {prov.recorded && <> · <span className="fbadge local">Recorded snapshot</span></>}
          </p>
          {specimen.description && <p>{specimen.description}</p>}
          <p className="faint">
            Imported {new Date(prov.importedAt).toLocaleString()}. Every fact below names the
            file it came from; the record is a specimen of the source repo, not a claim about
            a robot you built.
          </p>
        </div>
      </div>

      <section aria-label="Source files">
        <h3>Source files</h3>
        <ul>
          <li>Model: {srcFile(prov.sourceFiles.model)}</li>
          <li>Bill of materials / part list: {srcFile(prov.sourceFiles.bom)}</li>
          <li>README: {srcFile(prov.sourceFiles.readme)}</li>
          <li>License: {srcFile(prov.sourceFiles.license)}</li>
        </ul>
      </section>

      <section aria-label="Hardware">
        <h3>Hardware</h3>
        {specimen.hardware.claudePass ? (
          <>
            <p className="faint">
              Read by the Muse hardware pass from the repo text — every item carries the
              line it was read from. Items the pass could not quote were dropped.
            </p>
            <ul>
              {specimen.hardware.items.map((h, i) => (
                <li key={i}>
                  <strong>{h.name}</strong>{" "}
                  <span className="faint">({h.category})</span>
                  <br />
                  <span className="faint">“{h.quote}”</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Deterministic extraction only — no model pass ran on this import, so the
            hardware story is the parts list below, read directly from the repo files.
            {specimen.model?.urdf && (
              <> The model file records {specimen.model.urdf.links.length} links and{" "}
              {specimen.model.urdf.joints.length} joints
              {specimen.model.urdf.totalMassKg !== null && (
                <> totalling {fmt(specimen.model.urdf.totalMassKg)} kg of link mass</>
              )}.</>
            )}
          </p>
        )}
      </section>

      <section aria-label="Images" id="repo-images">
        <h3>Images from the repo</h3>
        {specimen.images.length === 0 && <p className="faint">No images were found in this repo.</p>}
        {specimen.images.length > 0 && (
          <>
            <p className="faint">{gate.reason}</p>
            {prov.license.family !== "permissive" && (
              <label className="g-check">
                <input
                  type="checkbox"
                  checked={specimen.imagesAttested}
                  onChange={(e) => onChange({ ...specimen, imagesAttested: e.target.checked })}
                />{" "}
                This is my repo, or I have the rights to use these images
              </label>
            )}
            {gate.display ? (
              <>
                <p className="faint">
                  Pick the pictures for this repo&apos;s card in the Workshop. The first one you pick is the cover.
                </p>
                <div className="repo-gallery">
                  {specimen.images.map((img, i) => {
                    const at = (specimen.cardImages ?? []).indexOf(img.url);
                    return (
                      <figure key={i} className={at >= 0 ? "on-card" : undefined}>
                        {at === 0 && <span className="repo-cover-tag">Cover</span>}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={img.alt} loading="lazy" referrerPolicy="no-referrer" />
                        <figcaption className="faint">
                          Image via {prov.owner}/{prov.repo} · {prov.license.label}
                        </figcaption>
                        <div className="repo-card-pick">
                          <button
                            type="button"
                            className={"btn btn-sm" + (at >= 0 ? " btn-primary" : "")}
                            aria-pressed={at >= 0}
                            onClick={() => onChange({ ...specimen, cardImages: toggleCardImage(specimen.cardImages, img.url) })}
                          >
                            {at >= 0 ? "On the card ✓" : "Show on card"}
                          </button>
                          {at > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onChange({ ...specimen, cardImages: toggleCardImage(specimen.cardImages, img.url, true) })}
                            >
                              Make cover
                            </button>
                          )}
                        </div>
                      </figure>
                    );
                  })}
                </div>
                <p className="faint">
                  These are the source repo’s images, shown with credit — not photos of your build.
                </p>
              </>
            ) : (
              <ul>
                {specimen.images.map((img, i) => (
                  <li key={i}>
                    <a href={img.url} target="_blank" rel="noreferrer">{img.path}</a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-label="Parts">
        <h3>Parts</h3>
        {specimen.parts.length === 0 && (
          <p className="faint">
            No bill of materials or part-list table was found in this repo, so there are
            no parts to match yet.
          </p>
        )}
        {specimen.parts.length > 0 && (
          <table className="repo-parts">
            <thead>
              <tr><th>Part</th><th>Qty</th><th>Catalogue</th><th></th></tr>
            </thead>
            <tbody>
              {specimen.parts.map((p, i) => {
                const matched = p.catalogId
                  ? catalogParts.find((c) => c.id === p.catalogId)
                  : undefined;
                return (
                  <tr key={i}>
                    <td>
                      {p.name}
                      {p.notes && <><br /><span className="faint">{p.notes}</span></>}
                      <br />
                      <span className="faint">from {srcFile(p.sourceFile)}</span>
                    </td>
                    <td>{p.qty ?? "—"}</td>
                    <td>
                      {matched ? (
                        <Link href="/kit/" title="Open the parts palette">
                          {matched.name}
                        </Link>
                      ) : (
                        <span className="faint">not in the catalogue</span>
                      )}
                    </td>
                    <td>
                      {matched ? (
                        <button type="button" className="btn btn-sm" onClick={() => addToBuild(p.catalogId!, p.qty)}>
                          Add to build list
                        </button>
                      ) : requestedNames.has(p.name) ? (
                        <span className="fbadge local">Gather requested</span>
                      ) : (
                        <button type="button" className="btn btn-sm" onClick={() => requestGather(p.name)}>
                          Request gather
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {requests.length > 0 && (
          <p className="faint">
            {requests.length} gather request{requests.length === 1 ? "" : "s"} stored in this
            browser (the gather queue’s format). The site-side queue endpoint is a follow-up —
            for now they live on this device.{" "}
            <button type="button" className="btn btn-sm" onClick={exportRequests}>
              Export gather requests (.jsonl)
            </button>
          </p>
        )}
      </section>

      <section aria-label="Simulation">
        <h3>Simulation</h3>
        {!specimen.model && (
          <p className="faint">This repo records no model file, so there is nothing to simulate.</p>
        )}
        {specimen.model && entry.status === "urdf" && (
          <>
            <p>
              The repo’s URDF ({specimen.model.path}) runs through the same physics checks as
              the Robodex robots — mass audit, static stability and a Rapier settle test, all
              computed in your browser from the pinned file.
            </p>
            {specimen.model.urdf && specimen.model.urdf.joints.length > 0 && (
              <>
                <h4>Joints the model records</h4>
                <ul>
                  {specimen.model.urdf.joints.map((j, i) => (
                    <li key={i}>
                      <code>{j.name}</code> — {j.type}, {j.parent} → {j.child}
                      {j.lower !== null && j.upper !== null && (
                        <> · limits {fmt(j.lower, 2)} to {fmt(j.upper, 2)}</>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="faint">
                  Joints with recorded limits are the ones the living build stage can animate;
                  the settle test judges the model locked at its zero pose.
                </p>
              </>
            )}
            {physicsState.kind === "idle" && !specimen.physics && (
              <button type="button" className="btn btn-primary" onClick={runPhysics}>
                Run physics checks
              </button>
            )}
            {physicsState.kind === "idle" && specimen.physics && (
              <>
                <p>
                  Last run: total mass {fmt(specimen.physics.totalMassKg)} kg across{" "}
                  {specimen.physics.linkCount} links
                  {specimen.physics.settleVerdict && (
                    <> · settle: <strong>{specimen.physics.settleVerdict}</strong></>
                  )}
                  {specimen.physics.stabilityInside !== null && (
                    <> · centre of mass {specimen.physics.stabilityInside ? "inside" : "OUTSIDE"} the
                    support polygon</>
                  )}
                  .
                </p>
                <button type="button" className="btn" onClick={runPhysics}>Run again</button>
              </>
            )}
            {physicsState.kind === "running" && <p>Running the checks on the pinned model…</p>}
            {physicsState.kind === "error" && (
              <p role="alert">The checks could not run: {physicsState.message}</p>
            )}
            {physicsState.kind === "done" && (
              <div>
                <p>
                  Total mass <strong>{fmt(physicsState.result.totalMassKg)} kg</strong> across{" "}
                  {physicsState.result.links.length} links · centre of mass at{" "}
                  {physicsState.result.com.map((v) => fmt(v)).join(", ")}
                  {physicsState.result.stability && (
                    <> · centre of mass {physicsState.result.stability.inside ? "inside" : "OUTSIDE"} the
                    support polygon (margin {fmt(physicsState.result.stability.marginM)} m)</>
                  )}
                  {physicsState.result.settle && (
                    <> · settle test: <strong>{physicsState.result.settle.verdict}</strong>{" "}
                    (tilt {fmt(physicsState.result.settle.tiltDeg, 1)}°)</>
                  )}
                  {physicsState.result.settleUnavailable && (
                    <> · settle test unavailable: {physicsState.result.settleUnavailable}</>
                  )}
                  .
                </p>
                <button type="button" className="btn" onClick={runPhysics}>Run again</button>
              </div>
            )}
          </>
        )}
        {specimen.model && entry.status !== "urdf" && (
          <p>{entry.reason}</p>
        )}
        {specimen.model && (specimen.model.format === "urdf" || specimen.model.format === "sdf") && (
          <div>
            <h4>Launch in Gazebo</h4>
            <p className="faint">
              A ready-to-run bundle built around the imported model file: the model exactly as
              published, generated world scaffolding, a launch file and the command. Runs on
              your machine — Gazebo isn’t in the browser.
            </p>
            {bundleState.kind === "idle" && (
              <button type="button" className="btn" onClick={buildBundle}>Build the launch bundle</button>
            )}
            {bundleState.kind === "building" && <p>Assembling the bundle from the pinned model…</p>}
            {bundleState.kind === "error" && (
              <p role="alert">The bundle could not be built: {bundleState.message}</p>
            )}
            {bundleState.kind === "done" && (
              <p>
                <code>{bundleState.command}</code>{" "}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    downloadBytes(
                      `${bundleState.root}.zip`,
                      createZip(bundleState.files),
                      "application/zip",
                    )
                  }
                >
                  Download the bundle (.zip)
                </button>
              </p>
            )}
          </div>
        )}
        {specimen.model?.format === "xacro" && (
          <p className="faint">
            No Gazebo bundle for an xacro model: the bundle is built around a URDF or SDF
            file, and RobotForge does not expand xacro behind your back.
          </p>
        )}
        {savedId && (
          <p className="faint">
            Saved in your Garage — open it any time from the Workshop list, or{" "}
            <Link href={`/import/?robot=${savedId}&src=${specimen.provenance.owner}/${specimen.provenance.repo}`}>link straight here</Link>.
          </p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

type BatchRow = {
  slug: string;
  state: "waiting" | "reading" | "added" | "failed" | "removed";
  msg?: string;
  repoUrl?: string;
};

/* A new Garage robot for a repo, named after it. */
function robotFromRepo(specimen: RepoSpecimen): GarageRobot {
  const now = new Date().toISOString();
  return {
    id: uid("robot"),
    name: specimen.name,
    createdAt: now,
    versions: [
      {
        id: uid("v"),
        label: "Repo import",
        note: `${specimen.provenance.repoUrl} @ ${specimen.provenance.commitSha.slice(0, 7)}`,
        source: "repo",
        createdAt: now,
        spec: { name: specimen.name },
      },
    ],
    repoImport: specimen,
  };
}

export default function RepoImport() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [specimen, setSpecimen] = useState<RepoSpecimen | null>(null);
  const [robots, saveRobots] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [linkedSrc, setLinkedSrc] = useState<string | null>(null);
  // Where "Save" puts the import: a new robot, or a robot you already
  // have (a robot can carry several repos: firmware, ROS, CAD…).
  const [target, setTarget] = useState<string>("new");
  // The last save on this page, so a mistaken one can be undone:
  // a robot this save created is removed, an updated repo goes back
  // to the commit it had, and a newly added repo is taken off again.
  const [undo, setUndo] = useState<{ robotId: string; repoUrl: string; created: boolean; prev: RepoSpecimen | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Several repos pasted at once are read one after another and each
  // is saved to the same robot as soon as it has been read.
  const [batch, setBatch] = useState<BatchRow[] | null>(null);
  const [batchRobotId, setBatchRobotId] = useState<string | null>(null);
  const demo = typeof window !== "undefined" && isDemoMode();

  // /import/?robot=<garage id>[&src=owner/repo] opens a saved specimen;
  // /import/?attach=<garage id> preselects that robot for the next save.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("robot");
    if (id) setLinkedId(id);
    setLinkedSrc(q.get("src"));
    const attach = q.get("attach");
    if (attach) setTarget(attach);
  }, []);
  // /import/?repo=<owner/repo> comes from Wrench: a repo link pasted
  // into the chat composer fills the form and starts the import.
  const [autoRepo, setAutoRepo] = useState<RepoRef | null>(null);
  useEffect(() => {
    const take = (raw: string | null) => {
      const ref = raw ? parseRepoInput(raw) : null;
      if (ref) {
        setInput(`https://github.com/${ref.owner}/${ref.repo}`);
        setAutoRepo(ref);
      }
    };
    take(new URLSearchParams(window.location.search).get("repo"));
    // A link pasted while this page is already open arrives as an event:
    // a query-only navigation keeps this component mounted.
    const onRepo = (e: Event) => take((e as CustomEvent<string>).detail);
    window.addEventListener(REPO_IMPORT_EVENT, onRepo);
    return () => window.removeEventListener(REPO_IMPORT_EVENT, onRepo);
  }, []);
  useEffect(() => {
    if (autoRepo) {
      setAutoRepo(null);
      void runImport(autoRepo);
    }
    // runImport is recreated each render; the import should start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRepo]);
  const linkedRobot = linkedId ? robots.find((r) => r.id === linkedId) : undefined;
  useEffect(() => {
    const repos = robotRepos(linkedRobot);
    if (linkedRobot && repos.length && !specimen) {
      const src = linkedSrc?.toLowerCase();
      const pick = repos.find(
        (x) => `${x.provenance.owner}/${x.provenance.repo}`.toLowerCase() === src,
      ) ?? repos[0];
      setSpecimen(pick);
      setSavedId(linkedRobot.id);
    }
  }, [linkedRobot, linkedSrc, specimen]);
  // An unknown ?attach= id (robot removed, other browser) falls back to "new".
  const targetRobot = target === "new" ? undefined : robots.find((r) => r.id === target);

  const persistSpecimen = (next: RepoSpecimen) => {
    setSpecimen(next);
    if (savedId) {
      saveRobots(
        robots.map((r) => (r.id === savedId ? attachRepo(r, next) : r)),
      );
    }
  };

  const runImport = async (ref: RepoRef) => {
    setBusy("Reading the repo from GitHub…");
    setError(null);
    setNote(null);
    setSavedId(null);
    setUndo(null);
    setConfirmRemove(false);
    setBatch(null);
    try {
      const snap = await fetchSnapshot(ref);
      setBusy("Extracting the hardware story…");
      let built = withCatalogMatches(buildSpecimen(snap), catalogParts);
      const passed = await claudeHardwarePass(built, snap);
      built = passed.specimen;
      setNote(
        [
          snap.treeTruncated
            ? "The repo's file tree is very large — the import read the first 3,000 files and says so rather than pretending it saw everything."
            : "",
          passed.note,
        ].filter(Boolean).join(" "),
      );
      setSpecimen(built);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadFixture = () => {
    setError(null);
    const built = withCatalogMatches(buildSpecimen(repoImportFixture), catalogParts);
    setSpecimen(built);
    setSavedId(null);
    setNote(RECORDED_SNAPSHOT_LABEL + " — deterministic extraction only, as in any demo.");
  };

  const saveToGarage = () => {
    if (!specimen) return;
    const sameRecord = (x: RepoSpecimen) =>
      sameRepo(x.provenance.repoUrl, specimen.provenance.repoUrl) &&
      x.provenance.commitSha === specimen.provenance.commitSha;
    const existing = robots.find((r) => robotRepos(r).some(sameRecord));
    if (existing && (!targetRobot || existing.id === targetRobot.id)) {
      setSavedId(existing.id);
      setNote(`That repo at that commit is already on ${existing.name} — this is the same record.`);
      setSpecimen(robotRepos(existing).find(sameRecord)!);
      return;
    }
    if (targetRobot) {
      const had = robotRepos(targetRobot).some(
        (x) => sameRepo(x.provenance.repoUrl, specimen.provenance.repoUrl),
      );
      const failure = saveRobots(
        robots.map((r) => (r.id === targetRobot.id ? attachRepo(r, specimen) : r)),
      );
      if (failure) {
        setError(failure);
        return;
      }
      setSavedId(targetRobot.id);
      setUndo({
        robotId: targetRobot.id,
        repoUrl: specimen.provenance.repoUrl,
        created: false,
        prev: robotRepos(targetRobot).find((x) => sameRepo(x.provenance.repoUrl, specimen.provenance.repoUrl)) ?? null,
      });
      setNote(
        had
          ? `Updated ${specimen.provenance.owner}/${specimen.provenance.repo} on ${targetRobot.name} to this commit.`
          : `Added to ${targetRobot.name}. It now has ${robotRepos(targetRobot).length + 1} repos.`,
      );
      return;
    }
    const robot = robotFromRepo(specimen);
    const failure = saveRobots([robot, ...robots]);
    if (failure) {
      setError(failure);
      return;
    }
    setSavedId(robot.id);
    setUndo({ robotId: robot.id, repoUrl: specimen.provenance.repoUrl, created: true, prev: null });
    setNote("Saved to your Garage with the repo attached.");
  };

  /* Undo the last save, or take a saved repo off its robot. */
  const removeSaved = () => {
    if (!specimen || !savedId) return;
    const list = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot = list.find((r) => r.id === savedId);
    const slug = `${specimen.provenance.owner}/${specimen.provenance.repo}`;
    let next: GarageRobot[];
    let msg: string;
    if (undo && undo.robotId === savedId && undo.created) {
      next = list.filter((r) => r.id !== savedId);
      msg = `Undone. The robot this import created was removed, and ${slug} is no longer in your Garage.`;
    } else if (undo && undo.robotId === savedId && undo.prev) {
      next = list.map((r) => (r.id === savedId ? attachRepo(r, undo.prev!) : r));
      msg = `Undone. ${slug} on ${robot?.name ?? "the robot"} is back at the commit it had before.`;
    } else {
      if (!undo && !confirmRemove) { setConfirmRemove(true); return; }
      next = list.map((r) => (r.id === savedId ? detachRepo(r, specimen.provenance.repoUrl) : r));
      msg = `Removed ${slug} from ${robot?.name ?? "the robot"}. The robot and its versions are unchanged.`;
    }
    const failure = writeStore(GARAGE_KEY, next);
    if (failure) { setError(failure); return; }
    setSavedId(null);
    setUndo(null);
    setConfirmRemove(false);
    setLinkedId(null);
    setNote(msg);
  };

  /* Drop the import on screen without saving anything. */
  const discard = () => {
    setSpecimen(null);
    setSavedId(null);
    setUndo(null);
    setConfirmRemove(false);
    setBatch(null);
    setInput("");
    setNote(null);
    setError(null);
  };

  const runBatch = async (refs: RepoRef[]) => {
    discard();
    const rows: BatchRow[] = refs.map((r) => ({ slug: `${r.owner}/${r.repo}`, state: "waiting" }));
    setBatch(rows);
    setBatchRobotId(null);
    const patch = (i: number, p: Partial<BatchRow>) =>
      setBatch((b) => (b ? b.map((x, j) => (j === i ? { ...x, ...p } : x)) : b));
    let robotId: string | null = targetRobot?.id ?? null;
    for (let i = 0; i < refs.length; i++) {
      setBusy(`Reading ${i + 1} of ${refs.length}: ${rows[i].slug}…`);
      patch(i, { state: "reading" });
      try {
        const snap = await fetchSnapshot(refs[i]);
        let built = withCatalogMatches(buildSpecimen(snap), catalogParts);
        built = (await claudeHardwarePass(built, snap)).specimen;
        // Read the Garage fresh each time: the list in this render is
        // stale once the first repo of the batch has been saved.
        const list = readStore<GarageRobot[]>(GARAGE_KEY, []);
        let next: GarageRobot[];
        if (robotId && list.some((r) => r.id === robotId)) {
          next = list.map((r) => (r.id === robotId ? attachRepo(r, built) : r));
        } else {
          const robot = robotFromRepo(built);
          robotId = robot.id;
          next = [robot, ...list];
        }
        const failure = writeStore(GARAGE_KEY, next);
        if (failure) throw new Error(failure);
        setBatchRobotId(robotId);
        patch(i, {
          state: "added",
          repoUrl: built.provenance.repoUrl,
          msg: `${built.parts.length} part${built.parts.length === 1 ? "" : "s"} · @ ${built.provenance.commitSha.slice(0, 7)}`,
        });
      } catch (e) {
        patch(i, { state: "failed", msg: (e as Error).message });
      }
    }
    setBusy(null);
  };

  const removeBatchRow = (i: number) => {
    const row = batch?.[i];
    if (!row?.repoUrl || !batchRobotId) return;
    const list = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const failure = writeStore(
      GARAGE_KEY,
      list.map((r) => (r.id === batchRobotId ? detachRepo(r, row.repoUrl!) : r)),
    );
    if (failure) { setError(failure); return; }
    setBatch((b) => (b ? b.map((x, j) => (j === i ? { ...x, state: "removed" } : x)) : b));
  };
  const batchRobot = batchRobotId ? robots.find((r) => r.id === batchRobotId) : undefined;

  const repoCount = parseRepoList(input).refs.length;

  return (
    <div className="repo-import">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const { refs, bad } = parseRepoList(input);
          if (!refs.length) {
            setError("That does not look like a GitHub repo. Paste a URL like https://github.com/owner/repo, or just owner/repo.");
            return;
          }
          if (bad.length) {
            setError(`Not a GitHub repo: ${bad.join(", ")}. Fix or remove ${bad.length === 1 ? "it" : "them"} and import again.`);
            return;
          }
          if (refs.length === 1) void runImport(refs[0]);
          else void runBatch(refs);
        }}
      >
        <label>
          Public GitHub repos
          <textarea
            rows={Math.min(6, Math.max(2, input.split("\n").length))}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter imports, Shift+Enter adds another line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={"https://github.com/owner/robot-firmware\nowner/robot-ros  (one per line for several)"}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {robots.length > 0 && repoCount > 1 && !specimen && (
          <label className="repo-batch-target">
            Add them to{" "}
            <select value={targetRobot ? target : "new"} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">A new robot</option>
              {robots.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
          {busy || (repoCount > 1 ? `Import ${repoCount} repos` : "Import the repo")}
        </button>
        {demo && (
          <button type="button" className="btn" onClick={loadFixture} disabled={Boolean(busy)}>
            Run the recorded demo import
          </button>
        )}
      </form>
      <p className="faint">
        The import reads the repo in your browser — metadata, file tree, README, license,
        bill of materials and the model file, pinned to the commit it read. Paste several
        links, one per line, to give one robot its firmware, ROS and CAD repos in one go.
        Public repos only in this version; uploading a repo as a .zip is a documented follow-up.
      </p>
      {error && <p role="alert" className="g-error">{error}</p>}
      {note && <p className="faint" role="status">{note}</p>}

      {batch && (
        <section className="repo-batch" aria-label="Imported repos">
          <h3>
            {batchRobot
              ? `${batch.filter((x) => x.state === "added").length} of ${batch.length} repos added to ${batchRobot.name}`
              : busy ? "Importing…" : "Nothing was added"}
          </h3>
          <ul>
            {batch.map((x, i) => (
              <li key={x.slug} data-state={x.state}>
                <strong>{x.slug}</strong>
                <span className="faint g-small">
                  {x.state === "waiting" ? "Waiting" : x.state === "reading" ? "Reading…" : x.state === "removed" ? "Removed" : x.state === "failed" ? `Failed: ${x.msg}` : x.msg}
                </span>
                {x.state === "added" && (
                  <button type="button" className="btn btn-sm" onClick={() => removeBatchRow(i)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          {batchRobot && !busy && (
            <p className="repo-batch-actions">
              <Link className="btn btn-sm btn-primary" href={`/garage/#robot=${batchRobot.id}`}>Open {batchRobot.name} in the Workshop</Link>
              <button type="button" className="btn btn-sm" onClick={discard}>Import more</button>
            </p>
          )}
        </section>
      )}

      {specimen && (
        <>
          {savedId && (
            <div className="repo-saved">
              {confirmRemove ? (
                <span className="g-remove-confirm" role="alert">
                  Remove {specimen.provenance.owner}/{specimen.provenance.repo} from {robots.find((r) => r.id === savedId)?.name ?? "this robot"}?{" "}
                  <button type="button" className="btn btn-sm g-remove-yes" onClick={removeSaved}>Yes, remove</button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="btn btn-sm" onClick={removeSaved}>
                  {undo ? "Undo this save" : `Remove from ${robots.find((r) => r.id === savedId)?.name ?? "this robot"}`}
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={discard}>Import another repo</button>
            </div>
          )}
          {!savedId && (
            <div className="repo-save">
              {robots.length > 0 && (
                <label>
                  Save to{" "}
                  <select value={targetRobot ? target : "new"} onChange={(e) => setTarget(e.target.value)}>
                    <option value="new">A new robot</option>
                    {robots.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {robotRepos(r).length ? ` (${robotRepos(r).length} repo${robotRepos(r).length === 1 ? "" : "s"})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="btn btn-primary" onClick={saveToGarage}>
                {targetRobot ? `Add this repo to ${targetRobot.name}` : "Save to my Garage"}
              </button>
              <button type="button" className="btn" onClick={discard}>Discard</button>
              <span className="faint">
                {targetRobot
                  ? "A robot can carry several repos, such as its firmware, ROS packages and CAD. The robot's versions are not changed."
                  : "The specimen record — provenance, hardware, parts, images — is saved with the robot."}
              </span>
            </div>
          )}
          <SpecimenDetail specimen={specimen} onChange={persistSpecimen} savedId={savedId} />
        </>
      )}
    </div>
  );
}
