"use client";

import Link from "next/link";
import Term from "@/components/shell/Term";
import { useEffect, useRef, useState } from "react";
import { parts, robots } from "@/lib/data";
import { MOBILITY_CLASSES } from "./shared";
import RobotCard from "./RobotCard";
import GroupCard, { gateTally, groupSlug } from "./GroupCard";
import {
  BringIntoWorkshop,
  catalogBadgeOverride,
  DEX_SOURCES,
  FiledGarageGrid,
  MyRobotsGrid,
  SightingsGroups,
  SourceBadge,
  useDexSources,
  type DexSource,
} from "./DexSources";
import type { Robot } from "@/lib/types";

/* The Robodex: ONE index, split by how each robot is known
 * (ported from PR #54, folded 2026-11-03): My robots (the Workshop
 * garage — the same list the Workshop shows), Sighted and From
 * photos (sightings, grouped by family and variant inside their
 * tabs), and Researched (the catalog, grouped by mobility class).
 * There is no separate families/sightings section: family +
 * variant grouping lives inside the sighting tabs, and a catalog
 * robot's family context lives on its own record.
 *
 * Filing is automatic first (garage membership, a sighting's
 * recorded place, the photo-draft rule) and the owner's filing
 * overrides (lib/dexOverrides.ts — set through Wrench chat: "move
 * Spot to sighted") are consulted before every automatic rule, in
 * the tabs, the counts and the card badges alike.
 * Opening a Researched group swaps the view to that group's robot
 * grid; the open tab and group live in the URL hash so the view is
 * shareable and Back returns to the group grid. */

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
  return m && DEX_SOURCES.some((s) => s.id === m[1])
    ? (m[1] as DexSource)
    : null;
}

export default function RobotsIndex() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [source, setSource] = useState<DexSource | null>(null);
  const groupHeadRef = useRef<HTMLHeadingElement>(null);
  const dex = useDexSources();
  /* Default tab: My robots when you have any, otherwise Researched. */
  const shown: DexSource =
    source ?? (dex.garageByTab.mine.length || dex.showOmegaSpecimen ? "mine" : "researched");
  const counts: Record<DexSource, number | null> = {
    mine: dex.mine
      ? dex.garageByTab.mine.length + (dex.showOmegaSpecimen ? 1 : 0)
      : null,
    sighted: dex.sightingsByTab.sighted.length + dex.garageByTab.sighted.length,
    photos:
      dex.sightingsByTab.photos.length +
      dex.catalogByTab.photos.length +
      dex.garageByTab.photos.length,
    researched:
      dex.catalogByTab.researched.length + dex.garageByTab.researched.length,
  };
  const pickSource = (id: DexSource) => {
    setSource(id);
    setOpenGroup(null);
    window.history.pushState(null, "", `#source=${id}`);
  };

  useEffect(() => {
    const sync = () => {
      setOpenGroup(groupFromHash());
      setSource(sourceFromHash());
    };
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

  const researchedRobots = dex.catalogByTab.researched;
  const byClass = new Map<string, Robot[]>();
  for (const cls of MOBILITY_CLASSES) byClass.set(cls, []);
  for (const r of researchedRobots) {
    const m = r.mobility_class ?? "";
    if (byClass.has(m)) byClass.get(m)!.push(r);
  }
  const openMembers = openGroup ? byClass.get(openGroup) ?? [] : [];

  /* A catalog card plus its bring-into-Workshop action: the card
   * itself is a link, so the action sits directly under it in the
   * same grid cell. The badge follows the same resolved filing as
   * the tab the card is standing in. */
  const catalogCell = (r: Robot) => (
    <div key={r.name} className="dex-cell">
      <RobotCard robot={r} sourceOverride={catalogBadgeOverride(dex.overrides, r)} />
      <BringIntoWorkshop name={r.name} specFile={r.spec_file} />
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Robots</div>
          <h1><Term k="robodex">Robodex</Term></h1>
          <p className="lede">
            Every robot RobotForge knows, sorted by how we know it. The
            source tells you how far to trust its numbers.{" "}
            <Link href="/#workflow">How the test works →</Link>{" "}
            Know a robot that lives in a GitHub repo?{" "}
            <Link href="/import/">Import the repo →</Link> and it joins your
            Garage as a specimen with the repo attached.
          </p>
        </div>
      </div>

      <div className="dex-tabs" role="tablist" aria-label="Where the robot comes from">
        {DEX_SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={shown === s.id}
            className={"dex-tab src-" + s.id}
            onClick={() => pickSource(s.id)}
          >
            {s.label}
            {counts[s.id] !== null && (
              <span className="dex-count">{counts[s.id]}</span>
            )}
          </button>
        ))}
      </div>
      <p className="dex-blurb">
        <SourceBadge source={shown} />{" "}
        {DEX_SOURCES.find((s) => s.id === shown)!.blurb}
      </p>

      {shown === "mine" ? (
        <MyRobotsGrid mine={dex.mine === null ? null : dex.garageByTab.mine} showSpecimen={dex.showOmegaSpecimen} />
      ) : shown === "sighted" ? (
        <>
          <SightingsGroups
            items={dex.sightingsByTab.sighted}
            source="sighted"
            hasOther={dex.garageByTab.sighted.length > 0}
          />
          <FiledGarageGrid robots={dex.garageByTab.sighted} tab="sighted" />
        </>
      ) : shown === "photos" ? (
        <>
          {dex.catalogByTab.photos.length > 0 && (
            <div className="robot-grid dex-src-grid">
              {dex.catalogByTab.photos.map(catalogCell)}
            </div>
          )}
          <SightingsGroups
            items={dex.sightingsByTab.photos}
            source="photos"
            hasOther={dex.catalogByTab.photos.length > 0 || dex.garageByTab.photos.length > 0}
          />
          <FiledGarageGrid robots={dex.garageByTab.photos} tab="photos" />
        </>
      ) : (
        <>
          <FiledGarageGrid robots={dex.garageByTab.researched} tab="researched" />
          {openGroup === null ? (
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
                  .map(catalogCell)}
              </div>
            </section>
          )}
        </>
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
    </>
  );
}
