import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { assetPath } from "@/components/home/asset";

/**
 * Credits — who and what RobotForge builds on. Every line traces to
 * the repo's own records: the catalogue's per-robot provenance
 * (catalog/robots.json), the parts catalogue's source and
 * price-estimate records (catalog/parts.json), the live endpoint's
 * web and sign-in routes (live/worker.js), the README's "Meta
 * models inside" table, live/README.md, lib/omega1Twin.ts, and the
 * submission package's contributors draft. Acknowledgment, not
 * team membership — the only human contributor is named first.
 *
 * The pictures follow the same rule: the brand logos under
 * assets/img/credits/ are the owners' own marks (Simple Icons,
 * CC0; Freenove's from freenove.com), shown only to say thank
 * you, the part photos in Sources we cite are the catalogue's
 * own files, and the remaining tiles are RobotForge
 * illustrations drawn for this page. The catalogue robots and
 * Omega1 are credited in words — their photos live on the
 * Robodex and the Workshop, and this page does not repeat them.
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "Credits",
  description:
    "The makers, models, workshops and services RobotForge builds on — credited.",
};

/* One logo tile: a brand mark on a light stage (so dark marks
 * stay readable on the app's navy), a white mark like
 * Freenove's on a dark stage, a RobotForge illustration, or a
 * plain wordmark when no mark exists. */
function LogoTile({ logo, art, word, dark, name, note }: {
  logo?: string; art?: string; word?: string; dark?: boolean;
  name: string; note: string;
}) {
  return (
    <figure className="credits-tile">
      {art ? (
        <span className="credits-tile-stage credits-tile-stage--art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetPath(`assets/img/credits/${art}`)} alt="" loading="lazy" />
        </span>
      ) : word ? (
        <span className="credits-tile-stage credits-tile-stage--word">{word}</span>
      ) : (
        <span className={dark ? "credits-tile-stage credits-tile-stage--dark" : "credits-tile-stage"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetPath(`assets/img/credits/${logo}`)} alt={`${name} logo`} loading="lazy" />
        </span>
      )}
      <figcaption>
        <strong>{name}</strong>
        <span>{note}</span>
      </figcaption>
    </figure>
  );
}

