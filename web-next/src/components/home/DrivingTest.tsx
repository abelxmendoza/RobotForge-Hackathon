/* The driving test, explained once, with the two recorded runs.
 * Moved off the landing to How it works on 2026-11-17 (simplify
 * pass: the landing keeps one path for a new visitor; the detail
 * lives here). The landing's "Two recorded runs" band was the same
 * runs /evidence/ shows in full, so it became a link there. */
import Link from "next/link";

export default function DrivingTest() {
  return (
    <>
    <section className="band" id="workflow">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>How the driving test works.</h2>
        </div>
        <ol className="flow flow-4">
          <li>
            <span className="n">01</span>
            <h3>Describe it</h3>
            <p>Words, a photo, or a parts list.</p>
          </li>
          <li>
            <span className="n">02</span>
            <h3>Muse Spark writes the spec</h3>
            <p>The description becomes a spec sheet — numbers only.</p>
          </li>
          <li>
            <span className="n">03</span>
            <h3>The app builds the twin</h3>
            <p>The spec becomes a model (URDF/SDF), built in the Gazebo simulator.</p>
          </li>
          <li>
            <span className="n">04</span>
            <h3>The gate runs the test</h3>
            <p>The robot drives straight and turns. The gate compares odometry — where it thinks it went — with ground truth: where it actually went.</p>
          </li>
        </ol>
        <div className="split">
          <div className="card">
            <h3>The verdict</h3>
            <p style={{ marginTop: 12 }}>
              <span className="verdict pass">Pass</span>{" "}
              Distance error 5% or less, heading error 5° or less.
            </p>
            <p style={{ marginTop: 10 }}>
              <span className="verdict marginal">Marginal</span>{" "}
              Between 5% and 10%.
            </p>
            <p style={{ marginTop: 10 }}>
              <span className="verdict fail">Fail</span>{" "}
              Over 10%, or over 10°. The gate names the spec numbers it suspects.
            </p>
            <p style={{ marginTop: 10 }}>
              A physically impossible spec — ground clearance bigger than
              the wheel radius — is refused before the test runs.
            </p>
          </div>
          <div className="card">
            <h3>Proof, from real runs</h3>
            <p style={{ marginTop: 12 }}>
              TurtleBot3 Burger — <strong>PASS</strong>. Distance off by
              2.293%, heading by 1.421°.
            </p>
            <p style={{ marginTop: 10 }}>Pathfinder — <strong>PASS</strong>.</p>
            <p style={{ marginTop: 10 }}>
              Andino — <strong>FAIL</strong>. Heading off by 9.104°: its
              caster wheel drags in a turn.
            </p>
            <p style={{ marginTop: 10 }}>
              A robot that has not run the test is marked{" "}
              <strong>NOT GATED</strong>.
            </p>
          </div>
        </div>
        <p className="section-more muted">
          Under the hood: Muse Spark → spec → deterministic URDF/SDF
          generation → Gazebo → odometry vs ground truth.
        </p>
        <p className="section-more">
          <Link href="/evidence/">See all four recorded test drives →</Link>
        </p>
      </div>
    </section>


    </>
  );
}
