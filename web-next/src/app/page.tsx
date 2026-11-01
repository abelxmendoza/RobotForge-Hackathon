import type { Metadata } from "next";
import Link from "next/link";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import { AiInsideCards } from "@/components/home/AiInside";
import Term from "@/components/shell/Term";
import { assetPath } from "@/components/home/asset";
import LandingChrome, { LandingHeader, LandingFooter } from "@/components/home/LandingChrome";
import DemoEntryButton from "@/components/shell/DemoEntryButton";

/**
 * Home — originally a port of the vanilla landing's <main> (index.html),
 * section for section, class for class. The header, footer and Forge
 * Guide chat live in the root layout, as they wrap every page; the
 * robot row is generated from the same catalog data the Python
 * generator uses (catalog/robots.json), never hand-written.
 *
 * Explainer copy exception (2026-10-29, Abel's direction — declutter,
 * less is more): the #workflow band is now the ONE canonical
 * plain-English explanation of the gate, rewritten here; other pages
 * link to it instead of restating the test. The proof cards' figures
 * are still the recorded Oct 26, 2026 runs the landing cites, ported
 * as-is; the canonical proof line cites the catalog-recorded runs
 * (Burger's 2026-10-28 Torque-VM run, Pathfinder, Andino).
 */

export const metadata: Metadata = {
  // Absolute: the vanilla landing's <title>, bypassing the layout's
  // "%s · RobotForge" template.
  title: { absolute: "RobotForge — fix your robot before you spend a dollar" },
  description:
    "RobotForge gives robot models a driving test before anyone trusts them. Describe a robot in words, a photo or a parts list — its simulated twin has to pass.",
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="hero-logo"
            src={assetPath("assets/img/logo.svg")}
            width={1024}
            height={1024}
            alt="RobotForge logo — a rover inside a CAD wireframe cube"
          />
          <div className="eyebrow">
            Built with Meta&apos;s Muse Spark · Meta Global AI Developer Hackathon
          </div>
          <h1>Fix your robot before you spend a dollar.</h1>
          <p className="lede">
            RobotForge gives robot models a driving test before anyone
            trusts them. Describe a robot in words, a photo or a parts
            list — its simulated twin has to pass before you build or buy
            anything.
          </p>
          <div className="ctas">
            <Link className="btn btn-primary" href="/garage/">
              Open the app →
            </Link>
            <DemoEntryButton className="btn" label="Try the demo" />
            <Link className="btn" href="/demo/">
              Run the demo
            </Link>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            Trying the demo needs no account: the app opens with sample
            data and recorded answers. Nothing in it is live, and it
            never touches your own robots or parts.
          </p>
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

      {/* ============ TRAILER — recorded from the live app in demo
           mode (real screens, recorded data, no mockups). Tap-to-play:
           preload="none" + poster, so nothing downloads until a
           visitor asks for it. The video is silent; its text is on
           screen. */}
      <section className="band" id="trailer">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Trailer</div>
            <h2>Watch RobotForge work.</h2>
            <p>
              One minute inside the real app — the Workshop, the
              Robodex, the take-apart Kit, and a broken robot caught
              and fixed in one run.
            </p>
          </div>
          <figure className="hero-art" style={{ marginTop: 0 }}>
            <video
              controls
              preload="none"
              poster={assetPath("assets/video/robotforge-trailer-poster.png")}
              width={1920}
              height={1080}
              aria-label="RobotForge trailer — a recorded tour of the live app in demo mode"
            >
              <source
                src={assetPath("assets/video/robotforge-trailer-v1.mp4")}
                type="video/mp4"
              />
            </video>
            <figcaption>
              Recorded from the live app in demo mode, Nov 1, 2026 —
              real screens, recorded data, no mockups. Silent; the
              text is on screen.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ============ HOW IT WORKS — the one canonical explanation.
           Every other page links here instead of restating the test
           (decluttered 2026-10-29 at Abel's direction: less is more). */}
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
            <Link href="/how-it-works/">What a PASS proves — and what it doesn&apos;t →</Link>
          </p>
        </div>
      </section>

      {/* ============ PROOF ============ */}
      <section className="band" id="proof">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Proof</div>
            <h2>Two recorded runs.</h2>
            <p>
              One earned a PASS. One was rigged to fail — and its own
              sensors couldn&apos;t tell.
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
                a measured PASS.
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
              Bars run 0–15: green passes, yellow is marginal, past it
              fails. Recorded in Gazebo Sim, headless, Oct 26, 2026.
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
            <Link href="/how-it-works/#ai-inside">Where Muse Spark works →</Link>
          </p>
        </div>
      </section>

      {/* ============ STATUS — what's live, dated and checked.
           Every line below was verified on the served site the night
           it was written (bundle fingerprints, the endpoint health
           report, the served pages themselves). If a line stops being
           true, it comes off this page — that is the whole policy. */}
      <section className="band" id="status">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Status</div>
            <h2>What&apos;s live right now.</h2>
            <p>Checked on the served site, Oct 31, 2026.</p>
          </div>
          <div className="ai-cards">
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Wrench, the guide</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                Say hello — it answers like a person, not a search box.
                Facts come from recorded data and arrive with their
                sources; follow-ups remember the robot you&apos;re
                talking about; a failure gets a plain-language
                explanation, and the robot can be opened in the
                Workshop to fix.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Robodex</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                11 catalogued robots plus sightings, sorted by how we
                know them, then by how they move. Gate badges come only
                from recorded runs — never from a model&apos;s say-so.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Inventory</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                Your shelf, kept honest: the parts and tools you really
                own, with sim-only entries kept visibly separate.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Live endpoint</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                Muse Spark is answering now — describing robots, chat,
                and reading robot and part photos. If a route ever goes
                down, answers are labeled RECORDED and replay a real
                earlier run instead.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Phone-first</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                The site is tuned for the phone in your hand: touch
                targets at least 44 px, forms that don&apos;t zoom on
                focus, compact cards, and nothing hiding under the
                chat bar.
              </p>
            </article>
          </div>
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
            Watch a broken spec get caught, fixed and re-tested — the
            whole loop in one run.
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
              href="/garage/"
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
