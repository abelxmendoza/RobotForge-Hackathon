"use client";

import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { stashSpotPhoto } from "@/lib/spot";
import { families, parts, robotSlug, robots } from "@/lib/data";
import { firstSentence } from "@/lib/excerpt";
import { describeSignature } from "@/lib/grouping";
import type { AppDispatch, RootState } from "@/store/store";
import { setDrivetrain, setVerdict } from "@/store/catalogSlice";
import { MOBILITY_CLASSES, VERDICT_LABEL, gateStatusOf } from "./shared";
import { assetPath } from "@/components/home/asset";
import RobotCard from "./RobotCard";
import PartsCatalogue from "./PartsCatalogue";
import LocalDexSightings from "./LocalDexSightings";
import LocalDexParts from "./LocalDexParts";

/* render_robots_index + robots.js: verdict chips and class chips are
   independent filters — a card shows only when it matches both. The
   Redux catalog slice holds the two filters (verdict, and the class
   filter the slice calls drivetrain) and the parts search query. */

const VERDICT_ORDER = ["PASS", "FAIL", "NOT_GATED"] as const;

/* The illustration strip is fixed in the vanilla generator: the four
   RobotForge-drawn robots, in dex order. */
const DEX_STRIP = [
  { file: "andino.svg", name: "Andino", dex: "#001" },
  { file: "turtlebot3-burger.svg", name: "TurtleBot3 Burger", dex: "#002" },
  { file: "turtlebot3-waffle-pi.svg", name: "TurtleBot3 Waffle Pi", dex: "#003" },
  { file: "pathfinder.svg", name: "Pathfinder", dex: "#004" },
];

