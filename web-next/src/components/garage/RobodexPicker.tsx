'use client';
/* The Robodex as a picker inside the Workshop's "Add a Robot"
 * panel: every robot the Robodex holds — catalog robots and
 * sightings — grouped by where the Robodex files it (the owner's
 * overrides included, resolved through the same useDexSources
 * model the /robots page reads), each row labelled with its
 * source. Picking one brings it into the Workshop through the ONE
 * shared construction (bringDexRobotIntoWorkshop in DexSources,
 * the same path the Robodex cards use) and lands on the new robot.
 *
 * Honesty rules, inherited from the Robodex cards: a robot already
 * in the Workshop is marked and cannot be added twice; a sighting
 * with no recorded spec gets no invented entry — its row offers
 * the attach-to-Wrench route instead. My robots themselves are
 * not listed: they are already the Workshop's list. All storage
 * goes through lib/store (via useDexSources and the bring-in), so
 * in demo mode the picker reads and writes the demo twins. */
import { useEffect, useRef, useState } from 'react';
import { robotSlug } from '@/lib/data';
import type { Robot } from '@/lib/types';
import { GARAGE_KEY, type GarageRobot, type Spec } from '@/lib/garage';
import { useStore } from '@/lib/store';
import { ROBOT_SOURCE_META } from '@/lib/robotSource';
import { dexTabToRobotSource, type DexTab } from '@/lib/dexOverrides';
import { promptWrench } from '@/lib/wrenchPrompt';
import { assetPath } from '@/components/home/asset';
import {
  bringDexRobotIntoWorkshop,
  useDexSources,
  type DexSighting,
} from '@/components/robots/DexSources';
import RobotPhoto from '@/components/robots/RobotPhoto';
import RobotAvatar, { dexPhotoSrc } from './RobotAvatar';

/* Robodex tab order, My robots last: those are the owner's
 * already — the tab only appears here for a catalog robot or
 * sighting the owner filed there before bringing it in. */
const GROUP_ORDER: DexTab[] = ["sighted", "photos", "researched", "mine"];

function PickRow({ name, sub, label, specFile, draftSpec, inGarage, onAdded, thumb }: {
  name: string;
  sub: string;
  label: string;
  specFile?: string | null;
  draftSpec?: Spec | null;
  inGarage: boolean;
  onAdded: (id: string) => void;
  thumb: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const hasSpec = Boolean(specFile || draftSpec);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await bringDexRobotIntoWorkshop({ name, specFile, draftSpec });
      if (out.status === "added") { onAdded(out.entry.id); return; }
      setNote("Already in your Workshop.");
    } catch (e) {
      setNote(`Couldn't bring it in (${(e as Error).message}). Nothing was saved.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="dex-pick-row">
      <span className="dex-pick-thumb">{thumb}</span>
      <span className="dex-pick-main">
        <span className="dex-pick-name">{name}</span>
        {sub && <span className="dex-pick-sub">{sub}</span>}
        <span className="dex-pick-label">{label}</span>
      </span>
      <span className="dex-pick-action">
        {inGarage ? (
          <span className="dex-in">In your Workshop ✓</span>
        ) : !hasSpec ? (
          <>
            <span className="faint dex-local">No recorded spec to bring in — </span>
            <button type="button" className="btn btn-sm" onClick={() => promptWrench({ mode: 'chat', text: 'Add a robot from these photos.', attach: true })}>
              Attach files to Wrench
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={add} disabled={busy}>
            {busy ? "Bringing in…" : "Add to Workshop"}
          </button>
        )}
        {note && <span className="faint dex-local" role="status">{note}</span>}
      </span>
    </li>
  );
}

export default function RobodexPicker({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open ]);
  const model = useDexSources();
  const [garage] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const inGarage = (name: string) =>
    (garage ?? []).some((r) => r.name.toLowerCase() === name.toLowerCase());

  const catalogRow = (r: Robot, tab: DexTab) => (
    <PickRow
      key={"dex-" + String(r.number)}
      name={r.name}
      sub={r.subtype || r.class || ""}
      label={ROBOT_SOURCE_META[dexTabToRobotSource(tab)].label}
      specFile={r.spec_file}
      inGarage={inGarage(r.name)}
      onAdded={onAdded}
      thumb={<RobotPhoto src={dexPhotoSrc(r)} alt={r.name} slug={robotSlug(r)} name={r.name} />}
    />
  );
  const sightingRow = (s: DexSighting, tab: DexTab) => (
    <PickRow
      key={"sighting-" + s.id}
      name={s.identity}
      sub={[s.family, s.variant !== s.identity ? s.variant : null, s.where, s.local ? "Saved in this browser" : null].filter(Boolean).join(" · ")}
      label={ROBOT_SOURCE_META[dexTabToRobotSource(tab)].label}
      draftSpec={s.draftSpec}
      inGarage={inGarage(s.identity)}
      onAdded={onAdded}
      thumb={s.photo
        /* eslint-disable-next-line @next/next/no-img-element */
        ? <img src={assetPath(s.photo)} alt={`Photo of ${s.identity}`} loading="lazy" />
        : <RobotAvatar names={[s.identity]} size={64} />}
    />
  );

  return (
    <dialog
      ref={ref}
      className="dex-modal"
      aria-labelledby="dex-modal-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); /* backdrop */ }}
    >
      <div className="dex-modal-head">
        <h2 id="dex-modal-title">Add from the Robodex</h2>
        <p className="faint">Bring a robot the Robodex already knows into your Workshop. It lands as a Baseline version with its recorded spec — nothing is invented.</p>
        <button type="button" className="fc-close" onClick={onClose} aria-label="Close the Robodex picker">✕</button>
      </div>
      <div className="dex-pick-groups">
        {GROUP_ORDER.map((tab) => {
          const catalog = model.catalogByTab[tab];
          const sightings = model.sightingsByTab[tab];
          if (!catalog.length && !sightings.length) return null;
          return (
            <section key={tab} className="dex-pick-group" aria-label={ROBOT_SOURCE_META[dexTabToRobotSource(tab)].label}>
              <h3>{ROBOT_SOURCE_META[dexTabToRobotSource(tab)].label}</h3>
              <ul className="dex-pick-list">
                {catalog.map((r) => catalogRow(r, tab))}
                {sightings.map((s) => sightingRow(s, tab))}
              </ul>
            </section>
          );
        })}
      </div>
    </dialog>
  );
}
