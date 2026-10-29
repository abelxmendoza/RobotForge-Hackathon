"use client";

import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { families, parts, robotSlug, robots } from "@/lib/data";
import { describeSignature } from "@/lib/grouping";
import type { AppDispatch, RootState } from "@/store/store";
import { setDrivetrain, setVerdict } from "@/store/catalogSlice";
import { MOBILITY_CLASSES, VERDICT_LABEL, gateStatusOf } from "./shared";
import { assetPath } from "@/components/home/asset";
import RobotCard from "./RobotCard";
import PartsCatalogue from "./PartsCatalogue";
import LocalDexSightings from "./LocalDexSightings";

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
      </div>

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
        <LocalDexSightings />
      </section>

      <section className="section" id="parts">
        <h2>Parts catalogue</h2>
        <p className="sub">
          {parts.length} real parts with datasheet-sourced specs, grouped by
          class. These are what the forge assembles robots from and checks
          parts lists against.
        </p>
        <PartsCatalogue />
      </section>
    </>
  );
}
