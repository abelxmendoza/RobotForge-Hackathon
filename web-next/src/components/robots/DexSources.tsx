"use client";
/* The Robodex split by how each robot is known (Abel, 2026-11-01).
 * The source sets how far to trust a robot's numbers:
 *   My robots   — robots you own, from the Workshop (this browser)
 *   Sighted     — seen in person: a sighting with a place recorded
 *   From photos — known only from a picture: a sighting with no place
 *   Researched  — published specs, URDFs and datasheets (the catalog)
 * Sightings come from catalog/families.json plus the ones saved in this
 * browser from a Forge photo run. Nothing is invented: a sighting is
 * "in person" only when its record names where it was seen. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { families } from "@/lib/data";
import { isPhotoDraft } from "@/lib/robotSource";
import { loadSightings } from "@/lib/grouping";
import { GARAGE_KEY, SOURCE_LABEL, type GarageRobot } from "@/lib/garage";
import { assetPath } from "@/components/home/asset";
import RobotAvatar from "@/components/garage/RobotAvatar";

export type DexSource = "mine" | "sighted" | "photos" | "researched";

export const DEX_SOURCES: { id: DexSource; label: string; badge: string; trust: string; blurb: string }[] = [
  { id: "mine", label: "My robots", badge: "MINE", trust: "YOUR DATA", blurb: "Robots you own, from your Workshop. Guessed numbers keep their amber dot until you measure them." },
  { id: "sighted", label: "Sighted", badge: "SIGHTED", trust: "ESTIMATED", blurb: "Other people's robots you saw in person. Sizes are estimated from your photo." },
  { id: "photos", label: "From photos", badge: "PHOTO", trust: "ESTIMATED", blurb: "Robots known only from a picture. Every dimension is estimated." },
  { id: "researched", label: "Researched", badge: "RESEARCHED", trust: "DOCUMENT-READ", blurb: "Built from published specs, URDFs and datasheets. Gate badges come from recorded runs." },
];

export interface DexSighting { id: string; identity: string; family: string; variant: string; photo: string | null; spottedAt: string | null; where: string | null; dossier: string | null; local: boolean }

export function useDexSources() {
  const [mine, setMine] = useState<GarageRobot[] | null>(null);
  const [sightings, setSightings] = useState<DexSighting[]>(() => catalogSightings());
  useEffect(() => {
    try { setMine(JSON.parse(localStorage.getItem(GARAGE_KEY) || "[]")); } catch { setMine([]); }
    const local: DexSighting[] = loadSightings().map((e) => ({
      id: "local-" + e.sighting.id, identity: e.sighting.identity, family: e.grouping.familyName, variant: e.grouping.variantLabel,
      photo: null, spottedAt: e.sighting.spotted_at || null, where: e.sighting.where || null, dossier: null, local: true,
    }));
    setSightings([...catalogSightings(), ...local]);
  }, []);
  return {
    mine,
    sighted: sightings.filter((s) => s.where),
    photos: sightings.filter((s) => !s.where),
  };
}

function catalogSightings(): DexSighting[] {
  return families.flatMap((f) => f.variants.flatMap((v) => v.sightings.map((s) => ({
    id: s.id, identity: s.identity, family: f.name, variant: v.label,
    photo: s.photo ? String(s.photo) : null, spottedAt: s.spotted_at ? String(s.spotted_at) : null,
    where: s.where ? String(s.where) : null, dossier: typeof s.dossier === "string" ? s.dossier : null, local: false,
  }))));
}

/* The photo-draft rule lives in lib/robotSource (isPhotoDraft,
 * imported above): a catalog robot whose own record says its spec
 * is a photo draft belongs with the photo robots, not Researched —
 * and its card badge reads the same way, from the same helper.
 * Re-exported so existing imports from this module keep working. */
export { isPhotoDraft };

export function SourceBadge({ source }: { source: DexSource }) {
  const s = DEX_SOURCES.find((x) => x.id === source)!;
  return <span className={"dex-src src-" + source} title={`${s.label}: numbers are ${s.trust}`}>{s.badge}<span className="dex-trust">{s.trust}</span></span>;
}

export function MyRobotsGrid({ mine }: { mine: GarageRobot[] | null }) {
  if (mine === null) return <p className="faint">Checking your Workshop…</p>;
  if (!mine.length) return (
    <div className="dex-empty">
      <p><strong>No robots of your own yet.</strong> Bring one into the Workshop from a photo, a spec file or the Robodex.</p>
      <Link className="btn btn-primary btn-sm" href="/garage/">Open the Workshop</Link>
    </div>
  );
  return (
    <div className="robot-grid dex-src-grid">
      {mine.map((r) => {
        const latest = r.versions[r.versions.length - 1];
        return (
          <Link key={r.id} className="robot-card dex-mine" href="/garage/">
            <div className="ph dex-ph"><RobotAvatar names={[r.name, String(latest?.spec?.name ?? "")]} size={96} /></div>
            <div className="body">
              <h3>{r.name}</h3>
              <span className="cls">{r.versions.length} version{r.versions.length === 1 ? "" : "s"} · {latest ? SOURCE_LABEL[latest.source] : ""}</span>
              <SourceBadge source="mine" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function SightingsGrid({ items, source, hasOther = false }: { items: DexSighting[]; source: "sighted" | "photos"; hasOther?: boolean }) {
  if (!items.length && hasOther) return null;
  if (!items.length) return (
    <div className="dex-empty">
      <p><strong>{source === "sighted" ? "No in-person sightings yet." : "No photo-only robots yet."}</strong>{" "}
        {source === "sighted" ? "Saw a robot at a meetup or lab? Snap it in the Workshop and note where you saw it." : "Drop a robot picture into Wrench and add it to your dex."}</p>
      <Link className="btn btn-sm" href="/garage/">Open the Workshop</Link>
    </div>
  );
  return (
    <div className="robot-grid dex-src-grid">
      {items.map((s) => (
        <article key={s.id} className="robot-card dex-sighting">
          <div className="ph">
            {s.photo
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={assetPath(s.photo)} alt={`Photo of ${s.identity}`} loading="lazy" />
              : <div className="dex-ph"><RobotAvatar names={[s.identity]} size={96} /></div>}
          </div>
          <div className="body">
            <h3>{s.identity}</h3>
            <span className="cls">{s.variant !== s.identity ? s.variant : s.family}</span>
            {(s.where || s.spottedAt) && <span className="dex-where">{[s.where, s.spottedAt].filter(Boolean).join(" · ")}</span>}
            <SourceBadge source={source} />
            {s.local && <span className="faint dex-local">Saved in this browser</span>}
          </div>
        </article>
      ))}
    </div>
  );
}
