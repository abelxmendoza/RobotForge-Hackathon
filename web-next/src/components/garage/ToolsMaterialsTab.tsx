'use client';
/* Workshop "Tools & Materials" tab (Forge Engine §11, Abel
 * 2026-11-01): every tool and material in the catalogues, each in
 * one of two states — On hand (owned) or Simulated (in the app
 * only, with its real recorded specs). The state is resolved by
 * lib/toolsMaterials.ts, never in here: a record is on hand only
 * when the catalogue records it or the owner flips it here, and
 * the flips persist in the same store layer as the rest of the
 * Workshop (demo mode writes its ".demo" twin, so the demo
 * sandbox shows demo states and the visitor's own are untouched).
 *
 * Design never blocks on ownership: the print-fit check below
 * runs against a simulated printer's real build volume exactly as
 * it runs against an on-hand one — it just SAYS which it was.
 * Build plans stay honest the other way: only on-hand items enter
 * the derived profile the plan checks against (lib/buildPlan via
 * deriveProfile), so a simulated tool never makes a real step
 * read as doable now. Prices appear only where a gathered record
 * carries one, with its basis and expiry; an expired estimate is
 * badged expired, never refreshed silently. No network anywhere
 * in this tab. */
import { useMemo, useState } from 'react';
import { kitOf, toolMaterialItems } from '@/lib/data';
import { useStore } from '@/lib/store';
import { useDemoMode } from '@/lib/demoMode';
import {
  DEFAULT_PROFILE, PROFILE_KEY, kitPlanItems,
} from '@/lib/buildPlan';
import {
  OWNERSHIP_KEY, OWNERSHIP_LABEL, deriveProfile, isPrinter, keySpecs,
  ownershipOf, priceState, printerBed, printerFit,
  type OwnershipMap, type TmItem,
} from '@/lib/toolsMaterials';
import type { ConstraintsProfile } from '@/lib/buildPlan';
import type { Spec } from '@/lib/garage';
import { catalogMatch } from './SimulateTab';

const money = (n: number, currency: string) =>
  (currency === 'USD' ? '$' : currency + ' ') + n.toFixed(2);

function PriceLine({ item, now }: { item: TmItem; now: string }) {
  const st = priceState(item, now);
  if (!st) return <span className="faint g-small">No price recorded.</span>;
  const p = st.price;
  return (
    <span className="g-small">
      <strong>{money(p.amount, p.currency)}</strong>
      {' — '}
      {p.sourceKind === 'web_gathered' ? 'web-gathered estimate' : 'recorded estimate'}
      {p.basis ? ` · basis: ${p.basis}` : ''}
      {p.fetchedAt ? ` · fetched ${p.fetchedAt.slice(0, 10)}` : ''}
      {p.expiresAt ? ` · expires ${p.expiresAt.slice(0, 10)}` : ''}
      {st.expired && (
        <span className="tm-expired" title="This estimate is past its recorded expiry — treat it as stale until re-gathered"> EXPIRED</span>
      )}
      {p.supplierUrl && (
        <> · <a href={p.supplierUrl} target="_blank" rel="noreferrer">supplier page</a></>
      )}
    </span>
  );
}

