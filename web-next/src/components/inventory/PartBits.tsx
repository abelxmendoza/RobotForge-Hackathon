'use client';
/* Picture and status chips shared by the My Parts grid and columns. */
import { useState } from 'react';
import { partArt } from '@/lib/partArt';
import { partReality, REALITY_LABEL, type InventoryPart } from '@/lib/inventory';

const label = (c: string) => c.replace(/_/g, ' ');

export function PartThumb({ p }: { p: InventoryPart }) {
  /* A web photo can stop loading (the store moves it or blocks
   * hot-linking); then the card falls back to the illustration. */
  const [broken, setBroken] = useState<string | null>(null);
  const web = p.image_urls?.find((u) => u !== broken);
  return p.photo ? <img className="inv-thumb" src={p.photo} alt="" />
    : web ? <img className="inv-thumb inv-webphoto" src={web} alt="" loading="lazy" referrerPolicy="no-referrer" title={p.image_credit || 'Photo from the web'} onError={() => setBroken(web)} />
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

