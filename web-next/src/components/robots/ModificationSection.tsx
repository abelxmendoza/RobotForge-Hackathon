import type { Robot } from "@/lib/types";
import { parts } from "@/lib/data";
import type { BuildDef } from "@/lib/builds";
import { REPO_URL } from "@/components/shell/AppShell";
import HarnessSection, { asHarnessReport } from "./HarnessSection";
import { staticCheckOf } from "./shared";
import TakeApartViewer from "./takeapart/TakeApartViewer";

/* A guided modification what-if (Wave 3): the picked catalog parts,
   the proposed placement, the build's own take-apart opened on its
   payload circuit, and the validation that was PRECOMPUTED with the
   repo's Python engine and committed as a recorded report — the
   page renders the report's own states and invents nothing. The
   before/after table prints UNKNOWN where the record has no number
   (the parts catalog records no part masses) instead of filling
   the gap. */

function specLines(specs: Record<string, unknown> | undefined) {
  if (!specs) return [];
  return Object.entries(specs).map(([k, v]) => ({
    k: k.replace(/_/g, " "),
    v: Array.isArray(v) ? v.join(", ") : String(v),
  }));
}

export default function ModificationSection({
  robot,
  build,
  reportDoc,
}: {
  robot: Robot;
  build: BuildDef;
  reportDoc: Record<string, unknown> | undefined;
}) {
  const rep = asHarnessReport(reportDoc);
  const check = staticCheckOf(robot);
  const picked = build.partIds
    .map((id) => parts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <section className="section" id="modification">
      <h2>Modify it — a guided what-if</h2>
      <p className="sub">
        “Add a Jetson Orin and a lidar on a printed mount — the app
        figures out the rest.” What the app can honestly figure out
        today is below: the parts from the catalogue, a placement
        proposed from the spec&apos;s geometry, and validation
        computed by the repo&apos;s Python engine and committed as a
        recorded report. Nothing here is fitted to a real robot.
      </p>
      <p>
        <span className="recorded">Recorded · {build.recordedDate}</span>{" "}
        <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
          Validation for this build was run once, through the engine,
          and saved as data — this page displays it; it does not
          recompute or re-badge it.
        </span>
      </p>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>{build.name}</h3>
          <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
            saved as a named build — spec + wiring + reports in{" "}
            <a href={`${REPO_URL}/blob/main/${build.specFile}`}>
              <code>{build.specFile}</code>
            </a>
          </span>
        </div>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr><th>Picked part</th><th>What it is</th><th>Catalogue facts used</th></tr>
            </thead>
            <tbody>
              {picked.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <br />
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {p.source ?? ""}
                    </span>
                  </td>
                  <td>{p.blurb ?? p.used_for ?? ""}</td>
                  <td>
                    {specLines(p.specs).map((l) => (
                      <span key={l.k} style={{ display: "block" }}>
                        {l.k}: {l.v}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
          {build.placement}
        </p>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {build.mountNote}
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        <TakeApartViewer
          specFile={build.specFile}
          initialFocus="harness"
          no3D
        />
      </div>

      <div className="callout" style={{ marginTop: 12 }}>
        <span>
          <strong>Power, re-based on the official interface — read
          this before the counts:</strong> the first recorded version
          of this build fed the catalogue&apos;s 5 V buck
          (<code>buck_converter_5v</code>, rated <strong>24 V
          maximum</strong> on its input) straight from Spot&apos;s
          pack rail at 50.4 V — the viewer flagged it red, and it
          would have run the converter far past its rating. The
          retrieval pass filed under{" "}
          <a href="#sources">Sources &amp; models</a> found how Boston
          Dynamics actually powers payloads, and this version is
          wired that way: a Spot GXP expansion payload sits on one of
          the robot&apos;s DB25 payload ports — unregulated bus,
          35–58.8 V, 150 W per port — and provides regulated rails.
          The Jetson cannot run from the GXP&apos;s 5 V rail: that
          rail is <strong>10 W at most</strong>, against the
          Jetson&apos;s 7 / 15 / 25 W modes. So the Jetson is fed
          from the GXP&apos;s 24 V rail through the same catalogue
          buck — inside its rating now, but exactly at it: 24 V in
          against a 24 V maximum, no margin. The lidar rides the
          GXP&apos;s 5 V rail instead. The remaining alternative — a
          wide-input regulator straight on the port bus, with
          components rated for at least 80 V input as Boston Dynamics
          advises — cannot be graded here: the catalogue stocks no
          such regulator.
        </span>
      </div>

      {rep ? (
        <HarnessSection rep={rep} slug={build.reportSlug} specFile={build.specFile} />
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Before / after — only what the record holds</h3>
        </div>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr><th></th><th>Base robot</th><th>With the build</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Mass</strong></td>
                <td>32.5 kg — published base weight, without the arm</td>
                <td>
                  <strong>+ UNKNOWN.</strong> The Jetson module, its
                  carrier board, the lidar and the mount have no mass
                  in the parts catalogue — no part records one — so
                  the modified total is not stated. The one published
                  figure, the GXP&apos;s 430 g, cannot complete a
                  total on its own; it is counted in the payload row
                  below.
                </td>
              </tr>
              <tr>
                <td><strong>Payload capacity</strong></td>
                <td>
                  14 kg total — published limit for everything on the
                  robot&apos;s top (Boston Dynamics, SDK Configuration
                  Requirements)
                </td>
                <td>
                  The photographed unit&apos;s own arm is published
                  at 8 kg against that limit, and this build adds the
                  GXP (430 g, published) plus parts whose masses are
                  UNKNOWN — so the remaining margin is honestly
                  stated as: 14 kg limit, 8 kg already spoken for,
                  this build&apos;s share UNKNOWN.
                </td>
              </tr>
              <tr>
                <td><strong>Static stability</strong></td>
                <td>
                  {check
                    ? `${check.grade} · ${check.tip_angle_deg.toFixed(1)}° weakest tip angle (recorded ${check.date})`
                    : "No recorded check"}
                </td>
                <td>
                  <strong>Not recomputed.</strong> The check&apos;s
                  centre-of-mass model can only move for a payload
                  whose mass is known, and this payload&apos;s mass is
                  UNKNOWN — re-running it unchanged would print the
                  base number and call it a payload result. The base
                  report&apos;s own assumptions already say “no
                  payload”.
                </td>
              </tr>
              <tr>
                <td><strong>Payload power</strong></td>
                <td>— (no payload circuit)</td>
                <td>
                  Re-based on the official interface and re-graded in
                  the recorded report above: the GXP&apos;s 24 V rail
                  budget and the buck&apos;s 5 V rail both grade
                  CHECKED — the 5 V rail at exactly its 5 A rating
                  under the Jetson&apos;s 25 W mode, so 0 A of
                  headroom there — and the GXP&apos;s 5 V rail grades
                  PARTIAL, feeding the lidar with its draw uncounted.
                  On the GXP&apos;s 5 V rail alone (10 W max), the
                  Jetson could only run its 7 W mode.
                </td>
              </tr>
              <tr>
                <td><strong>Harness</strong></td>
                <td>Not documented — no wiring block, nothing drawn</td>
                <td>
                  The payload circuit only — now including the
                  payload port and the GXP&apos;s regulated rails —
                  graded in the recorded report above: counts as
                  printed there, never a blanket pass.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
