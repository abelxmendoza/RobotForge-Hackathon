"use client";

import Link from "next/link";
import Term from "@/components/shell/Term";
import { useEffect, useRef, useState } from "react";
import { families, parts, robotSlug, robots } from "@/lib/data";
import { describeSignature } from "@/lib/grouping";
import { MOBILITY_CLASSES } from "./shared";
import { assetPath } from "@/components/home/asset";
import RobotCard from "./RobotCard";
import GroupCard, { gateTally, groupSlug } from "./GroupCard";
import LocalDexSightings from "./LocalDexSightings";
import {
  ROBOT_SOURCE_META,
  ROBOT_SOURCE_ORDER,
  type RobotSource,
} from "@/lib/robotSource";

/* The source tabs answer how RobotForge knows a robot. Inside each source,
   the existing group cards keep the mobility taxonomy intact. Opening a
   group swaps the view to that group's robot grid; the open group lives in
   the URL hash so the view is shareable and Back returns to the group grid. */

function groupFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#group=([a-z0-9-]+)$/);
  if (!m) return null;
  return MOBILITY_CLASSES.find((cls) => groupSlug(cls) === m[1]) ?? null;
}

export default function RobotsIndex() {
  const [activeSource, setActiveSource] = useState<RobotSource>("researched");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groupHeadRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const sync = () => setOpenGroup(groupFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const open = (cls: string) => {
    setOpenGroup(cls);
    window.history.pushState(null, "", `#group=${groupSlug(cls)}`);
    requestAnimationFrame(() => groupHeadRef.current?.focus());
  };
  const close = () => {
    setOpenGroup(null);
    window.history.pushState(null, "", window.location.pathname + window.location.search);
  };

  const selectSource = (source: RobotSource) => {
    setActiveSource(source);
    setOpenGroup(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  };

  const sourceMembers = robots.filter((robot) => robot.source === activeSource);
  const sourceCounts = Object.fromEntries(
    ROBOT_SOURCE_ORDER.map((source) => [
      source,
      robots.filter((robot) => robot.source === source).length,
    ]),
  ) as Record<RobotSource, number>;

  const byClass = new Map<string, typeof robots>();
  for (const cls of MOBILITY_CLASSES) byClass.set(cls, []);
  for (const r of sourceMembers) {
    const m = r.mobility_class ?? "";
    if (byClass.has(m)) byClass.get(m)!.push(r);
  }
  const openMembers = openGroup ? byClass.get(openGroup) ?? [] : [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Robots</div>
          <h1><Term k="robodex">Robodex</Term></h1>
          <p className="lede">
            Every robot RobotForge knows, first sorted by how we know it,
            then shelved by how it moves. Source badges tell you what kind
            of evidence sits behind the entry; gate badges still come only
            from recorded runs.{" "}
            <Link href="/#workflow">How the test works →</Link>
          </p>
        </div>
      </div>

      <div className="tabs source-tabs" role="tablist" aria-label="Robot source">
        {ROBOT_SOURCE_ORDER.map((source) => (
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={activeSource === source}
            key={source}
            onClick={() => selectSource(source)}
          >
            {ROBOT_SOURCE_META[source].label} ({sourceCounts[source]})
          </button>
        ))}
      </div>
      <p className="sub source-summary">
        {ROBOT_SOURCE_META[activeSource].description}
      </p>

      {sourceMembers.length === 0 ? (
        <div className="state-box source-empty" role="tabpanel">
          <h2>No {ROBOT_SOURCE_META[activeSource].label.toLowerCase()} yet</h2>
          {activeSource === "my" ? (
            <p>
              Robots you own live in <Link href="/garage/">My Robots</Link> in
              the Workshop. A future catalog sync can promote them here without
              making private browser data public.
            </p>
          ) : activeSource === "sighted" ? (
            <p>
              Add an in-person sighting with your photo, where and when you saw
              it, and credit for its owner. Measurements stay estimates unless
              the owner let you measure the robot.
            </p>
          ) : (
            <p>
              Start a robot from a 2D image in <Link href="/garage/">My Robots</Link>.
              Photo-only dimensions stay clearly marked as estimated.
            </p>
          )}
        </div>
      ) : openGroup === null ? (
        <div className="group-grid" id="group-grid">
          {MOBILITY_CLASSES.map((cls) => (
            <GroupCard
              key={cls}
              cls={cls}
              members={byClass.get(cls) ?? []}
              onOpen={open}
            />
          ))}
        </div>
      ) : (
        <section aria-label={`${openGroup} robots`}>
          <button className="btn btn-ghost" type="button" onClick={close}>
            ← All groups
          </button>
          <h2
            ref={groupHeadRef}
            tabIndex={-1}
            style={{ marginTop: "var(--s4)" }}
          >
            {openGroup}
          </h2>
          <p className="sub">
            {openMembers.length} robot{openMembers.length === 1 ? "" : "s"}
            {gateTally(openMembers) ? ` — ${gateTally(openMembers)}` : ""}
          </p>
          <div className="robot-grid" id="robot-grid">
            {[...openMembers]
              .sort((a, b) => Number(a.number) - Number(b.number))
              .map((r) => (
                <RobotCard key={r.name} robot={r} />
              ))}
          </div>
        </section>
      )}

      <noscript>
        <div className="robot-grid">
          {[...robots]
            .sort((a, b) => Number(a.number) - Number(b.number))
            .map((r) => (
              <RobotCard key={r.name} robot={r} />
            ))}
        </div>
      </noscript>

      <p className="section-more">
        <Link href="/kit/#parts">Browse the parts catalogue →</Link>{" "}
        <span className="faint">{parts.length} real parts with datasheet specs, and the Burger kit in 3D.</span>
      </p>

      <details className="section fold" id="families">
        <summary><h2>Robot families and your sightings</h2></summary>
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
      </details>
    </>
  );
}
