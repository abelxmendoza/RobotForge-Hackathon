"use client";
/* The Robodex split by how each robot is known (Abel, 2026-11-01;
 * folded into ONE Robodex, 2026-11-03). The source sets how far to
 * trust a robot's numbers:
 *   My robots   — robots you own, from the Workshop (this browser)
 *   Sighted     — seen in person: a sighting with a place recorded
 *   From photos — known only from a picture: a sighting with no place
 *   Researched  — published specs, URDFs and datasheets (the catalog)
 *
 * There is no separate families/sightings section any more: family
 * and variant grouping IS how sightings are presented inside the
 * Sighted and From photos tabs (SightingsGroups below), and the
 * browser-saved sightings from Forge photo runs land in those same
 * grids. Filing is automatic first — garage membership, a
 * sighting's recorded place, the photo-draft rule — and the
 * owner's overrides (lib/dexOverrides.ts, set through Wrench chat)
 * are consulted before every automatic rule.
 *
 * My robots parity (Abel, 2026-11-03; tightened 2026-11-04): this
 * tab reads the SAME Garage store the Workshop reads, through the
 * same reactive useStore, with the same archived-records filter —
 * and nothing else. The built-in Omega1 specimen is hidden in the
 * Workshop, so it is hidden here too: Omega1 shows under My robots
 * only once it is in your Workshop. Each of your cards carries a
 * Delete that removes the robot from the Workshop the same way the
 * Workshop's own Delete does; catalog and sighting cards never get
 * one, because they are not yours. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { families, robots } from "@/lib/data";
import { isPhotoDraft } from "@/lib/robotSource";
import { describeSignature, loadSightings } from "@/lib/grouping";
import type { DexSignature } from "@/lib/types";
import { GARAGE_KEY, SOURCE_LABEL, type GarageRobot, type Spec } from "@/lib/garage";
import { activeRecords } from "@/lib/lifecycle";
import { readStore, uid, useStore, writeStore } from "@/lib/store";
import {
  DEX_OVERRIDES_KEY,
  dexKey,
  dexTabToRobotSource,
  garageKey,
  sightingKey,
  type DexOverrides,
  type DexTab,
} from "@/lib/dexOverrides";
import { buildDexEntry } from "@/lib/saveRobot";
import { recordSnapshot } from "@/lib/lifecycle";
import { deleteRobotInStore } from "@/lib/robotLifecycleRepository";
import { forgetRobotScans } from "@/lib/scanStore";
import { forgetRobotNotes } from "@/lib/robotNotes";
import { assetPath } from "@/components/home/asset";
import RobotAvatar from "@/components/garage/RobotAvatar";
import type { Robot } from "@/lib/types";

export type DexSource = DexTab;

export const DEX_SOURCES: { id: DexSource; label: string; badge: string; trust: string; blurb: string }[] = [
  { id: "mine", label: "My robots", badge: "MINE", trust: "YOUR DATA", blurb: "Robots you own, from your Workshop. Guessed numbers keep their amber dot until you measure them." },
  { id: "sighted", label: "Sighted", badge: "SIGHTED", trust: "ESTIMATED", blurb: "Other people's robots you saw in person. Sizes are estimated from your photo." },
  { id: "photos", label: "From photos", badge: "PHOTO", trust: "ESTIMATED", blurb: "Robots known only from a picture. Every dimension is estimated." },
  { id: "researched", label: "Researched", badge: "RESEARCHED", trust: "DOCUMENT-READ", blurb: "Built from published specs, URDFs and datasheets. Gate badges come from recorded runs." },
];

/* A sighting as the tabs present it: its family + variant grouping
 * travels with it (the grouping replaced the old families fold),
 * along with the variant signature and the dossier's draft spec
 * when the sighting carries one (the spec a bring-into-Workshop
 * can faithfully save — never an invented one). */
