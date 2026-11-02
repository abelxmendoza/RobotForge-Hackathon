'use client';
/* My Parts as Finder-style columns: shelf (each robot, the shared
 * shelf, tools) → subsystem → part → the parts mounted on it, each
 * click opening the next column to the right. On a phone only the
 * deepest column shows, with a back button. The tree comes from
 * lib/partsTree.ts; this file only lays it out.
 *
 * Keyboard: Up/Down move inside a column, Right goes into the next
 * column, Left goes back, Enter on a part opens its details. */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { GarageRobot } from '@/lib/garage';
import type { InventoryPart } from '@/lib/inventory';
import {
  childrenOf, countUnder, descendantIds, partsOnShelf, rootParts, shelvesFor, withAncestors,
  SUBSYSTEMS, SUBSYSTEM_LABEL, type Shelf, type SubsystemId,
} from '@/lib/partsTree';
import { PartChips, PartThumb } from './PartBits';

const toConfirm = (list: InventoryPart[]) => list.filter((p) => p.status !== 'confirmed').length;

export default function PartsColumns({ all, shown, robots, openId, onOpen }: {
  all: InventoryPart[];
  shown: InventoryPart[];
  robots: GarageRobot[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const { parts, context } = useMemo(() => withAncestors(all, shown), [all, shown]);
  const shelves = useMemo(
    () => shelvesFor(robots).map((s) => ({ shelf: s, list: partsOnShelf(parts, s, robots) })).filter((x) => x.list.length > 0),
    [parts, robots],
  );
  const [shelfId, setShelfId] = useState<string | null>(null);
  const [subId, setSubId] = useState<SubsystemId | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  const cur = shelves.find((x) => x.shelf.id === shelfId) ?? shelves[0];
  const shelf: Shelf | undefined = cur?.shelf;
  const shelfParts = cur?.list ?? [];
  const subs = useMemo(() => {
    if (!shelf) return [] as { id: SubsystemId; list: InventoryPart[] }[];
    if (shelf.tools) return [{ id: 'tools' as SubsystemId, list: shelfParts }];
    // A subsystem holds its top-level parts plus everything mounted on
    // them, so a USB board under the lidar counts under Sensing.
    return SUBSYSTEMS.map((s) => {
      const tops = rootParts(shelfParts, all, s.id as SubsystemId);
      const under = new Set(tops.flatMap((t) => [...descendantIds(parts, t.id)]));
      return { id: s.id as SubsystemId, list: [...tops, ...shelfParts.filter((p) => under.has(p.id))] };
    }).filter((x) => x.list.length > 0);
  }, [shelf, shelfParts, all, parts]);
  const sub = subs.find((x) => x.id === subId) ?? subs[0];
  const roots = sub ? rootParts(shelfParts, all, sub.id) : [];

  // Columns of parts: the subsystem's top-level parts, then the
  // children of each part picked along the path.
  const partCols: { key: string; title: string; list: InventoryPart[]; picked: string | null }[] = [];
  let list = roots;
  let title = sub ? SUBSYSTEM_LABEL[sub.id] : '';
  for (let i = 0; ; i++) {
    const picked = path.at(i) ?? null;
    const valid = picked && list.some((p) => p.id === picked) ? picked : null;
    partCols.push({ key: 'col' + i, title, list, picked: valid });
    if (!valid) break;
    const next = childrenOf(parts, valid);
    if (!next.length) break;
    title = 'Inside ' + (list.find((p) => p.id === valid)?.name ?? '');
    list = next;
  }
  const lastPicked = partCols.at(-1)?.picked ?? null;
  const picked = lastPicked ? parts.find((p) => p.id === lastPicked) : undefined;
  const depth = 2 + partCols.length + (picked ? 1 : 0);
  /* On a phone one column shows: the one after the last level you
   * picked yourself (the desktop auto-picks don't count). */
  const picks = partCols.filter((c) => c.picked).length;
  const chosen = picks ? (shelf?.tools ? 1 : 2) + picks : (!shelf?.tools && subId && sub?.id === subId) ? 2 : (shelfId && cur ? 1 : 0);
  const focusAt = (i: number) => (i === Math.min(chosen, depth - (shelf?.tools ? 2 : 1)) ? ' pc-focus' : '');

  const pickPart = (col: number, id: string) => setPath([...path.slice(0, col), id]);
  const back = () => {
    if (picks) { setPath(path.slice(0, picks - 1)); if (!shelf?.tools && sub) setSubId(sub.id); if (cur) setShelfId(cur.shelf.id); return; }
    if (subId && !shelf?.tools) { setSubId(null); setPath([]); if (cur) setShelfId(cur.shelf.id); return; }
    setShelfId(null); setSubId(null); setPath([]);
  };

  /* Arrow keys across the columns. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const col = t.closest('.pc-col');
    if (!col || !hostRef.current) return;
    const items = Array.from(col.querySelectorAll<HTMLButtonElement>('.pc-item'));
    const cols = Array.from(hostRef.current.querySelectorAll<HTMLElement>('.pc-col'));
    const ci = cols.indexOf(col as HTMLElement);
    const i = items.indexOf(t as HTMLButtonElement);
    const focusIn = (c: HTMLElement | undefined, pick: 'current' | 'first') => {
      if (!c) return;
      const btn = (pick === 'current' && c.querySelector<HTMLButtonElement>('.pc-item[aria-current="true"]')) || c.querySelector<HTMLButtonElement>('.pc-item, .pc-open');
      btn?.focus();
    };
    if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); items.at(Math.min(i + 1, items.length - 1))?.focus(); }
    else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); items.at(Math.max(i - 1, 0))?.focus(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); t.click(); requestAnimationFrame(() => focusIn(hostRef.current?.querySelectorAll<HTMLElement>('.pc-col')[ci + 1], 'first')); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusIn(cols.at(Math.max(ci - 1, 0)), 'current'); }
  };

  if (!shelf) return null;

  return (
    <div className="pc" ref={hostRef} onKeyDown={onKey} data-depth={depth}>
      <div className="pc-phonebar">
        <button type="button" className="btn btn-sm" onClick={back} disabled={chosen === 0}>← Back</button>
        <span className="faint g-small">{[shelf.label, sub && !shelf.tools ? SUBSYSTEM_LABEL[sub.id] : null, picked?.name].filter(Boolean).join(' › ')}</span>
      </div>
      <div className="pc-cols">
        <section className={'pc-col' + focusAt(0)} aria-label="Robots and shelves" data-level="1">
          <h4>Robot or shelf</h4>
          {shelves.map(({ shelf: s, list: l }) => (
            <button key={s.id} type="button" className="pc-item" aria-current={s.id === shelf.id ? 'true' : undefined}
              onClick={() => { setShelfId(s.id); setSubId(null); setPath([]); }}>
              <span className="pc-name"><strong>{s.label}</strong><span className="faint">{l.length} part{l.length === 1 ? '' : 's'}{toConfirm(l) ? ` · ${toConfirm(l)} to confirm` : ''}</span></span>
              <span className="pc-caret" aria-hidden="true">›</span>
            </button>
          ))}
        </section>
        {!shelf.tools && (
          <section className={'pc-col' + focusAt(1)} aria-label={`Subsystems of ${shelf.label}`} data-level="2">
            <h4>Subsystem</h4>
            {subs.map((x) => (
              <button key={x.id} type="button" className="pc-item" aria-current={x.id === sub?.id ? 'true' : undefined}
                onClick={() => { setSubId(x.id); setPath([]); }}>
                <span className="pc-name"><strong>{SUBSYSTEM_LABEL[x.id]}</strong><span className="faint">{x.list.length} part{x.list.length === 1 ? '' : 's'}{toConfirm(x.list) ? ` · ${toConfirm(x.list)} to confirm` : ''}</span></span>
                <span className="pc-caret" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}
        {partCols.map((c, ci) => (
          <section key={c.key} className={'pc-col' + focusAt((shelf.tools ? 1 : 2) + ci)} aria-label={c.title} data-level={String(3 + ci)}>
            <h4>{c.title}</h4>
            {c.list.map((p) => {
              const inside = countUnder(parts, p.id);
              return (
                <button key={p.id} type="button" className={'pc-item' + (context.has(p.id) ? ' pc-context' : '')}
                  aria-current={p.id === c.picked ? 'true' : undefined}
                  title={context.has(p.id) ? 'Shown because a part inside it matches your filter' : undefined}
                  onClick={() => pickPart(ci, p.id)}
                  onDoubleClick={() => onOpen(p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(p.id); } }}>
                  <PartThumb p={p} />
                  <span className="pc-name"><strong>{p.name}</strong><span className="faint">×{p.quantity}{inside ? ` · ${inside} inside` : ''}</span><PartChips p={p} /></span>
                  {inside > 0 && <span className="pc-caret" aria-hidden="true">›</span>}
                </button>
              );
            })}
          </section>
        ))}
        {picked && (
          <section className={'pc-col pc-preview' + focusAt((shelf.tools ? 1 : 2) + partCols.length)} aria-label={`Preview of ${picked.name}`}>
            <h4>Part</h4>
            <div className="pc-preview-pic"><PartThumb p={picked} /></div>
            <strong>{picked.name}</strong>
            <span className="faint g-small">×{picked.quantity} · {picked.category.replace(/_/g, ' ')}{picked.stock_location ? ` · ${picked.stock_location}` : ''}</span>
            <PartChips p={picked} />
            <button type="button" className="btn btn-sm btn-primary pc-open" aria-pressed={openId === picked.id} onClick={() => onOpen(picked.id)}>Open details</button>
          </section>
        )}
      </div>
    </div>
  );
}
