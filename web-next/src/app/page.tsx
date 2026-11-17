import type { Metadata } from "next";
import Link from "next/link";
import RunDemoLink from "@/components/shell/RunDemoLink";
import { robots } from "@/lib/data";
import RobotCard from "@/components/home/RobotCard";
import Term from "@/components/shell/Term";
import { assetPath } from "@/components/home/asset";
import FounderVideo from "@/components/home/FounderVideo";
import SampleSpotlight from "@/components/home/SampleSpotlight";
import { WRENCH_ART } from "@/lib/wrenchArt";
import WrenchBot from "@/components/chat/WrenchBot";
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
 *
 * Simplify pass (2026-11-17, Abel: too many words): the landing is
 * one path for a new visitor — hero with Run the demo, the Omega1
 * sample, the five verbs, the demo video, Wrench, the Robodex row and
 * Abel's story with his walk-through video. The driving test, the
 * recorded runs, the capability list and the status cards moved to
 * /how-it-works/ (components/home/DrivingTest.tsx); still told once.
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
    body: "From words, a photo or a parts list, in 3D.",
    go: "Open the build bench",
    to: "/garage/#tab=build",
  },
  {
    verb: "Fix",
    body: "The checks find the problem. The fix must pass too.",
    go: "Watch a broken robot get fixed",
    to: "/demo/",
  },
  {
    verb: "Modify",
    body: "Swap a wheel, motor or battery. Every edit is rechecked.",
    go: "Edit the spec",
    to: "/garage/#tab=specs",
  },
  {
    verb: "Upgrade",
    body: "Save it as a version and check it before you buy.",
    go: "Plan an upgrade",
    to: "/garage/",
  },
  {
    verb: "Simulate",
    body: "Drive the twin and see if it stands, tilts or topples.",
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
            Describe it in words, a photo or a parts list. RobotForge
            checks every change in a simulated twin first.
          </p>
          {/* One path for a new visitor (simplify pass, 2026-11-17):
           * run the demo with no account, or open your own Workshop. */}
          <div className="ctas">
            <RunDemoLink className="btn btn-primary">Run the demo, no sign-up →</RunDemoLink>
            <Link className="btn" href="/garage/">Open my Workshop</Link>
          </div>
          {/* The Omega1 sample, one click from the landing. */}
          <SampleSpotlight />
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
        </div>
      </section>

      {/* ============ MEET WRENCH — the robot AI in RobotForge
           (Abel's character design, adopted Nov 4, 2026). His own
           words from the character sheet; the same face answers in
           the app's chat, badged with his pass/fail heads on gate
           verdicts. Drawn and animated in components/chat/WrenchBot
           (Nov 5) — the same character as the chat composer. */}
      <section className="band wrench-section" id="wrench">
        <div className="wrap">
          <div className="wrench-band">
            <div className="wrench-stage">
              <WrenchBot
                pose="full"
                mood="ready"
                className="wrench-hero-bot"
                title="Wrench, the RobotForge robot AI: a small white robot with a wrench on his head, a torque power wrench for a right hand, giving a thumbs up"
              />
            </div>
            <div>
              <div className="section-head">
                <div className="eyebrow">The robot AI in RobotForge</div>
                <h2>Meet Wrench</h2>
              </div>
              <blockquote className="wrench-quote">
                I&rsquo;m Wrench — your robotics co-pilot. I turn your ideas
                into tested robot designs, spot problems, and suggest fixes.
              </blockquote>
              <ul className="wrench-poses">
                <li>
                  <WrenchBot pose="design" title="Wrench designing a rover on a hologram" />
                  <span>Design</span>
                </li>
                <li>
                  <WrenchBot pose="simulate" title="Wrench running a simulation on a laptop" />
                  <span>Simulate</span>
                </li>
                <li>
                  <WrenchBot pose="report" title="Wrench holding a passed test report" />
                  <span>Report &amp; fix</span>
                </li>
              </ul>
              <div className="ctas">
                <Link className="btn btn-primary" href="/garage/#wrench">
                  Talk to Wrench →
                </Link>
                <a className="btn" href={WRENCH_ART.poster} target="_blank" rel="noreferrer">
                  Wrench&rsquo;s character sheet
                </a>
              </div>
            </div>
          </div>
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
              Abel&apos;s hackathon demo, recorded Nov 4, 2026.{" "}
              <Link href="/how-it-works/">How the driving test works →</Link>
            </figcaption>
          </figure>
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
          <div id="why-video">
            <FounderVideo />
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