export interface DexSighting {
  id: string;
  identity: string;
  family: string;
  variant: string;
  signature: DexSignature | null;
  photo: string | null;
  spottedAt: string | null;
  where: string | null;
  dossier: string | null;
  draftSpec: Spec | null;
  local: boolean;
}

/* Catalog dossiers record the spec as `draft_spec`; sightings saved in
 * this browser store the Forge's PhotoDraft itself, whose spec is
 * `spec`. Either one is the recorded spec. */
function draftSpecOf(dossier: unknown): Spec | null {
  if (!dossier || typeof dossier !== "object") return null;
  const d = dossier as { draft_spec?: unknown; spec?: unknown };
  const spec = d.draft_spec ?? d.spec;
  return spec && typeof spec === "object" && !Array.isArray(spec)
    ? (spec as Spec)
    : null;
}

function catalogSightings(): DexSighting[] {
  return families.flatMap((f) => f.variants.flatMap((v) => v.sightings.map((s) => ({
    id: s.id, identity: s.identity, family: f.name, variant: v.label,
    signature: v.signature ?? null,
    photo: s.photo ? String(s.photo) : null, spottedAt: s.spotted_at ? String(s.spotted_at) : null,
    where: s.where ? String(s.where) : null, dossier: typeof s.dossier === "string" ? s.dossier : null,
    draftSpec: draftSpecOf(s.dossier), local: false,
  }))));
}

/* Every sighting the Robodex knows, catalog + browser-saved —
 * the same list Wrench chat resolves filing commands against, so
 * a name means the same robot in chat and on this page. */
export function allDexSightings(): DexSighting[] {
  return [...catalogSightings(), ...localSightings()];
}

function localSightings(): DexSighting[] {
  return loadSightings().map((e) => ({
    id: "local-" + e.sighting.id, identity: e.sighting.identity, family: e.grouping.familyName, variant: e.grouping.variantLabel,
    signature: null,
    photo: null, spottedAt: e.sighting.spotted_at || null, where: e.sighting.where || null, dossier: null,
    draftSpec: draftSpecOf(e.sighting.dossier), local: true,
  }));
}

/* Owner notes for sightings whose record alone doesn't say whose
 * robot it is. spot-cpp is Cal Poly Pomona IRLab's robotics club
 * Spot — Abel photographed it there; it is not his robot, and the
 * card says so wherever it appears. */
const SIGHTING_OWNER_NOTES: Record<string, string> = {
  "spot-cpp": "Cal Poly Pomona IRLab's robotics club robot — spotted there in person. Not your robot.",
};

export interface DexModel {
  /* The Workshop's list, exactly: active Garage records read
   * reactively, or null until the store has been read. */
  mine: GarageRobot[] | null;
  sightings: DexSighting[];
  overrides: DexOverrides;
  /* Resolved filings — overrides first, automatic rules second. */
  catalogTab: (robot: Robot) => DexTab;
  sightingTab: (s: DexSighting) => DexTab;
  garageTab: (r: GarageRobot) => DexTab;
  catalogByTab: Record<DexTab, Robot[]>;
  sightingsByTab: Record<DexTab, DexSighting[]>;
  garageByTab: Record<DexTab, GarageRobot[]>;
}

