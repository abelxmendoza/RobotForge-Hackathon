"use client";

import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { parts, robots } from "@/lib/data";
import type { AppDispatch, RootState } from "@/store/store";
import { setDrivetrain, setVerdict } from "@/store/catalogSlice";
import { MOBILITY_CLASSES, VERDICT_LABEL, gateStatusOf } from "./shared";
import { assetPath } from "@/components/home/asset";
import RobotCard from "./RobotCard";
import PartsCatalogue from "./PartsCatalogue";

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
