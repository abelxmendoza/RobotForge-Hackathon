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
import { DEX_SOURCES, isPhotoDraft, MyRobotsGrid, SightingsGrid, SourceBadge, useDexSources, type DexSource } from "./DexSources";

const researched = robots.filter((r) => !isPhotoDraft(r));
const photoRobots = robots.filter(isPhotoDraft);

/* Robodex index (Abel, 2026-10-30): no filter chips. The index opens
   on a grid of group cards — one per mobility class, in taxonomy
   order — and opening a card swaps the view to that group's robot
   grid. The open group lives in the URL hash (#group=legged) so a
   group view is shareable and the browser Back button returns to
   the groups grid. Gate verdicts are not a filter anymore; they stay
   as the badge on each robot card and the tally on each group card. */

function groupFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#group=([a-z0-9-]+)$/);
  if (!m) return null;
  return MOBILITY_CLASSES.find((cls) => groupSlug(cls) === m[1]) ?? null;
}

function sourceFromHash(): DexSource | null {
  if (typeof window === "undefined") return null;
  if (/^#group=/.test(window.location.hash)) return "researched";
  const m = window.location.hash.match(/^#source=([a-z]+)$/);
  return m && DEX_SOURCES.some((s) => s.id === m[1]) ? (m[1] as DexSource) : null;
}

export default function RobotsIndex() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [source, setSource] = useState<DexSource | null>(null);
  const groupHeadRef = useRef<HTMLHeadingElement>(null);
  const dex = useDexSources();
  /* Default tab: My robots when you have any, otherwise Researched. */
  const shown: DexSource = source ?? (dex.mine && dex.mine.length ? "mine" : "researched");
  const counts: Record<DexSource, number | null> = {
    mine: dex.mine ? dex.mine.length : null, sighted: dex.sighted.length, photos: dex.photos.length + photoRobots.length, researched: researched.length,
  };
  const pickSource = (id: DexSource) => {
    setSource(id); setOpenGroup(null);
    window.history.pushState(null, "", `#source=${id}`);
  };

  useEffect(() => {
    const sync = () => { setOpenGroup(groupFromHash()); setSource(sourceFromHash()); };
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

  const byClass = new Map<string, typeof robots>();
  for (const cls of MOBILITY_CLASSES) byClass.set(cls, []);
  for (const r of researched) {
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
            Every robot RobotForge knows, sorted by how we know it. The
            source tells you how far to trust its numbers.{" "}
            <Link href="/#workflow">How the test works →</Link>
          </p>
        </div>
      </div>

      <div className="dex-tabs" role="tablist" aria-label="Where the robot comes from">
        {DEX_SOURCES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={shown === s.id} className={"dex-tab src-" + s.id} onClick={() => pickSource(s.id)}>
            {s.label}{counts[s.id] !== null && <span className="dex-count">{counts[s.id]}</span>}
          </button>
        ))}
      </div>
      <p className="dex-blurb"><SourceBadge source={shown} /> {DEX_SOURCES.find((s) => s.id === shown)!.blurb}</p>

      {shown === "mine" ? <MyRobotsGrid mine={dex.mine} />
        : shown === "sighted" ? <SightingsGrid items={dex.sighted} source="sighted" />
        : shown === "photos" ? <>
            {photoRobots.length > 0 && <div className="robot-grid dex-src-grid">{photoRobots.map((r) => <RobotCard key={r.name} robot={r} />)}</div>}
            <SightingsGrid items={dex.photos} source="photos" hasOther={photoRobots.length > 0} />
          </>
        : openGroup === null ? (
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