export function useDexSources(): DexModel {
  const [garageRaw, , garageReady] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const [overrides] = useStore<DexOverrides>(DEX_OVERRIDES_KEY, {});
  /* Catalog sightings are static data; the browser-saved ones live
   * in localStorage, so they join after mount (the same pattern
   * this hook always used — first paint matches the static export). */
  const [sightings, setSightings] = useState<DexSighting[]>(() => catalogSightings());
  useEffect(() => {
    setSightings(allDexSightings());
  }, []);

  const stored = garageRaw ?? [];
  const mine = garageReady ? activeRecords(stored) : null;

  const catalogTab = (robot: Robot): DexTab =>
    overrides[dexKey(robot)] ?? (isPhotoDraft(robot) ? "photos" : "researched");
  const sightingTab = (s: DexSighting): DexTab =>
    overrides[sightingKey(s.id)] ?? (s.where ? "sighted" : "photos");
  const garageTab = (r: GarageRobot): DexTab =>
    overrides[garageKey(r.id)] ?? "mine";

  const catalogByTab: Record<DexTab, Robot[]> = { mine: [], sighted: [], photos: [], researched: [] };
  for (const r of robots) catalogByTab[catalogTab(r)].push(r);
  const sightingsByTab: Record<DexTab, DexSighting[]> = { mine: [], sighted: [], photos: [], researched: [] };
  for (const s of sightings) sightingsByTab[sightingTab(s)].push(s);
  const garageByTab: Record<DexTab, GarageRobot[]> = { mine: [], sighted: [], photos: [], researched: [] };
  for (const r of mine ?? []) garageByTab[garageTab(r)].push(r);

  return {
    mine, sightings, overrides,
    catalogTab, sightingTab, garageTab,
    catalogByTab, sightingsByTab, garageByTab,
  };
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

/* ---- bring into the Workshop ------------------------------------
 * One action, on every Robodex card: catalog robots save their
 * recorded Robodex spec, sightings save the draft spec their
 * dossier recorded — both through the SAME construction the chat
 * save flow uses (lib/saveRobot buildDexEntry for catalog robots;
 * the same Baseline-entry shape for sightings, with photo
 * provenance). A robot with no recorded spec gets no invented
 * entry: the card says so and points at the Workshop's photo/spec
 * import instead. Repeat taps never duplicate: a Garage entry
 * with the robot's name already there is "in your Workshop". */
export function BringIntoWorkshop({ name, specFile, draftSpec }: {
  name: string;
  specFile?: string | null;
  draftSpec?: Spec | null;
}) {
  const [garage] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const existing = (garage ?? []).find(
    (r) => r.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return (
      <span className="dex-bring">
        <Link className="btn btn-sm" href="/garage/">In your Workshop ✓</Link>
      </span>
    );
  }
  if (!specFile && !draftSpec) {
    return (
      <span className="dex-bring">
        <span className="faint dex-local">No recorded spec to bring in — </span>
        <Link className="btn btn-sm" href="/garage/">Import a photo or spec in the Workshop</Link>
      </span>
    );
  }
  const bring = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await bringDexRobotIntoWorkshop({ name, specFile, draftSpec });
      setNote(out.status === "already"
        ? "Already in your Workshop."
        : "Brought into your Workshop — find it under My robots.");
    } catch (e) {
      setNote(`Couldn't bring it in (${(e as Error).message}). Nothing was saved.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="dex-bring">
      <button type="button" className="btn btn-sm" onClick={bring} disabled={busy}>
        {busy ? "Bringing in…" : "Bring into Workshop"}
      </button>
      {note && <span className="faint dex-local" role="status">{note}</span>}
    </span>
  );
}

/* The ONE bring-into-Workshop construction, shared by the Robodex
 * cards above and the Workshop's "Add from Robodex" picker
 * (components/garage/RobodexPicker.tsx) — there is no second
 * Garage-writing path. A catalog robot saves its recorded Robodex
 * spec (buildDexEntry); a sighting saves the draft spec its
 * dossier recorded, as a photo-provenance Baseline. A robot with
 * no recorded spec throws instead of inventing one — callers show
 * the honest no-spec state and never reach here with one. The
 * write re-checks the store by name, so repeat brings never
 * duplicate. All storage goes through lib/store, so demo mode
 * writes land on the demo twin like every other Garage write. */
export type BringInOutcome =
  | { status: "added"; entry: GarageRobot }
  | { status: "already" };

export async function bringDexRobotIntoWorkshop({ name, specFile, draftSpec }: {
  name: string;
  specFile?: string | null;
  draftSpec?: Spec | null;
}): Promise<BringInOutcome> {
  let entry: GarageRobot;
  const nowIso = new Date().toISOString();
  if (specFile) {
    const r = await fetch(assetPath(specFile));
    if (!r.ok) throw new Error("HTTP " + r.status);
    const spec = (await r.json()) as Spec;
    entry = buildDexEntry(
      { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), specFile },
      spec, nowIso, { robot: uid("robot"), version: uid("v") },
    );
  } else if (draftSpec) {
    entry = {
      id: uid("robot"),
      name,
      createdAt: nowIso,
      versions: [{
        id: uid("v"),
        label: "Baseline",
        note: `Started from the Robodex sighting of ${name} — its recorded photo-draft spec, unchanged. Photo-estimated: sizes came from a photograph, not measurements.`,
        source: "photo",
        createdAt: nowIso,
        spec: JSON.parse(JSON.stringify(draftSpec)) as Spec,
      }],
    };
  } else {
    throw new Error("No recorded spec to bring in");
  }
  const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
  if (current.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
    return { status: "already" };
  }
  const error = writeStore(GARAGE_KEY, [...current, entry]);
  if (error) throw new Error(error);
  return { status: "added", entry };
}

/* The Workshop's Delete, from a Robodex card: the same store
 * operation (deleteRobotInStore, guarded by the record snapshot so a
 * robot edited meanwhile is never deleted blind) and the same
 * clean-up of its scans, notes and unsaved draft. Writes go through
 * lib/store, so demo mode deletes from the demo twin only. */
const WORKSHOP_DRAFT_KEY = (id: string) => `robotforge.workshop.draft.${id}`;
export function deleteGarageRobot(robot: GarageRobot): string | null {
  const result = deleteRobotInStore(
    () => readStore<GarageRobot[]>(GARAGE_KEY, []),
    (next) => writeStore(GARAGE_KEY, next),
    robot.id, recordSnapshot(robot),
  );
  if (!result.ok) return result.error;
  void forgetRobotScans(robot.id).catch(() => undefined);
  forgetRobotNotes(robot.id);
  writeStore(WORKSHOP_DRAFT_KEY(robot.id), null);
  return null;
}

/* A Workshop robot as a Robodex card — used for My robots and for
 * Workshop robots the owner filed under another tab. These are the
 * only Robodex cards with a Delete: they are your robots. */
export function GarageRobotCard({ robot, filedAs }: { robot: GarageRobot; filedAs: DexTab }) {
  const latest = robot.versions[robot.versions.length - 1];
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const remove = () => {
    if (!confirming) { setConfirming(true); return; }
    const problem = deleteGarageRobot(robot);
    setConfirming(false);
    setError(problem ?? "");
  };
  return (
    <article className="robot-card dex-mine">
      <Link className="dex-ph-link" href="/garage/" aria-label={`Open ${robot.name} in the Workshop`}>
        <div className="ph dex-ph"><RobotAvatar names={[robot.name, String(latest?.spec?.name ?? "")]} size={96} /></div>
      </Link>
      <div className="body">
        <h3><Link href="/garage/">{robot.name}</Link></h3>
        <span className="cls">{robot.versions.length} version{robot.versions.length === 1 ? "" : "s"} · {latest ? SOURCE_LABEL[latest.source] : ""}</span>
        <SourceBadge source={filedAs} />
        {confirming ? (
          <span className="g-remove-confirm" role="alert">
            Delete {robot.name} and its {robot.versions.length} version{robot.versions.length === 1 ? "" : "s"} for good? It leaves your Workshop too. This can&apos;t be undone. If you saved it to your account, press Save afterwards to remove it there too.{" "}
            <button type="button" className="btn btn-sm" onClick={remove}>Yes, delete</button>{" "}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <span className="dex-bring">
            <Link className="btn btn-sm" href="/garage/">Open in the Workshop</Link>
            <button type="button" className="btn btn-sm btn-ghost" onClick={remove} aria-label={`Delete ${robot.name}`}>Delete</button>
          </span>
        )}
        {error && <span className="faint dex-local" role="status">Couldn&apos;t delete it ({error}). Nothing changed.</span>}
      </div>
    </article>
  );
}

export function MyRobotsGrid({ mine }: { mine: GarageRobot[] | null }) {
  if (mine === null) return <p className="faint">Checking your Workshop…</p>;
  if (!mine.length) return (
    <div className="dex-empty">
      <p><strong>No robots of your own yet.</strong> My robots shows exactly what is in your Workshop. Bring one in from a photo, a spec file or the Robodex.</p>
      <Link className="btn btn-primary btn-sm" href="/garage/">Open the Workshop</Link>
    </div>
  );
  return (
    <div className="robot-grid dex-src-grid">
      {mine.map((r) => <GarageRobotCard key={r.id} robot={r} filedAs="mine" />)}
    </div>
  );
}

/* Workshop robots filed under a non-My-robots tab (owner override
 * via Wrench): they stay in the Workshop; only their Robodex
 * filing changed, and the cards still open the Workshop. */
export function FiledGarageGrid({ robots: filed, tab }: { robots: GarageRobot[]; tab: DexTab }) {
  if (!filed.length) return null;
  return (
    <>
      <h3 className="dex-filed-head">Filed here from your Workshop</h3>
      <div className="robot-grid dex-src-grid">
        {filed.map((r) => <GarageRobotCard key={r.id} robot={r} filedAs={tab} />)}
      </div>
    </>
  );
}

/* Sightings presented the way the old families fold grouped them —
 * by family, then by variant, with the variant's signature in
 * plain words — but inside the source tabs where sightings live.
 * Catalog and browser-saved sightings share these grids. */
export function SightingsGroups({ items, source, hasOther = false }: {
  items: DexSighting[];
  source: "sighted" | "photos" | "researched";
  hasOther?: boolean;
}) {
  if (!items.length && hasOther) return null;
  if (!items.length) return (
    <div className="dex-empty">
      <p><strong>{source === "sighted" ? "No in-person sightings yet." : "No photo-only robots yet."}</strong>{" "}
        {source === "sighted" ? "Saw a robot at a meetup or lab? Snap it in the Workshop and note where you saw it." : "Drop a robot picture into Wrench and add it to your dex."}</p>
      <Link className="btn btn-sm" href="/garage/">Open the Workshop</Link>
    </div>
  );
  const familiesInOrder: string[] = [];
  const byFamily = new Map<string, Map<string, DexSighting[]>>();
  for (const s of items) {
    if (!byFamily.has(s.family)) { byFamily.set(s.family, new Map()); familiesInOrder.push(s.family); }
    const byVariant = byFamily.get(s.family)!;
    byVariant.set(s.variant, [...(byVariant.get(s.variant) ?? []), s]);
  }
  return (
    <>
      {familiesInOrder.map((familyName) => {
        const byVariant = byFamily.get(familyName)!;
        return (
          <section key={familyName} className="dex-family" aria-label={`${familyName} sightings`}>
            <h3 className="dex-family-name">{familyName}</h3>
            {[...byVariant.entries()].map(([variantLabel, entries]) => (
              <div key={variantLabel} className="dex-variant">
                <h4 className="dex-variant-name">{variantLabel}</h4>
                {entries[0]?.signature && (
                  <p className="faint dex-sig">{describeSignature(entries[0].signature)}</p>
                )}
                <div className="robot-grid dex-src-grid">
                  {entries.map((s) => (
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
                        {SIGHTING_OWNER_NOTES[s.id] && <span className="dex-where">{SIGHTING_OWNER_NOTES[s.id]}</span>}
                        <SourceBadge source={source} />
                        {s.local && <span className="faint dex-local">Saved in this browser</span>}
                        <BringIntoWorkshop name={s.identity} draftSpec={s.draftSpec} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

/* The catalog-robot override for a card in RobotsIndex: RobotCard
 * badges read it so badge and tab always agree. */
export function catalogBadgeOverride(overrides: DexOverrides, robot: Robot) {
  const tab = overrides[dexKey(robot)];
  return tab ? dexTabToRobotSource(tab) : null;
}
