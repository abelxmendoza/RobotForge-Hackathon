import Link from "next/link";
import CopyButton from "./CopyButton";

/**
 * The fine print for /how-it-works/: what a PASS proves, what it
 * doesn't, and the CLI quickstart.
 *
 * The test itself is explained once, on the landing page's #workflow
 * band — that is the canonical explanation. This component used to
 * restate the whole mechanism a second time (pipeline graphic, three
 * explainer cards); it was cut on 2026-10-29 at Abel's direction
 * (declutter: one explanation, links instead of copies, less is more).
 */

const QUICKSTART = `pip install -e .
robotforge describe "a four-wheel rover, 30 cm long, with a front ultrasonic sensor" --mock --out rover.json
robotforge validate rover.json
robotforge urdf rover.json --out build/rover.urdf
robotforge run-gate rover.json`;

export default function HowItWorks() {
  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Under the hood</div>
        <h2>What a PASS proves.</h2>
        <p>
          The test itself is explained once, on the home page:{" "}
          <Link href="/#workflow">how the driving test works</Link>. This
          page keeps the fine print.
        </p>
      </div>

      <div className="split">
        <div className="card yes">
          <h3>What a PASS proves</h3>
          <ul>
            <li>
              The spec&apos;s numbers agree with each other: geometry,
              mass budget, voltages.
            </li>
            <li>
              The twin&apos;s odometry matched ground truth within the
              locked thresholds.
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

      <p className="section-more">
        <Link href="/evidence/">Every recorded gate report →</Link>
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
