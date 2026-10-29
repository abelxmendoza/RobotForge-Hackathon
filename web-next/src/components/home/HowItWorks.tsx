import Link from "next/link";
import { Fragment } from "react";
import CopyButton from "./CopyButton";

/**
 * The "How RobotForge decides" content — ported verbatim from the
 * landing's #how section in index.html. That section is the only
 * how-it-works content the vanilla site has: there is no standalone
 * vanilla how-it-works page or generator (the app nav is Forge /
 * Robots / Evidence only), so both the Home page (as the landing's
 * #how band) and the /how-it-works/ page render this same content.
 */

const QUICKSTART = `pip install -e .
robotforge describe "a four-wheel rover, 30 cm long, with a front ultrasonic sensor" --mock --out rover.json
robotforge validate rover.json
robotforge urdf rover.json --out build/rover.urdf
robotforge run-gate rover.json`;

const PIPELINE: { label: string; small: string; cls?: string }[] = [
  { label: "Describe", small: "words · list · photo" },
  { label: "Spec", small: "Muse Spark", cls: "node ai" },
  { label: "Validate", small: "engineering checks" },
  { label: "URDF", small: "model" },
  { label: "Twin", small: "Gazebo, headless" },
  { label: "Gate", small: "pass · marginal · fail", cls: "node gate" },
];

export default function HowItWorks() {
  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Under the hood</div>
        <h2>How RobotForge decides.</h2>
        <p>
          The model sits on the critical path, and nothing it says is
          trusted until it is checked and measured.
        </p>
      </div>

      <div className="pipeline" role="list" aria-label="Pipeline">
        {PIPELINE.map((node, i) => (
          <Fragment key={node.label}>
            {i > 0 && (
              <span className="arrow" aria-hidden="true">
                →
              </span>
            )}
            <div className={node.cls ?? "node"} role="listitem">
              {node.label}
              <small>{node.small}</small>
            </div>
          </Fragment>
        ))}
      </div>

      <div className="split">
        <div className="card yes">
          <h3>What a PASS proves</h3>
          <ul>
            <li>
              The spec&apos;s numbers are consistent with each other:
              geometry, mass budget, voltages.
            </li>
            <li>
              A twin built from exactly that spec drives 1 m and turns 90°
              within the locked thresholds.
            </li>
            <li>
              The twin&apos;s own odometry agrees with simulator ground
              truth, so its sensors aren&apos;t lying to it.
            </li>
          </ul>
        </div>
        <div className="card no">
          <h3>What it doesn&apos;t prove</h3>
          <ul>
            <li>
              That a physical robot will behave the same. The gate tests
              the spec&apos;s simulated twin, not hardware.
            </li>
            <li>
              That a photo-drafted spec is accurate. Photo dimensions are
              marked ESTIMATED until measured.
            </li>
            <li>
              Anything beyond drive and turn. Other behaviours aren&apos;t
              gated yet.
            </li>
          </ul>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="eyebrow">Meta model</div>
          <h3 style={{ marginTop: 8 }}>Muse Spark drafts the spec</h3>
          <p>
            Through the Meta Model API in Standard mode. It turns words or
            a photo into a strict spec schema and never writes simulation
            code.
          </p>
        </div>
        <div className="card">
          <div className="eyebrow">Cross-check</div>
          <h3 style={{ marginTop: 8 }}>SAM 3.1 double-checks photos</h3>
          <p>
            It locates parts in the picture independently. When it
            disagrees with Spark, both answers are printed, not smoothed
            over.
          </p>
        </div>
        <div className="card">
          <div className="eyebrow">Gate</div>
          <h3 style={{ marginTop: 8 }}>Ground truth, not belief</h3>
          <p>
            Drive and turn are judged against the simulator&apos;s true
            pose. Odometry is graded too, so a robot can&apos;t pass on
            its own word.
          </p>
        </div>
      </div>

      <p className="section-more">
        <Link href="/evidence/">The locked pass and fail thresholds, and every recorded report →</Link>
      </p>

      <div className="card quickstart">
        <div className="card-head">
          <h3 style={{ fontSize: "var(--fs-md)" }}>Run it yourself</h3>
          <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            Python, zero required dependencies for the core
          </span>
        </div>
        <div className="codeblock" style={{ marginTop: 12 }}>
          <pre>
            <code>{QUICKSTART}</code>
          </pre>
          <CopyButton />
        </div>
      </div>
    </>
  );
}
