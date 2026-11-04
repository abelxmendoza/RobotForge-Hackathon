'use client';
/* The part modal's picture side: three views of one part, and the
 * buying side: price and stores.
 * - 360° view and CAD model: generated 3D (lib/partModel3d), labelled
 *   as a stand-in with the size basis it actually used.
 * - Photo: the owner's own photo, else web product photos (with the
 *   store credit and a link to the page), else the category
 *   illustration, labelled as such. */
import { useMemo, useState } from 'react';
import type { InventoryPart } from '@/lib/inventory';
import { partArt } from '@/lib/partArt';
import { partShape, sizeMm } from '@/lib/partModel3d';
import { partSearchQuery, storeSearchLinks } from '@/lib/sourcing';
import PartViewer3D from './PartViewer3D';

type Tab = 'real' | 'cad' | 'photo';
const safe = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function PartViews({ p }: { p: InventoryPart }) {
  const [tab, setTab] = useState<Tab>('real');
  const shape = useMemo(() => partShape({ name: p.name, category: p.category, specs: p.specs }), [p.name, p.category, p.specs]);
  const [L, W, H] = sizeMm(shape);
  const fileName = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'part';
  return (
    <div className="pv-views">
      <div className="pv-tabs" role="tablist" aria-label="Part views">
        {([['real', '3D 360°'], ['cad', '3D CAD'], ['photo', '2D photo']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="pv-panel" role="tabpanel">
        {tab === 'photo' ? <PhotoView p={p} /> : <PartViewer3D key={tab} shape={shape} mode={tab} fileName={fileName} />}
      </div>
      {tab !== 'photo' && (
        <p className="faint g-small pv-caption">
          Generated 3D model of a typical {shape.label}, {L} × {W} × {H} mm
          {shape.sizeBasis === 'specs' ? ' (size from this part’s specs)' : ' (typical size for this kind of part; add its dimensions to make it exact)'}.
          Not the maker’s CAD or a scan.
        </p>
      )}
    </div>
  );
}

function PhotoView({ p }: { p: InventoryPart }) {
  const photos = [...(p.photo ? [p.photo] : []), ...(p.image_urls || [])];
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const ok = photos.filter((u) => !broken.has(u));
  const cur = ok[Math.min(i, ok.length - 1)];
  const art = partArt(p.name, p.category);
  if (!cur) {
    return (
      <div className="pv-photo">
        {art ? <img src={art} alt={'Illustration of a typical ' + p.category.replace(/_/g, ' ')} /> : <span className="inv-noimg">{p.name.slice(0, 1)}</span>}
        <p className="faint g-small pv-caption">Illustration of a typical part like this, not a photo. Ask Wrench to find it on the web to add real product photos.</p>
      </div>
    );
  }
  const own = cur === p.photo;
  return (
    <div className="pv-photo">
      <img src={cur} alt={own ? 'Your photo of ' + p.name : 'Product photo of ' + p.name} referrerPolicy="no-referrer" onError={() => setBroken((b) => new Set(b).add(cur))} />
      {ok.length > 1 && (
        <div className="pv-thumbs" aria-label="More photos">
          {ok.map((u, k) => (
            <button key={u} type="button" aria-pressed={u === cur} onClick={() => setI(k)}>
              <img src={u} alt={'Photo ' + (k + 1)} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken((b) => new Set(b).add(u))} />
            </button>
          ))}
        </div>
      )}
      <p className="faint g-small pv-caption">
        {own ? 'Your photo.' : (p.image_credit || 'Photo from the web') + '. Shown from the store’s page; it pictures the listed product, not your own part.'}
        {!own && safe(p.source_url) && <> <a href={safe(p.source_url)} target="_blank" rel="noreferrer">Open the page ↗</a></>}
      </p>
    </div>
  );
}

export function PartBuyInfo({ p }: { p: InventoryPart }) {
  const links = storeSearchLinks(partSearchQuery({ name: p.name, specs: p.specs }));
  const src = safe(p.source_url);
  return (
    <section className="pv-buy">
      <h3>Price and where to buy</h3>
      {p.price_estimate ? (
        <p className="pv-price">
          <strong>{p.price_estimate.text}</strong>
          <span className="faint g-small"> at {p.store || 'the source page'}, as the page stated on {p.price_estimate.fetchedAt.slice(0, 10)}. An estimate, not a quote: prices change.</span>
        </p>
      ) : (
        <p className="faint">No price recorded for this part yet. Ask Wrench “how much does {p.name} cost” to look it up, or open a store below.</p>
      )}
      {src && (
        <p><a className="btn btn-sm btn-primary" href={src} target="_blank" rel="noreferrer">Buy at {p.store || new URL(src).hostname.replace(/^www\./, '')} ↗</a></p>
      )}
      <div className="pv-stores" aria-label="Search online stores">
        {links.map((l) => <a key={l.vendor} className="chip" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
      </div>
      <p className="faint g-small">Store buttons open a search for this part; they don’t check stock or price.</p>
    </section>
  );
}
