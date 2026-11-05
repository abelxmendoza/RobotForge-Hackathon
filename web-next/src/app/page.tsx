import type { Metadata } from "next";
import Link from "next/link";
import RunDemoLink from "@/components/shell/RunDemoLink";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import { AiInsideCards } from "@/components/home/AiInside";
import StatusCards from "@/components/home/StatusCards";
import Term from "@/components/shell/Term";
import { assetPath } from "@/components/home/asset";
import FounderVideo from "@/components/home/FounderVideo";
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
        </div>
      </section>

      {/* ============ WHY I BUILT IT — Abel's own walk-through
           (Nov 4, 2026). Cropped to the screen area at encode time
           (no phone-frame black bars); framed player in FounderVideo. */}
      <section className="band" id="why-video">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">From the builder</div>
            <h2>Why I built RobotForge.</h2>
            <p>
              Abel Mendoza walks through the app in his own words.{" "}
              <a href="#why">Read the story ↓</a>
            </p>
          </div>
          <FounderVideo />
        </div>
      </section>

      {/* ============ FINAL DEMO — Abel's hackathon demo video
           (YouTube), replacing the in-repo trailer render on
           2026-11-04 at his direction. YouTube embed in the same
           #trailer band the hero card scrolls to, so the landing
           still has ONE video player. */}
      <section className="band" id="trailer">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Final demo</div>
            <h2>Watch RobotForge work.</h2>
            <p>
              Abel&apos;s final demo for the Meta Global AI Developer
              Hackathon: the real app, checked specs, Wrench, and the
              evidence behind every verdict.
            </p>
          </div>
          <figure className="hero-art" style={{ marginTop: 0 }}>
            <div className="demo-video-frame">
              <iframe
                src="https://www.youtube-nocookie.com/embed/qHt898yvSjA"
                title="RobotForge final demo — Meta Global AI Developer Hackathon"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
            <figcaption>
              Recorded by Abel Mendoza, Nov 4, 2026 — the live app at
              robot-forge-hackathon.vercel.app. Also the demo video on
              the hackathon submission.
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
          <StatusCards />
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

      {/* ============ WHY I BUILT ROBOTFORGE — the founder's own
           account, in his words (Abel Mendoza, Nov 3, 2026): the
           Titan Rover gaps (CAD, harnessing, remote testing) this
           app exists to close. Photo: Abel's own, from the LoreBook
           About page (lorebookai.com/branding/mePro.JPG). */}
      <section className="band" id="why">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Why I built RobotForge</div>
            <h2>I built the tool I needed on my rover team.</h2>
          </div>
          <div className="why-built">
            <figure className="why-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetPath("assets/img/abel-founder.jpg")}
                width={1024}
                height={1024}
                alt="Abel Mendoza, builder of RobotForge"
              />
              <figcaption>Abel Mendoza — CSUF Titan Rover alumnus, B.S. Computer Science, Cal State Fullerton.</figcaption>
            </figure>
            <div className="why-text">
              <p>
                I built RobotForge because of what I couldn&apos;t do on my
                college rover team.
              </p>
              <p>
                I was on CSUF Titan Rover, and I wanted to help build, not
                just write code. But I didn&apos;t know CAD. We needed
                3D-printed mounts for different components, we wanted an
                enclosure for the wire harness, we wanted to give the
                smaller runt rovers an actual shape — and I didn&apos;t
                know how to model any of it, or how to 3D print it.
              </p>
              <p>
                I didn&apos;t know wire harnessing either, or how the parts
                of a robot actually hook up to each other. I needed a DC
                buck converter and didn&apos;t know why. Someone told me
                about a whole Nvidia Jetson TX2 that got blown out just
                trying to power it. That&apos;s how you learn in robotics
                if nobody checks your work first: by breaking expensive
                parts.
              </p>
              <p>
                And when I worked remote, I couldn&apos;t test anything at
                all. I didn&apos;t have a robot at home, so I couldn&apos;t
                build software for one I couldn&apos;t touch. If I
                wasn&apos;t in the shop, I wasn&apos;t contributing.
              </p>
              <p>
                So I built the tool I needed back then. RobotForge lets
                you describe a robot and generate its parts, its
                3D-printable mounts and enclosures, and its wiring plan —
                with the power math checked, a buck converter added where
                the voltages require one — then program it and test it in
                simulation, all before the robot is in front of you and
                before you&apos;ve spent money on parts that might fry.
              </p>
              <p>
                The AI proposes. RobotForge verifies. You approve.
              </p>
              <p>
                I built this for rover teams and robotics teams like mine:
                people learning as they build, working from wherever they
                are, who can&apos;t afford to learn by breaking hardware.
              </p>
              <p className="why-sign">— Abel Mendoza</p>
            </div>
          </div>
        </div>
      </section>

    </main>
    <LandingFooter />
    <LandingChrome />
    </>
  );
}
