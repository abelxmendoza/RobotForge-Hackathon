"use client";

import type { Robot } from "@/lib/types";
import { robotSlug } from "@/lib/data";
import { VERDICT_LABEL, dexId, gateStatusOf, imgSrc, robotImage } from "./shared";
import RobotPhoto from "./RobotPhoto";

/* Robodex group card (Abel, 2026-10-30): the index opens on a grid of
   group cards — one per mobility class — instead of filter chips.
   Opening a card swaps the view to that group's robot grid. The cover
   is the group's first robot that has an image; the tally counts only
   recorded gate statuses, via the same gateStatusOf helper the robot
   cards badge from. */

const TALLY_ORDER = ["PASS", "MARGINAL", "FAIL", "NOT_GATED"] as const;

export function gateTally(members: Robot[]): string {
  const counts = new Map<string, number>();
  for (const r of members) {
    const st = gateStatusOf(r).status;
    counts.set(st, (counts.get(st) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const st of TALLY_ORDER) {
    const n = counts.get(st) ?? 0;
    if (n > 0) parts.push(`${n} ${VERDICT_LABEL[st].toLowerCase()}`);
  }
  return parts.join(" · ");
}

export function groupSlug(cls: string): string {
  return cls.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function GroupCard({
  cls,
  members,
  onOpen,
}: {
  cls: string;
  members: Robot[];
  onOpen: (cls: string) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="group-card empty" aria-disabled="true">
        <div className="ph ai"></div>
        <div className="body">
          <h3>{cls}</h3>
          <span className="cls">None yet — no robot in the dex moves this way.</span>
        </div>
      </div>
    );
  }

  const sorted = [...members].sort((a, b) => Number(a.number) - Number(b.number));
  const cover = sorted.find((r) => robotImage(r) !== null) ?? sorted[0];
  const img = robotImage(cover);
  const alt = cover.name + (img?.ai ? " (AI concept illustration)" : "");
  const subtypes = [...new Set(sorted.map((r) => r.subtype).filter(Boolean))];
  const tally = gateTally(sorted);

  return (
    <button
      className="group-card"
      type="button"
      data-group={groupSlug(cls)}
      onClick={() => onOpen(cls)}
      aria-label={`Open the ${cls} group, ${sorted.length} robot${sorted.length === 1 ? "" : "s"}`}
    >
      {img ? (
        <div className={img.ai ? "ph ai" : "ph"}>
          <RobotPhoto src={imgSrc(img.src)} alt={alt} slug={robotSlug(cover)} name={cover.name} />
        </div>
      ) : (
        <div className="ph ai"></div>
      )}
      <div className="body">
        <span className="dex">{sorted.map((r) => dexId(r)).join(" · ")}</span>
        <h3>{cls}</h3>
        <span className="cls">
          {sorted.length} robot{sorted.length === 1 ? "" : "s"}
          {subtypes.length ? ` — ${subtypes.join(", ")}` : ""}
        </span>
        {tally ? <span className="tally">{tally}</span> : null}
        <span className="open">Open group →</span>
      </div>
    </button>
  );
}
