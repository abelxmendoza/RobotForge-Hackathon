'use client';
/* The Parts palette — opened by the Kit page's "Parts palette"
 * button, overlaid on the 3D stage. A grid of part cards in two
 * sections:
 *
 *  - Bench props (NVIDIA SimReady): the only items with a 3D
 *    model. Their picture is a live render of the actual GLB
 *    (PropThumb). Drag one onto the stage and it joins the scene
 *    where it lands; it also joins the build list.
 *  - The parts catalogue: real parts with datasheet specs. Their
 *    catalogue images are AI illustrations, so — unlike the Parts
 *    catalogue below, which captions them as such — the palette
 *    does not present them as part pictures at all: each card
 *    carries a labelled no-image placeholder. Dragging one onto
 *    the stage (or tapping Add) puts it in the build list only;
 *    nothing is faked into the scene.
 *
 * The build list at the bottom is the one shared list
 * (lib/buildList.ts): the BOM wizard starts from it, and the chat
 * adds to it with the same add actions. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { parts, simReadyProps } from '@/lib/data';
import type { Part } from '@/lib/types';
import {
  buildPaletteItems,
  type BuildEntry,
  type PaletteItem,
} from '@/lib/palette';
import { partClassLabel } from '../robots/shared';
import PropThumb from './PropThumb';
import PartPhoto from '@/components/parts/PartPhoto';
import { verifiedPhoto } from '@/lib/partPhoto';

const partsById = new Map<string, Part>(parts.map((p) => [p.id, p]));
const propsById = new Map(simReadyProps.map((p) => [p.id, p]));

function entryName(e: BuildEntry): string {
  if (e.kind === 'catalog-part') return partsById.get(e.refId)?.name ?? e.refId;
  return propsById.get(e.refId)?.name ?? e.refId;
}

function PaletteCard({
  item,
  onAdd,
}: {
  item: PaletteItem;
  onAdd: (item: PaletteItem) => void;
}) {
  return (
    <div
      className="pcard"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-rf-palette', item.key);
        e.dataTransfer.setData('text/plain', item.key);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={
        item.hasModel
          ? 'Drag onto the stage to place the model — it also joins your build list'
          : 'Drag onto the stage or tap Add — joins your build list (no 3D model)'
      }
    >
      {item.hasModel && item.prop ? (
        <>
          <PropThumb file={item.prop.file} label={item.name} />
          <div className="pcard-cap">Live render of the actual model</div>
        </>
      ) : verifiedPhoto(item.part) ? (
        <PartPhoto photo={verifiedPhoto(item.part)} name={item.name} variant="card" />
      ) : (
        <div className="palette-thumb palette-noimg">
          <span className="palette-thumb-note">
            No image — the catalogue holds no photo of this part
          </span>
        </div>
      )}
      <h4>{item.name}</h4>
      {item.specLine ? <p className="pcard-spec">{item.specLine}</p> : null}
      <p className="pcard-badges">
        <span className={`pbadge ${item.reality}`}>
          {item.reality === 'real' ? 'Real part' : 'Sim only'}
        </span>{' '}
        <span className="pbadge model">
          {item.hasModel ? '3D model' : 'Build list only'}
        </span>
      </p>
      <p className="pcard-src">{item.sourceLabel}</p>
      <button type="button" onClick={() => onAdd(item)}>
        + Add{item.hasModel ? ' & place' : ''}
      </button>
    </div>
  );
}

export default function PartsPalette({
  entries,
  onAdd,
  onRemove,
  onQty,
  onClear,
  onClose,
}: {
  entries: BuildEntry[];
  onAdd: (item: PaletteItem) => void;
  onRemove: (uid: string) => void;
  onQty: (uid: string, qty: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => buildPaletteItems(parts, simReadyProps), []);
  const q = query.trim().toLowerCase();
  const hit = (item: PaletteItem) =>
    !q ||
    [item.name, item.refId, item.specLine, item.sourceLabel]
      .join(' ')
      .toLowerCase()
      .includes(q);
  const props = items.filter((i) => i.kind === 'bench-prop' && hit(i));
  const catItems = items.filter((i) => i.kind === 'catalog-part' && hit(i));
  const groups: { cls: string; items: PaletteItem[] }[] = [];
  for (const item of catItems) {
    const cls = item.part?.part_class ?? '';
    const last = groups[groups.length - 1];
    if (last && last.cls === cls) last.items.push(item);
    else groups.push({ cls, items: [item] });
  }
  const totalQty = entries.reduce((s, e) => s + e.qty, 0);

  return (
    <div className="palette" role="dialog" aria-label="Parts palette">
      <div className="palette-head">
        <strong>Parts palette</strong>
        <button type="button" onClick={onClose} aria-label="Close the parts palette">
          ✕
        </button>
      </div>
      <p className="palette-note">
        Drag a card onto the stage, tap Add, or tell the assistant —
        “add a RealSense camera and two wheels to my build”. Bench
        props have real 3D models and land in the scene; catalogue
        parts join the build list only. Catalogue part pictures are
        not shown: the catalogue’s images are AI illustrations, not
        photos, so the cards say “no image” instead.
      </p>
      <input
        type="search"
        className="palette-search"
        placeholder="Filter parts, e.g. lidar, battery, crate"
        aria-label="Filter palette parts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {props.length ? (
        <>
          <h3 className="palette-sec">Bench props — with 3D models</h3>
          <div className="palette-grid">
            {props.map((item) => (
              <PaletteCard key={item.key} item={item} onAdd={onAdd} />
            ))}
          </div>
        </>
      ) : null}

      {groups.map((g) => (
        <div key={g.cls}>
          <h3 className="palette-sec">{partClassLabel(g.cls)}</h3>
          <div className="palette-grid">
            {g.items.map((item) => (
              <PaletteCard key={item.key} item={item} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
      {!props.length && !groups.length ? (
        <p className="palette-note">No palette parts match that filter.</p>
      ) : null}

      <div className="buildlist">
        <h3 className="palette-sec">
          Your build list{entries.length ? ` — ${totalQty} item${totalQty === 1 ? '' : 's'}` : ''}
        </h3>
        {entries.length ? (
          <>
            {entries.map((e) => (
              <div className="buildrow" key={e.uid}>
                <span className="buildrow-name">
                  {entryName(e)}
                  <span className="dim">
                    {e.kind === 'bench-prop'
                      ? ` · in the scene${e.via === 'chat' ? ' · via chat' : ''}`
                      : ` · build list only${e.via === 'chat' ? ' · via chat' : ''}`}
                  </span>
                </span>
                {e.kind === 'catalog-part' ? (
                  <span className="buildrow-qty">
                    <button
                      type="button"
                      aria-label={`One fewer ${entryName(e)}`}
                      onClick={() => onQty(e.uid, e.qty - 1)}
                      disabled={e.qty <= 1}
                    >
                      −
                    </button>
                    ×{e.qty}
                    <button
                      type="button"
                      aria-label={`One more ${entryName(e)}`}
                      onClick={() => onQty(e.uid, e.qty + 1)}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  <span className="buildrow-qty">×1</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${entryName(e)} from the build list`}
                  onClick={() => onRemove(e.uid)}
                >
                  ✕
                </button>
              </div>
            ))}
            <p className="buildlist-foot">
              <Link href="/bom/?start=build" className="palette-bomlink">
                Open in the BOM wizard →
              </Link>{' '}
              <button type="button" onClick={onClear}>
                Clear list
              </button>
            </p>
          </>
        ) : (
          <p className="palette-note">
            Empty — add parts from the grid above, by dragging them
            onto the stage, or by asking the assistant in chat.
          </p>
        )}
      </div>
    </div>
  );
}
