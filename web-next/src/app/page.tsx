import type { Metadata } from "next";
import Link from "next/link";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import HowItWorks from "@/components/home/HowItWorks";
import AiInside from "@/components/home/AiInside";
import Term, { Glossary } from "@/components/shell/Term";
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
  return (
    <>
    <LandingHeader />
    <main>
      {/* ============ HERO ============ */}
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">
            Meta Global AI Developer Hackathon · Indie track
          </div>
          <h1>Fix your robot before you spend a dollar.</h1>
          <p className="lede">
            Bring in a broken robot, an idea, or a pile of parts. Muse Spark
            proposes the spec and the fixes, engineering checks decide what
            holds, and a simulated twin has to pass a measured motion test,
            all before you buy a single part.
          </p>
          <div className="ctas">
            <Link className="btn btn-primary" href="/demo/">
              Run the one-click demo →
            </Link>
            <Link className="btn" href="/forge/">
              Open the app
            </Link>
            <a className="btn btn-ghost" href="#proof">
              See the evidence
            </a>
          </div>
          <p className="powered">
            Spec drafting by Muse Spark via the Meta Model API · twin and
            gate in Gazebo Sim
          </p>
          <figure className="hero-art">
            {/* Vanilla markup uses a plain <img>; next/image would alter it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetPath("assets/img/hero.jpg")}
              width={900}
              height={386}
              alt="Illustration of a rugged four-wheel rover on a workbench, lit in amber"
            />
            <figcaption>
              AI illustration (muse-image-1.0). The real robots in the app
              carry real, credited photos.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ============ WORKFLOW ============ */}
      <section className="band" id="workflow">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">The workflow</div>
            <h2>Five steps from an idea to a verdict.</h2>
            <p>
              Every robot goes through the same path. Nothing downstream
              trusts the step before it: the model&apos;s spec is checked,
              and the twin is measured.
            </p>
          </div>
          <ol className="flow">
            <li>
              <span className="n">01</span>
              <h3>Input</h3>
              <p>Plain words, a pasted parts list, or a photo.</p>
            </li>
            <li>
              <span className="n">02</span>
              <h3><Term k="spec">Spec</Term></h3>
              <p>Muse Spark drafts a strict, structured hardware spec.</p>
            </li>
            <li>
              <span className="n">03</span>
              <h3><Term k="checks">Checks</Term></h3>
              <p>
                Engineering checks catch impossible or inconsistent
                numbers.
              </p>
            </li>
            <li>
              <span className="n">04</span>
              <h3><Term k="twin">Twin</Term> &amp; <Term k="gate">gate</Term></h3>
              <p>
                The twin drives 1 m and turns 90° in <Term k="gazebo">Gazebo</Term>, graded on{" "}
                <Term k="ground_truth">ground truth</Term>.
              </p>
            </li>
            <li>
              <span className="n">05</span>
              <h3>Outputs</h3>
              <p>
                <Term k="urdf">URDF</Term>, a printable <Term k="takeapart">take-apart</Term> kit, and what&apos;s missing
                to buy.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* ============ AI INSIDE ============ */}
      <section className="band" id="ai-inside">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">AI inside</div>
            <h2>Where Muse Spark works, and where it doesn&apos;t.</h2>
            <p>
              Meta&apos;s Muse Spark reads, drafts and proposes. Deterministic
              checks decide. Every model output on the site is labelled LIVE,
              RECORDED or MOCK, so you always know which one you are looking at.
            </p>
          </div>
          <AiInside />
        </div>
      </section>

      {/* ============ PLAIN ENGLISH ============ */}
      <section className="band" id="glossary">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Plain English</div>
            <h2>The words on this site, without the jargon.</h2>
            <p>Hover or tap a dotted word anywhere on the site for the same meaning.</p>
          </div>
          <Glossary />
        </div>
      </section>

      {/* ============ PROOF ============ */}
      <section className="band" id="proof">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Evidence</div>
            <h2>The gate is not a rubber stamp.</h2>
            <p>
              Thresholds are locked: distance error 5% passes and over 10%
              fails, heading error 5° passes and over 10° fails. Here is
              one robot that earned a PASS, and one that was rigged to
              fail.
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

      {/* ============ ROBOTS ============ */}
      <section className="band" id="robots">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Robodex</div>
            <h2>Robots the forge knows.</h2>
            <p>
              Each badge comes only from recorded gate runs. A robot that
              hasn&apos;t been gated says so in grey instead of borrowing a
              green it hasn&apos;t earned.
            </p>
          </div>
          <div className="robot-row">
            {robots.map((robot) => (
              <RobotCard key={robot.number} robot={robot} />
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="band" id="how">
        <div className="wrap">
          <HowItWorks />
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="band cta-band">
        <div className="wrap">
          <h2>Watch a robot go through the forge.</h2>
          <p>
            Step through a real recorded run: the paragraph, the spec Muse
            Spark returned, the checks, and the gate&apos;s measured
            verdict.
          </p>
          <Link
            className="btn btn-primary"
            href="/forge/"
            style={{ padding: "14px 22px", fontSize: "var(--fs-md)" }}
          >
            Open the app →
          </Link>
        </div>
      </section>
    </main>
    <LandingFooter />
    <LandingChrome />
    </>
  );
}