export default function RobotsIndex() {
  const dispatch = useDispatch<AppDispatch>();
  const verdict = useSelector((s: RootState) => s.catalog.verdict);
  const mobility = useSelector((s: RootState) => s.catalog.drivetrain);
  const router = useRouter();
  const spotRef = useRef<HTMLInputElement>(null);

  /* "Spot a robot": capture here, draft in the Forge. The photo is
   * stashed in sessionStorage (lib/spot.ts) and the Forge thread
   * picks it up on mount — one flow, no second implementation. */
  const onSpotPhoto = async (file: File | null) => {
    if (!file) return;
    await stashSpotPhoto(file);
    router.push("/forge/");
  };

  const counts: Record<string, number> = { PASS: 0, FAIL: 0, NOT_GATED: 0 };
  for (const r of robots) {
    const st = gateStatusOf(r).status;
    if (st in counts) counts[st] += 1;
  }
  const classCounts = new Map<string, number>();
  for (const r of robots) {
    const m = r.mobility_class ?? "";
    classCounts.set(m, (classCounts.get(m) ?? 0) + 1);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Robots</div>
          <h1>Robodex</h1>
          <p className="lede">
            Every robot the forge knows, numbered in the order it learned them.
            Badges come only from recorded gate runs. A robot with no run says
            so in grey.
          </p>
        </div>
        <div className="spot-cta">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => spotRef.current?.click()}
          >
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
              <circle cx="12" cy="13.5" r="3.5" />
            </svg>
            Spot a robot
          </button>
          <p className="faint">
            Take a photo — the Forge drafts it and the sighting files into
            your dex below.
          </p>
          <input
            type="file"
            ref={spotRef}
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              e.target.value = "";
              void onSpotPhoto(f);
            }}
          />
        </div>
      </div>

      <div className="toolbar seg-nav" role="group" aria-label="On this page">
        <a className="chip" href="#robodex">Robodex</a>
        <a className="chip" href="#parts">Parts</a>
        <a className="chip" href="#sightings">My sightings</a>
      </div>

      <section id="robodex" className="seg">
      <article className="card sample-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetPath("examples/spotter/spot-cpp/spotted-photo.jpg")}
            alt="Boston Dynamics Spot photographed at the Cal Poly Pomona IRLab"
            loading="lazy"
            style={{ width: 220, maxWidth: "60vw", borderRadius: 8, display: "block" }}
          />
          <div style={{ flex: "1 1 320px" }}>
            <div className="eyebrow">The sample workflow</div>
            <h3 style={{ marginTop: 6 }}>
              Boston Dynamics Spot — the Robodex sample
            </h3>
            <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Spotted by Abel at the Cal Poly Pomona IRLab on
              2026-10-28 and filed as sighting <strong>spot-cpp</strong>{" "}
              (in the family below). This is the worked example the
              whole pipeline is demonstrated on — follow it end to end:
              the raw sighting and its photo-estimated dossier, a
              curated spec built from published figures, a take-apart
              with All / Model-only / Harness-only focus, a guided
              Jetson + LiDAR modification whose validation is a
              recorded engine report, and an honestly-labelled ROADMAP
              where its simulation would go.
            </p>
            <nav className="jump" aria-label="The Spot sample path" style={{ marginTop: 10 }}>
              <a className="chip" href="#families">1 · Spotted</a>
              <Link className="chip" href="/robots/boston-dynamics-spot/#spec">2 · Curated spec</Link>
              <Link className="chip" href="/robots/boston-dynamics-spot/#take-apart">3 · Take it apart</Link>
              <Link className="chip" href="/robots/boston-dynamics-spot/#modification">4 · Modify it</Link>
              <Link className="chip" href="/robots/boston-dynamics-spot/#simulate">5 · Simulate — roadmap</Link>
            </nav>
          </div>
        </div>
      </article>
      <div className="toolbar" role="group" aria-label="Filter by verdict">
        <button
          className="chip" type="button" data-filter="all"
          aria-pressed={verdict === "all"}
          onClick={() => dispatch(setVerdict("all"))}
        >
          All ({robots.length})
        </button>
        {VERDICT_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <button
            key={s}
            className="chip" type="button" data-filter={s}
            aria-pressed={verdict === s}
            onClick={() => dispatch(setVerdict(s))}
          >
            {VERDICT_LABEL[s]} ({counts[s]})
          </button>
        ))}
      </div>

      <div className="toolbar" role="group" aria-label="Filter by class">
        <button
          className="chip" type="button" data-cfilter="all"
          aria-pressed={mobility === "all"}
          onClick={() => dispatch(setDrivetrain("all"))}
        >
          All classes ({robots.length})
        </button>
        {MOBILITY_CLASSES.map((cls) => {
          const n = classCounts.get(cls) ?? 0;
          return n > 0 ? (
            <button
              key={cls}
              className="chip" type="button" data-cfilter={cls}
              aria-pressed={mobility === cls}
              onClick={() => dispatch(setDrivetrain(cls))}
            >
              {cls} ({n})
            </button>
          ) : (
            <button
              key={cls}
              className="chip" type="button" data-cfilter={cls}
              aria-pressed="false" disabled
            >
              {cls} — none yet
            </button>
          );
        })}
      </div>

      <div className="robot-grid" id="robot-grid">
        {robots.map((r) => {
          const st = gateStatusOf(r).status;
          const hidden =
            (verdict !== "all" && st !== verdict) ||
            (mobility !== "all" && (r.mobility_class ?? "") !== mobility);
          return <RobotCard key={r.name} robot={r} hidden={hidden} />;
        })}
      </div>

      <div className="dex-strip" aria-label="Robot illustrations">
        {DEX_STRIP.map((d) => (
          <figure key={d.file}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetPath(`assets/img/illustrations/${d.file}`)}
              alt={`Illustration of ${d.name}`}
              loading="lazy"
            />
            <figcaption>{d.dex} {d.name}</figcaption>
          </figure>
        ))}
      </div>
      <p className="sub">
        RobotForge illustrations — drawn for this index; photos and gate badges
        live on each robot&apos;s page.
      </p>
      <p>
        <Link href="/kit/">
          <strong>Take it apart in 3D &rarr;</strong> orbit, explode and export
          the Burger kit as parametric CAD
        </Link>
      </p>

      <section className="section" id="families">
        <h2>Robodex families — grouped sightings</h2>
        <p className="sub">
          The same robot turns up in different configurations, so the dex
          groups sightings by family, then by variant: a variant is told
          apart by its signature — whether an arm is fitted, what sits on
          top, and how it moves. A sighting that matches no variant starts
          a new one; a robot that matches no family starts a new family.
        </p>
        {families.map((family) => {
          const dexNum = family.catalog_dex_id
            ? Number(String(family.catalog_dex_id).replace(/[^0-9]/g, ""))
            : NaN;
          const dexRobot = Number.isFinite(dexNum)
            ? robots.find((r) => Number(r.number) === dexNum)
            : undefined;
          return (
            <article
              className="card"
              key={family.id}
              style={{ padding: "4px 20px", marginTop: 16 }}
            >
              <h3>
                {family.name}{" "}
                {family.catalog_dex_id ? (
                  dexRobot ? (
                    <Link
                      href={`/robots/${robotSlug(dexRobot)}/`}
                      className="faint"
                      style={{ fontSize: "var(--fs-sm)" }}
                    >
                      Robodex {family.catalog_dex_id}
                    </Link>
                  ) : (
                    <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                      Robodex {family.catalog_dex_id}
                    </span>
                  )
                ) : null}
              </h3>
              {family.credit ? <p className="sub">{family.credit}</p> : null}
              {/* Wave 6: when the family resolves to a Robodex entry,
                  say what that robot is — the first sentence of its
                  recorded description. Families with no dex entry
                  stay plain rather than padded. */}
              {dexRobot ? (
                <p
                  className="max-w-[72ch] text-sm leading-relaxed text-dim"
                  style={{ marginTop: 4 }}
                >
                  {firstSentence(dexRobot.description)}
                </p>
              ) : null}
              {family.variants.map((variant) => (
                <div key={variant.label} style={{ margin: "14px 0 14px 12px" }}>
                  <h4 style={{ margin: "0 0 4px" }}>{variant.label}</h4>
                  <p className="faint" style={{ margin: "0 0 8px" }}>
                    {describeSignature(variant.signature)}
                  </p>
                  {variant.sightings.length ? (
                    <ul className="items rows">
                      {variant.sightings.map((s) => (
                        <li key={s.id}>
                          {s.photo ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={assetPath(s.photo)}
                              alt={`Photo of ${s.identity}`}
                              loading="lazy"
                              style={{
                                width: 160,
                                maxWidth: "40vw",
                                display: "block",
                                marginBottom: 6,
                              }}
                            />
                          ) : null}
                          <strong>{s.identity}</strong>
                          {s.spotted_at ? (
                            <span className="faint"> — spotted {s.spotted_at}</span>
                          ) : null}
                          {s.where ? (
                            <span className="faint"> · {s.where}</span>
                          ) : null}
                          {typeof s.dossier === "string" ? (
                            <>
                              {" "}
                              <a href={assetPath(s.dossier)}>Dossier</a>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="faint">No sightings filed yet.</p>
                  )}
                </div>
              ))}
            </article>
          );
        })}
      </section>
      </section>

      <section className="section seg" id="parts">
        <h2>Parts catalogue</h2>
        <p className="sub">
          {parts.length} real parts with datasheet-sourced specs, grouped by
          class. These are what the forge assembles robots from and checks
          parts lists against.
        </p>
        <PartsCatalogue />
        <LocalDexParts />
      </section>

      <section className="section seg" id="sightings">
        <h2>My sightings</h2>
        <p className="sub">
          Robots you have spotted from a photo and filed, grouped by family
          and variant the same way as the dex above — and badged as yours.
        </p>
        <LocalDexSightings />
      </section>
    </>
  );
}