export default function ToolsMaterialsTab({ spec, robotName }: { spec: Spec; robotName: string }) {
  const [overrides, saveOverrides] = useStore<OwnershipMap>(OWNERSHIP_KEY, {});
  const [profile] = useStore<ConstraintsProfile>(PROFILE_KEY, DEFAULT_PROFILE);
  const demo = useDemoMode();
  const [note, setNote] = useState('');
  const [now] = useState(() => new Date().toISOString());

  const items = toolMaterialItems;
  const tools = items.filter((i) => i.kind === 'tool');
  const materials = items.filter((i) => i.kind === 'material');
  const derived = useMemo(
    () => deriveProfile(profile, items, overrides),
    [profile, items, overrides],
  );
  const addedTools = derived.toolsOnHand.filter((t) => !profile.toolsOnHand.includes(t));
  const addedMaterials = derived.materialsOnHand.filter((m) => !profile.materialsOnHand.includes(m));

  /* The design check §11 names: print-fit of this robot's recorded
   * kit parts against a printer's recorded build volume. The
   * match to a Robodex kit is SimulateTab's exact-name match; a
   * robot with no kit match abstains, in words. */
  const fitBlock = useMemo(() => {
    const printer = items.find((i) => isPrinter(i));
    if (!printer) return null;
    const bed = printerBed(printer)!;
    const own = ownershipOf(printer, overrides);
    const label = own === 'on_hand'
      ? `Print-fit check — on-hand printer (${printer.name})`
      : `Simulated print-fit check — designing against the ${printer.name} (simulated — not owned)`;
    const match = catalogMatch(spec);
    const kit = match ? kitOf(match.slug) : undefined;
    const prints = kit ? kitPlanItems(kit).filter((i) => i.role === 'print') : [];
    if (!prints.length) {
      return { label, text: `Not checked for ${robotName}: no recorded kit part dimensions to fit against the ${bed.join(' × ')} mm build volume.` };
    }
    const fit = printerFit(printer, prints.map((i) => ({ name: i.name, dims: i.dims })));
    if (!fit) return null;
    const total = fit.fits.length + fit.tooBig.length + fit.notChecked.length;
    const text =
      `${fit.fits.length} of ${total} recorded kit parts fit the ${bed.join(' × ')} mm build volume` +
      (fit.tooBig.length ? `; too big: ${fit.tooBig.join(', ')}` : '') +
      (fit.notChecked.length ? `; not checked (no recorded dimensions): ${fit.notChecked.join(', ')}` : '') +
      '.';
    return { label, text };
  }, [items, overrides, spec, robotName]);

  const flip = (item: TmItem) => {
    const next = ownershipOf(item, overrides) === 'on_hand' ? 'simulated' : 'on_hand';
    const err = saveOverrides({ ...overrides, [item.id]: next });
    setNote(err ?? '');
  };

  const card = (item: TmItem) => {
    const own = ownershipOf(item, overrides);
    return (
      <li key={item.id} className={'tm-row ' + own}>
        <div className="tm-main">
          <strong>{item.name}</strong>
          <span className="faint g-small">
            {item.catalog === 'parts' ? 'parts catalogue · materials class'
              : item.catalog === 'tools' ? 'tools catalogue' : 'materials catalogue'}
          </span>
          {keySpecs(item).map((s) => (
            <span key={s.label} className="g-small">{s.label}: {s.value}</span>
          ))}
          <PriceLine item={item} now={now} />
        </div>
        <div className="tm-side">
          <span className={'tm-badge ' + own}>{OWNERSHIP_LABEL[own]}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => flip(item)}>
            {own === 'on_hand' ? 'Mark simulated' : 'Mark on hand'}
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="ws-pane ws-tools" aria-label="Tools and materials">
      <div className="ws-history-head">
        <h3>Tools &amp; materials {demo && <span className="fbadge">DEMO</span>}</h3>
        <p className="faint">
          Everything a build consumes, in two states. <strong>On hand</strong> means owned — a record
          says so, or you mark it here. <strong>Simulated</strong> means the app holds the item&apos;s real
          recorded specs so you can design against it — plan a modification on a printer you don&apos;t own
          yet, spec a build around a filament you haven&apos;t bought — but it never makes a build step
          read as doable now: build plans check against on-hand gear only.
          {demo && ' In demo mode these are the demo sandbox&rsquo;s states; the catalogue records every item below as simulated until a record or your own mark says otherwise.'}
        </p>
      </div>
      {note && <p className="g-small" role="alert">{note}</p>}
      {fitBlock && (
        <p className="tm-fit g-small">
          <strong>{fitBlock.label}:</strong> {fitBlock.text}
        </p>
      )}
      <h4 className="tm-group">Tools</h4>
      <ul className="tm-list">{tools.map(card)}</ul>
      <h4 className="tm-group">Materials</h4>
      <ul className="tm-list">{materials.map(card)}</ul>
      <p className="g-small faint">
        What build plans count as on hand from the catalogues:{' '}
        {addedTools.length || addedMaterials.length
          ? [
              ...addedTools.map((t) => `${t === '3d_printer' ? '3D printer' : t} (tool)`),
              ...addedMaterials.map((m) => `${m} (material)`),
            ].join(', ') + ' — from on-hand records above, on top of your saved constraints profile.'
          : 'nothing yet — every catalogue item is simulated, so plans use your saved constraints profile as-is.'}
      </p>
    </section>
  );
}
