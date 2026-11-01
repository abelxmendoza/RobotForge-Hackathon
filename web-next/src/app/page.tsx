import type { Metadata } from "next";
import Link from "next/link";
import RunDemoLink from "@/components/shell/RunDemoLink";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import { AiInsideCards } from "@/components/home/AiInside";
import Term from "@/components/shell/Term";
import { assetPath } from "@/components/home/asset";
import LandingChrome, { LandingHeader, LandingFooter } from "@/components/home/LandingChrome";

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

import DemoVideoCard from "@/components/home/DemoVideoCard";

export const metadata: Metadata = {
  // Absolute: the vanilla landing's <title>, bypassing the layout's
  // "%s · RobotForge" template.
  title: { absolute: "RobotForge — build, fix, modify, upgrade and simulate your robot before you spend a dollar" },
  description:
    "Build, fix, modify, upgrade and simulate your robot before you spend a dollar. Describe it in words, a photo or a parts list; RobotForge checks every change and its simulated twin has to pass a driving test.",
};

const VERBS: { verb: string; body: string; go: string; to: string }[] = [
  {
    verb: "Build",
    body: "Start from words, a photo or a parts list, then watch the 3D model go together part by part.",
    go: "Open the build bench",
    to: "/garage/#tab=build",
  },
  {
    verb: "Fix",
    body: "The checks name what is wrong, Muse Spark proposes a fix, and the fix has to pass the same test.",
    go: "Watch a broken robot get fixed",
    to: "/demo/",
  },
  {
    verb: "Modify",
    body: "Change a wheel, a motor or the battery in the spec. Every edit is checked again.",
    go: "Edit the spec",
    to: "/garage/#tab=specs",
  },
  {
    verb: "Upgrade",
    body: "Save an upgrade as a new version, compare it with the robot you have, and check it before you buy parts.",
    go: "Plan an upgrade",
    to: "/garage/",
  },
  {
    verb: "Simulate",
    body: "The twin drives a test in the Gazebo simulator, and in-browser physics shows whether it stands, tilts or topples.",
    go: "Run the physics checks",
    to: "/robots/turtlebot3-burger/#physics",
  },
];

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
          <h1 className="hero-verbs">
            <span>Build</span>, <span>Fix</span>, <span>Modify</span>,{" "}
            <span>Upgrade</span>, and <span>Simulate</span> your robot
            before you spend a dollar.
          </h1>
          <p className="lede">
            Describe a robot in words, a photo or a parts list. RobotForge
            checks every change, and its simulated twin has to pass a
            driving test before you build or buy anything.
          </p>
          <div className="ctas">
            <Link className="btn btn-primary" href="/garage/">
              Open the app →
            </Link>
            <RunDemoLink className="btn">
              Run the demo
            </RunDemoLink>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            Live AI in the app runs on your account — sign up with an
            email or continue with Meta. The demo needs no account at
            all: one tap opens the app with sample data and recorded
            answers, and it never touches your own robots or parts.
          </p>
          {/* The five verbs from the headline, each a door into the
               part of the app that does it (demo mode for visitors
               with no account). */}
          <ul className="verb-cards">
            {VERBS.map((v) => (
              <li key={v.verb}>
                <RunDemoLink className="verb-card" to={v.to}>
                  <span className="verb">{v.verb}</span>
                  <span className="verb-body">{v.body}</span>
                  <span className="verb-go">{v.go} →</span>
                </RunDemoLink>
              </li>
            ))}
          </ul>
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
          <DemoVideoCard />
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
           Every line below was verified the night it was written —
           Oct 31, 2026 against the served site (bundle fingerprints,
           the endpoint health report, the served pages themselves);
           refreshed Nov 1, 2026 against main's merged code and the
           live endpoint after the accounts, physics, palette and BOM
           merges. If a line stops being true, it comes off this
           page — that is the whole policy. */}
      <section className="band" id="status">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Status</div>
            <h2>What&apos;s live right now.</h2>
            <p>Checked on the served site, Nov 1, 2026.</p>
          </div>
          <div className="ai-cards">
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Wrench, the workshop operator</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                Wrench runs the workshop with you — it is not a tour
                guide. Describe a robot and it drafts the spec with
                Muse Spark; tell it to add a part or change a number
                and it does the work in the chat, every edit previewed
                and checked before it lands. Its answers come from
                recorded data and carry their sources, and when a
                robot fails, Wrench names the check that went over
                and sends the robot to the fix loop.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Accounts</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                Sign up with an email, or continue with Meta — both
                live today, and live AI in the app runs on your
                account. GitHub and Google sign-in join when those
                providers are switched on; their buttons appear on
                the sign-in card by themselves.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Robodex</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                11 catalogued robots plus your own sightings, grouped
                by how they move. Gate badges come only from recorded
                runs — never from a model&apos;s say-so.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Physics checks</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                A robot page can run its real URDF through a physics
                engine in your browser: a mass audit, a stability
                check, and a short drop test — does it stand? Robots
                whose record isn&apos;t a URDF say so, with the
                reason, instead of faking a result.
              </p>
            </article>
            <article className="card ai-card">
              <div className="ai-card-head">
                <h3>Build with parts</h3>
                <span className="fbadge live">LIVE</span>
              </div>
              <p>
                The catalogue&apos;s 50 parts carry datasheet specs
                and vendor search links — no prices are shown,
                because none are verified. Drag parts onto the kit
                stage or add them by chat; the build list feeds a
                BOM wizard that exports a CSV. Every kit part is
                parametric CAD: OpenSCAD on the kit page, with a
                build123d back end in the project&apos;s tooling.
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
            <RunDemoLink className="btn btn-primary" style={{ padding: "14px 22px", fontSize: "var(--fs-md)" }}>
              Run the demo →
            </RunDemoLink>
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
