'use client';
/* Picture and status chips shared by the My Parts grid and columns. */
import { partArt } from '@/lib/partArt';
import { partReality, REALITY_LABEL, type InventoryPart } from '@/lib/inventory';

const label = (c: string) => c.replace(/_/g, ' ');

export function PartThumb({ p }: { p: InventoryPart }) {
  return p.photo ? <img className="inv-thumb" src={p.photo} alt="" />
    : partArt(p.name, p.category) ? <span className="part-art inv-thumb" title="Illustration of a typical part like this, not a photo of yours"><img src={partArt(p.name, p.category)!} alt="" loading="lazy" /></span>
      : <span className="inv-noimg inv-thumb" aria-hidden="true">{label(p.category).slice(0, 1).toUpperCase()}</span>;
}

/* The small status chips every card and column row shows. */
export function PartChips({ p }: { p: InventoryPart }) {
  const real = partReality(p) === 'real';
  return (
    <span className="inv-chips">
      <span className={'inv-chip ' + (real ? 'real' : 'sim')}>{REALITY_LABEL[partReality(p)]}</span>
      <span className={'inv-dot ' + (p.status === 'confirmed' ? 'ok' : 'todo')} title={p.status === 'confirmed' ? 'Confirmed' : 'Needs confirmation'} aria-label={p.status === 'confirmed' ? 'Confirmed' : 'Needs confirmation'} />
    </span>
  );
}

