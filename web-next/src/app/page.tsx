import type { Metadata } from "next";
import Link from "next/link";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import { AiInsideCards } from "@/components/home/AiInside";
import Term from "@/components/shell/Term";
import { assetPath } from "@/components/home/asset";
import LandingChrome, { LandingHeader, LandingFooter } from "@/components/home/LandingChrome";

/**
 * Home — a port of the vanilla landing's <main> (index.html), section
 * for section, class for class. The header, footer and Forge Guide chat
 * live in the root layout, as they wrap every page; the robot row is
 * generated from the same catalog data the Python generator uses
 * (catalog/robots.json), never hand-written.
 *
 * The proof figures are literal in the vanilla markup (they are the
 * recorded Oct 26, 2026 runs the landing cites); they are ported as-is,
 * not re-derived or rounded.
 */

export const metadata: Metadata = {
  // Absolute: the vanilla landing's <title>, bypassing the layout's
  // "%s · RobotForge" template.
  title: { absolute: "RobotForge — fix your robot before you spend a dollar" },
  description:
    "Bring in a broken robot, an idea or a pile of parts. Muse Spark proposes the spec and the fixes, engineering checks decide what holds, and a simulated twin has to pass a measured motion test.",
};

export default function HomePage() {
  /* The first four catalogue robots; the rest are on /robots/. */
  const featured = robots.slice(0, 4);
  return (
    <>
    <LandingHeader />
    <main id="main">
      {/* ============ HERO ============ */}
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">
            Built with Meta&apos;s Muse Spark · Meta Global AI Developer Hackathon
          </div>
          <h1>Fix your robot before you spend a dollar.</h1>
          <p className="lede">
            Bring in a broken robot, an idea or a pile of parts. Muse Spark
            proposes the spec and the fixes, engineering checks decide what
            holds, and a simulated twin has to pass a measured motion test.
          </p>
          <div className="ctas">
            <Link className="btn btn-primary" href="/forge/">
              Open the app →
            </Link>
            <Link className="btn" href="/demo/">
              Run the demo
            </Link>
          </div>
          <figure className="hero-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetPath("assets/img/hero.jpg")}
              width={900}
              height={386}
              alt="Illustration of a rugged four-wheel rover on a workbench"
            />
            <figcaption>
              AI illustration (muse-image-1.0). The real robots in the app
              carry real, credited photos.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="band" id="workflow">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>Four steps, and the AI never grades itself.</h2>
          </div>
          <ol className="flow flow-4">
            <li>
              <span className="n">01</span>
              <h3>Bring your robot</h3>
              <p>Plain words, a photo, a parts list or a <Term k="spec">spec</Term> file.</p>
            </li>
            <li>
              <span className="n">02</span>
              <h3>Muse Spark drafts and fixes</h3>
              <p>It writes the spec and proposes repairs when a check fails.</p>
            </li>
            <li>
              <span className="n">03</span>
              <h3><Term k="checks">Checks</Term> decide</h3>
              <p>Fixed engineering rules accept or reject every number and every fix.</p>
            </li>
            <li>
              <span className="n">04</span>
              <h3><Term k="gazebo">Gazebo</Term> proves it</h3>
              <p>A <Term k="twin">twin</Term> drives 1 m and turns 90°, graded on <Term k="ground_truth">ground truth</Term>.</p>
            </li>
          </ol>
          <p className="section-more">
            <Link href="/how-it-works/">How RobotForge decides, in detail →</Link>
          </p>
        </div>
      </section>

      {/* ============ PROOF ============ */}
      <section className="band" id="proof">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Proof</div>
            <h2>The simulation test is not a rubber stamp.</h2>
            <p>
              One robot that earned a PASS in Gazebo, and one rigged to fail.
              The limits are fixed: 5% passes, over 10% fails.
            </p>
          </div>
          <div className="proof">
            <article className="card">
              <div className="card-head">
                <span className="eyebrow">
                  Described in words, never drawn
                </span>
                <span className="verdict pass">Pass</span>
              </div>
              <h3>Indoor Delivery Rover</h3>
              <p>
                One paragraph of plain English became a spec, a twin, and
                a measured PASS. Its odometry — the robot&apos;s own
                estimate of how far it has travelled, from its wheels and
                sensors — matched ground truth to 0.002%.
              </p>
              <div className="metrics">
                <div className="metric">
                  <div className="metric-top">
                    <span className="metric-label">Drive error</span>
                  </div>
                  <div className="metric-value">
                    0.398<small>%</small>
                  </div>
                  <div className="meter">
                    <span
                      className="z-pass"
                      style={{ width: "33.3%" }}
                    ></span>
                    <span
                      className="z-marg"
                      style={{ left: "33.3%", width: "33.3%" }}
                    ></span>
                    <span
                      className="fill pass"
                      style={{ width: "2.7%" }}
                    ></span>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-top">
                    <span className="metric-label">Turn error</span>
                  </div>
                  <div className="metric-value">
                    3.653<small>°</small>
                  </div>
                  <div className="meter">
                    <span
                      className="z-pass"
                      style={{ width: "33.3%" }}
                    ></span>
                    <span
                      className="z-marg"
                      style={{ left: "33.3%", width: "33.3%" }}
                    ></span>
                    <span
                      className="fill pass"
                      style={{ width: "24.4%" }}
                    ></span>
                  </div>
                </div>
              </div>
            </article>
            <article className="card">
              <div className="card-head">
                <span className="eyebrow">Fault injection</span>
                <span className="verdict fail">Fail</span>
              </div>
              <h3>Wheels 10% smaller than the paperwork</h3>
              <p>
                TurtleBot3 Burger with its physical wheels shrunk to 0.9×
                while odometry kept believing the spec. The robot&apos;s
                own sensors couldn&apos;t see it. The gate could.
              </p>
              <div className="metrics">
                <div className="metric">
                  <div className="metric-top">
                    <span className="metric-label">Drive error</span>
                  </div>
                  <div className="metric-value">
                    7.617<small>%</small>
                  </div>
                  <div className="meter">
                    <span
                      className="z-pass"
                      style={{ width: "33.3%" }}
                    ></span>
                    <span
                      className="z-marg"
                      style={{ left: "33.3%", width: "33.3%" }}
                    ></span>
                    <span
                      className="fill marginal"
                      style={{ width: "50.8%" }}
                    ></span>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-top">
                    <span className="metric-label">Odometry vs truth</span>
                  </div>
                  <div className="metric-value">
                    11.168<small>%</small>
                  </div>
                  <div className="meter">
                    <span
                      className="z-pass"
                      style={{ width: "33.3%" }}
                    ></span>
                    <span
                      className="z-marg"
                      style={{ left: "33.3%", width: "33.3%" }}
                    ></span>
                    <span
                      className="fill fail"
                      style={{ width: "74.5%" }}
                    ></span>
                  </div>
                </div>
              </div>
            </article>
          </div>
          <div className="proof-foot">
            <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              Bars run 0–15. Green zone passes, yellow is marginal, past it
              fails. Recorded in Gazebo Sim, headless (no window opens —
              the simulator runs unseen), Oct 26, 2026.
            </p>
            <Link className="btn" href="/evidence/">
              All gate reports →
            </Link>
          </div>
        </div>
      </section>

      {/* ============ AI INSIDE ============ */}
      <section className="band" id="ai-inside">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">AI inside</div>
            <h2>Muse Spark reads, drafts and proposes. It never decides.</h2>
          </div>
          <AiInsideCards />
          <p className="section-more">
            <Link href="/how-it-works/#ai-inside">Every place Muse Spark works, and whether it is live now →</Link>
          </p>
        </div>
      </section>

      {/* ============ ROBOTS ============ */}
      <section className="band" id="robots">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow"><Term k="robodex">Robodex</Term></div>
            <h2>Real robots, checked the same way.</h2>
          </div>
          <div className="robot-row robot-row-4">
            {featured.map((robot) => (
              <RobotCard key={robot.number} robot={robot} />
            ))}
          </div>
          <p className="section-more">
            <Link href="/robots/">See all {robots.length} robots →</Link>
          </p>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="band cta-band">
        <div className="wrap">
          <h2>See a broken robot get fixed in one click.</h2>
          <p>
            The demo runs the whole story: the checks catch the mistakes,
            Muse Spark proposes the fix, and the checks decide.
          </p>
          <div
            style={{
              display: "flex",
              gap: "var(--s3)",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              className="btn btn-primary"
              href="/demo/"
              style={{ padding: "14px 22px", fontSize: "var(--fs-md)" }}
            >
              Run the demo →
            </Link>
            <Link
              className="btn"
              href="/forge/"
              style={{ padding: "14px 22px", fontSize: "var(--fs-md)" }}
            >
              Open the app →
            </Link>
          </div>
          <figure className="hero-art hero-shot" style={{ marginTop: "var(--s7)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetPath("assets/img/demo-shot.jpg")}
              width={872}
              height={640}
              alt="The one-click demo: the engineering checks flag a voltage mismatch and a clearance error, and the Forge loop fixes both in one round"
            />
            <figcaption>The one-click demo, mid-run.</figcaption>
          </figure>
        </div>
      </section>
    </main>
    <LandingFooter />
    <LandingChrome />
    </>
  );
}
