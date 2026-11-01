'use client';
/* The Robodex as a picture grid in a modal: pick a known robot to start
 * yours from. Only robots with a spec file can be picked. Photos are the
 * same ones the Robodex page uses, with its drawn fallback. */
import { useEffect, useRef } from 'react';
import { robots as dexRobots, robotSlug } from '@/lib/data';
import type { Robot } from '@/lib/types';
import RobotPhoto from '@/components/robots/RobotPhoto';
import { dexPhotoSrc as photoSrc } from './RobotAvatar';

export default function RobodexPicker({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (robot: Robot) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const pickable = dexRobots.filter((r) => r.spec_file);
  return (
    <dialog
      ref={ref}
      className="dex-modal"
      aria-labelledby="dex-modal-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); /* backdrop */ }}
    >
      <div className="dex-modal-head">
        <h2 id="dex-modal-title">The Robodex</h2>
        <p className="faint">Pick a robot to start yours from. You can change everything after.</p>
        <button type="button" className="fc-close" onClick={onClose} aria-label="Close the Robodex">✕</button>
      </div>
      <ul className="dex-grid">
        {pickable.map((r) => {
          const slug = robotSlug(r);
          return (
            <li key={r.spec_file}>
              <button type="button" className="dex-pick" onClick={() => onPick(r)}>
                <span className="dex-pick-photo">
                  <RobotPhoto src={photoSrc(r)} alt={r.name} slug={slug} name={r.name} />
                </span>
                <span className="dex-pick-name">{r.name}</span>
                {(r.subtype || r.class) && <span className="dex-pick-sub">{r.subtype || r.class}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