export default function CreditsPage() {
  return (
    <AppShell active="credits" gate={false} crumbs={[{ label: "Credits" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fine print</div>
          <h1>Credits</h1>
          <p className="lede">
            RobotForge is a solo project by Abel Mendoza, built for the
            Meta Global AI Developer Hackathon. The people, projects
            and services below are thanked for what RobotForge builds
            on — acknowledgment, not team membership.
          </p>
        </div>
      </div>

      <section className="section">
        <h2>Built by</h2>
        <div className="credits-founder">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetPath("assets/img/abel-founder.jpg")}
              alt="Portrait of Abel Mendoza" loading="lazy" />
          </figure>
          <p>
            Abel Mendoza is the only human contributor: design,
            building, testing, gate runs and the submission. Everyone
            and everything below is credited for what RobotForge builds
            on, not listed as a contributor.
          </p>
        </div>
      </section>

      <section className="section">
        <h2>AI inside</h2>
        <p>
          Muse Spark (Meta) is the model inside RobotForge: it drafts
          robot specs from words and photos, answers in chat, and
          proposes fixes. Its output is labelled with where it came
          from, and it never assigns a pass/fail verdict — the
          deterministic checks decide. In the command-line tools,
          SAM 3.1 cross-checks what Muse Spark saw in a photo against
          segmented regions.
        </p>
        <p>
          Muse Spark — as &ldquo;Torque,&rdquo; Abel&apos;s agent — was
          also the build assistant used during the hackathon for
          research, coding and verification passes.
        </p>
        <div className="credits-tiles">
          <LogoTile logo="logo-meta.svg" name="Meta"
            note="Muse Spark, the model inside, and SAM 3.1" />
          <LogoTile word="Torque" name="Torque"
            note="Muse Spark as Abel's build assistant" />
        </div>
      </section>

      <section className="section">
        <h2>Workshops that shaped the design</h2>
        <p>Three Meta hackathon workshops shaped how RobotForge is built:</p>
        <div className="credits-tiles">
          <LogoTile art="workshop-agents.svg" name="Agents 101"
            note="The agent-loop discipline" />
          <LogoTile art="workshop-verify.svg" name="Agents 102"
            note="Verifiable Agents — deterministic first, judge second" />
          <LogoTile art="workshop-measure.svg" name="Fireworks workshop"
            note="Muse Open Models — measure it, with a fixed corpus" />
        </div>
        <ul className="credits-list">
          <li>
            <strong>Agents 101</strong> — the agent-loop discipline
            behind the Forge&apos;s propose-and-check structure.
          </li>
          <li>
            <strong>Agents 102 — Verifiable Agents</strong> —
            &ldquo;deterministic first, judge second&rdquo;: the model
            proposes, the checks decide.
          </li>
          <li>
            <strong>Building Specialized Intelligence on Fireworks: Muse Open Models</strong>{" "}
            — &ldquo;measure it&rdquo;: the fixed-corpus,
            deterministic-grader method behind the provider
            chain&apos;s measured order.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>The robots in the catalogue</h2>
        <p>
          The Robodex catalogues real robots RobotForge did not
          design. Each entry&apos;s spec was read from its
          maker&apos;s published files, and each robot&apos;s page
          carries its own provenance record and photo credit.
        </p>
        <ul className="credits-list">
          <li><strong>Andino</strong> — Ekumen (open-source ROS 2 robot; official project: Ekumen-OS/andino)</li>
          <li><strong>TurtleBot3 Burger</strong> — ROBOTIS</li>
          <li><strong>TurtleBot3 Waffle Pi</strong> — ROBOTIS</li>
          <li><strong>Pathfinder</strong> — RobotForge&apos;s own reference design, written for this project</li>
          <li><strong>PX4 X500</strong> — the PX4 project (Gazebo model) and Holybro (the X500 V2 kit)</li>
          <li><strong>Crazyflie 2.1</strong> — Bitcraze</li>
          <li><strong>Unitree Go2</strong> — Unitree</li>
          <li><strong>Mini Pupper</strong> — MangDang</li>
          <li><strong>Unitree G1</strong> — Unitree</li>
          <li><strong>ROBOTIS OP3</strong> — ROBOTIS</li>
          <li><strong>OpenManipulator-X</strong> — ROBOTIS</li>
        </ul>
        <p>
          Boston Dynamics Spot is not a catalogue entry: it appears
          as a Spotter sighting, photographed at Cal Poly
          Pomona&apos;s IRLab on October 28, 2026, and matched
          against the Robodex from that photo.
        </p>
      </section>

      <section className="section">
        <h2>Omega1 and its twin</h2>
        <p>
          Omega1 is Abel&apos;s own robot — a Freenove FNK0043 4WD
          Raspberry Pi car. Its digital twin was generated by
          ProjectSim (Kaedim) from a photo on November 1, 2026. The
          twin&apos;s geometry and physics values are model
          estimates, not measurements of the real robot, and they
          are labelled ESTIMATED everywhere they appear.
        </p>
        <div className="credits-tiles">
          <LogoTile logo="logo-freenove.png" dark name="Freenove"
            note="The FNK0043 4WD car kit Omega1 is built from" />
          <LogoTile logo="logo-raspberrypi.svg" name="Raspberry Pi"
            note="Omega1's onboard computer" />
          <LogoTile word="ProjectSim" name="ProjectSim (Kaedim)"
            note="Generated the Omega1 twin from a photo" />
        </div>
      </section>

      <section className="section">
        <h2>Services</h2>
        <p>
          The site is hosted on Vercel, and the live endpoint is a
          Cloudflare Worker. Live answers run on a provider chain —
          Meta&apos;s Muse Spark API and Baseten, with Fireworks as
          a further route when it is switched on.
        </p>
        <p>
          Sign-in runs through the endpoint&apos;s own email
          accounts, or with Google or Meta — both are live sign-in
          routes on the endpoint.
        </p>
        <div className="credits-tiles">
          <LogoTile logo="logo-vercel.svg" name="Vercel"
            note="Hosts this site" />
          <LogoTile logo="logo-cloudflare.svg" name="Cloudflare"
            note="The live endpoint is a Cloudflare Worker" />
          <LogoTile logo="logo-meta.svg" name="Meta"
            note="Muse Spark API and Meta sign-in" />
          <LogoTile logo="logo-google.svg" name="Google"
            note="Google sign-in" />
          <LogoTile art="glyph-baseten.svg" name="Baseten"
            note="First route in the live provider chain" />
          <LogoTile art="glyph-fireworks.svg" name="Fireworks"
            note="A further provider route, when switched on" />
          <LogoTile logo="logo-github.svg" name="GitHub"
            note="Home of the public repository" />
        </div>
      </section>

      <section className="section">
        <h2>Sources we cite</h2>
        <p>
          RobotForge cites what it reads. When a live chat answer
          relies on a web page, the answer names that page. When a
          part, a spec or a price comes from the web, its record
          keeps the source URL and the time it was fetched, so
          anyone can check it — and a web-sourced record stays
          labelled WEB-SOURCED — UNVERIFIED until a datasheet or a
          measurement confirms it.
        </p>
        <div className="credits-cards">
          <figure className="credits-tile">
            <span className="credits-tile-stage credits-tile-stage--art">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetPath("assets/img/credits/glyph-firecrawl.svg")}
                alt="" loading="lazy" />
            </span>
            <figcaption>
              <strong>Firecrawl</strong>
              <span>The web search and page-reading service behind the /web route.</span>
            </figcaption>
          </figure>
          <figure className="credits-tile">
            <span className="credits-tile-stage credits-tile-stage--photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetPath("assets/img/parts/driver_tb6612fng.jpg")}
                alt="The TB6612FNG dual motor driver board" loading="lazy" />
            </span>
            <figcaption>
              <strong>Pololu and Toshiba</strong>
              <span>The TB6612FNG driver&apos;s product page and datasheet — the chip is Toshiba&apos;s, the board photo is the catalogue&apos;s.</span>
            </figcaption>
          </figure>
          <figure className="credits-tile">
            <span className="credits-tile-stage credits-tile-stage--photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetPath("assets/img/parts/pla_filament.jpg")}
                alt="A spool of PLA filament" loading="lazy" />
            </span>
            <figcaption>
              <strong>Polymaker</strong>
              <span>The product pages behind the PLA and PETG filament price estimates.</span>
            </figcaption>
          </figure>
        </div>
        <ul className="credits-list">
          <li>
            <strong>Firecrawl</strong> — the web search and
            page-reading service behind the live endpoint&apos;s
            /web route. It grounds live chat answers in real pages
            and supplies the pages that web-sourced parts and CAD
            proposals are read from; every page it fetches is cited
            where it is used.
          </li>
          <li>
            <strong>Pololu</strong> — the TB6612FNG dual motor
            driver&apos;s product page and datasheet, the source
            for that part&apos;s gathered specs, its photo and its
            price estimate. The TB6612FNG chip itself is made by{" "}
            <strong>Toshiba</strong>.
          </li>
          <li>
            <strong>Polymaker</strong> — the product pages behind
            the catalogue&apos;s PLA and PETG filament price
            estimates. Like every price here, those are fetched,
            dated estimates — never RobotForge&apos;s own prices.
          </li>
        </ul>
        <div className="credits-tiles">
          <LogoTile logo="logo-toshiba.svg" name="Toshiba"
            note="Maker of the TB6612FNG chip" />
        </div>
        <p>
          The catalogue carries its own citations too: each Robodex
          entry names where its spec was read from, each part
          record keeps its source, and robot and part photos are
          credited on their own pages, next to the photo.
        </p>
      </section>

      <section className="section">
        <h2>Open source</h2>
        <p>
          The web app is built on Next.js and React, with Three.js
          for 3D, Rapier for the physics sandbox, and urdf-loader
          for robot models. RobotForge itself is released under
          Apache-2.0.
        </p>
        <div className="credits-tiles">
          <LogoTile logo="logo-nextjs.svg" name="Next.js"
            note="The web app's framework" />
          <LogoTile logo="logo-react.svg" name="React"
            note="The interface library" />
          <LogoTile logo="logo-threejs.svg" name="Three.js"
            note="3D rendering" />
          <LogoTile logo="logo-apache.svg" name="Apache-2.0"
            note="RobotForge's own licence" />
          <LogoTile word="Rapier" name="Rapier"
            note="The physics sandbox" />
          <LogoTile word="urdf-loader" name="urdf-loader"
            note="Loads robot models" />
        </div>
      </section>

      <section className="section">
        <h2>Photos</h2>
        <p>
          Robot and part photos are credited on their own pages,
          next to the photo they belong to.
        </p>
        <p>
          The brand logos on this page are the trademarks of their
          owners, shown only to say thank you; the logo files come
          from Simple Icons (CC0), except Freenove&apos;s, which
          comes from freenove.com. The workshop, provider and
          Firecrawl tiles are illustrations drawn for RobotForge,
          not the companies&apos; own artwork.
        </p>
      </section>
    </AppShell>
  );
}
