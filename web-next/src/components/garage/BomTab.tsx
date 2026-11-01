'use client';
/* Workshop "BOM" tab (Abel, 2026-11-01): the bill of materials for the
 * robot being edited, read straight from its spec, the battery, the
 * motors and wheels with their counts, and every part in its wiring
 * block, then checked against the person's own parts list (My parts).
 * Each line says whether a matching part is already on the shelf,
 * only in the sim, or still to get, and carries vendor SEARCH links.
 * It never shows a stock level or an availability claim.
 *
 * Prices (re-gated 2026-11-01): the tab reads the SAME build-plan
 * build-plan price store (lib/buildPlan.ts, key
 * rf.buildplan.v1, through the store layer — so demo mode reads its
 * ".demo" twin and nothing here ever touches the network). A line
 * shows a price only when a record backs it, resolved by
 * resolvedPrice() under the exact key the price input below writes: a line
 * reaches a catalogue price record ONLY through its matched shelf
 * part's recorded catalogue id (`part:<id>`, the wizard's own key
 * for a catalogue line) — never through a name match, the same
 * doctrine the verified photos follow. A line with no record stays
 * visibly unpriced and is counted as unpriced in the totals, never
 * zero-filled; the totals line reports the unverified web-gathered
 * share separately, in the budget check's own words. */
import { useMemo } from 'react';
import Link from 'next/link';
import SourcingLinks from '@/components/robots/SourcingLinks';
import { bomToCsv, type BomLine } from '@/lib/bom';
import { partReality, partSection, type InventoryPart } from '@/lib/inventory';
import { isWiring, role } from '@/lib/wiring';
import type { Spec } from '@/lib/garage';
import { partArt } from '@/lib/partArt';
import { parts as catalogParts } from '@/lib/data';
import { verifiedPhoto } from '@/lib/partPhoto';
import PartPhoto from '@/components/parts/PartPhoto';
import { useStore } from '@/lib/store';
import {
  DEFAULT_PROFILE, PROFILE_KEY, priceTotals, resolvedPrice,
  type ConstraintsProfile, type PlanItem, type ResolvedPrice,
} from '@/lib/buildPlan';

const catalogById = new Map(catalogParts.map((p) => [p.id, p]));

/* have/sim: enough units of a part that fits. check: only a part of the
 * same family whose fit can't be confirmed from its name or specs.
 * need: nothing usable, or too few units (got < qty). */
type Have = { state: 'have' | 'sim' | 'check' | 'need'; part?: InventoryPart; got: number };
interface Row {
  line: BomLine; category: string; have: Have;
  /* The build-plan view of this line: its key is the wizard's own
   * price key where the line has a recorded catalogue identity
   * (the matched shelf part's catalog_part_id), else the line's own
   * key — exact-key lookups only, either way. price is null when no
   * record backs a figure: the line is unpriced, never $0. */
  priceItem: PlanItem;
  price: ResolvedPrice | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

const fmt = (v: unknown, scale = 1, digits = 0) => (typeof v === 'number' && Number.isFinite(v) ? (v * scale).toFixed(digits).replace(/\.0+$/, '') : null);

/* Part family for a wiring node, as the inventory names categories. */
function categoryFor(r: string): string {
  if (r === 'the battery' || r === 'the power supply') return 'battery';
  if (r.includes('regulator') || r.includes('distribution')) return 'power';
  if (r.includes('driver') || r.includes('ESC')) return 'motor_driver';
  if (r.includes('motor')) return 'motor';
  if (r.includes('lidar') || r.includes('camera') || r.includes('IMU') || r.includes('ultrasonic') || r.includes('sensor')) return 'sensor';
  if (r.includes('computer')) return 'computer';
  if (r.includes('controller') || r.includes('board')) return 'controller';
  return 'other';
}


const GENERIC = new Set(['the', 'and', 'with', 'for', 'motor', 'motors', 'battery', 'board', 'sensor', 'module', 'driver', 'dual', 'demo', 'sample', 'class', 'wheel', 'wheels', 'diameter', 'part', 'kit']);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w)));
/* First number before a unit in a name or spec value, e.g. "11.1 V". */
function num(text: string, unit: RegExp): number | null {
  const m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + unit.source, 'i').exec(text);
  return m ? Number(m[1]) : null;
}
const partText = (p: InventoryPart) => [p.name, ...Object.entries(p.specs ?? {}).map(([k, v]) => `${v} ${/volt/i.test(k) ? 'V' : /mm|diam/i.test(k) ? 'mm' : ''}`)].join(' ');

/* Does this shelf part fit the BOM line? true = fits, false = clearly
 * doesn't (wrong voltage or size), null = same family but can't tell. */
function fits(line: BomLine, category: string, p: InventoryPart): boolean | null {
  const want = line.name, have = partText(p);
  if (category === 'battery' || category === 'motor') {
    const a = num(want, /V\b/), b = num(have, /V\b/);
    if (a != null && b != null) return Math.abs(a - b) <= Math.max(1, a * 0.1);
  }
  if (category === 'wheel') {
    const a = num(want, /mm/), b = num(have, /mm/);
    if (a != null && b != null) return Math.abs(a - b) <= 5;
  }
  const w = tokens(want), h = tokens(have);
  for (const t of w) if (h.has(t)) return true;
  return null;
}

function linesFromSpec(spec: Spec): { line: BomLine; category: string }[] {
  const out: { line: BomLine; category: string }[] = [];
  const add = (key: string, name: string, qty: number, category: string, note?: string) =>
    out.push({ category, line: { key, name, qty, kind: 'catalog-part', note, sourceLabel: 'from the spec', searchQuery: name } });
  const b = spec?.battery;
  if (b) {
    const name = [String(b.chemistry ?? '').replace('lifepo4', 'LiFePO4').replace('liion', 'Li-ion').replace('lipo', 'LiPo').replace('nimh', 'NiMH').replace('lead_acid', 'lead-acid'), 'battery',
      fmt(b.voltage_v, 1, 1) && `${fmt(b.voltage_v, 1, 1)} V`, fmt(b.capacity_mah) && `${fmt(b.capacity_mah)} mAh`].filter(Boolean).join(' ');
    add('battery', name.trim(), 1, 'battery');
  }
  const m = spec?.motor;
  if (m) {
    const kind = String(m.kind ?? 'DC').replace(/_/g, ' ').replace(/^dc\b/i, 'DC').replace(/^bldc\b/i, 'BLDC');
    const name = [kind, /motor/i.test(kind) ? '' : 'motor', fmt(m.voltage_v, 1, 1) && `${fmt(m.voltage_v, 1, 1)} V`].filter(Boolean).join(' ');
    add('motor', name, Number(m.count) > 0 ? Number(m.count) : 1, 'motor', fmt(m.stall_torque_nm, 1, 2) ? `stall torque ${fmt(m.stall_torque_nm, 1, 2)} N·m` : undefined);
  }
  const w = spec?.wheel;
  if (w) {
    const d = fmt(w.diameter_m, 1000), wd = fmt(w.width_m, 1000);
    add('wheel', `Wheel ${d ?? '?'} mm${wd ? ` × ${wd} mm` : ''}`, Number(w.count) > 0 ? Number(w.count) : 1, 'wheel');
  }
  if (isWiring(spec?.wiring)) {
    for (const n of spec.wiring.nodes) {
      const r = role(spec.wiring, n.id);
      const cat = categoryFor(r);
      // battery and motors are already lines from the spec
      if (cat === 'battery' && out.some((o) => o.category === 'battery')) continue;
      if (cat === 'motor' && out.some((o) => o.category === 'motor')) continue;
      const qty = Number(/×\s*(\d+)/.exec(n.label)?.[1]) || 1;
      const name = n.label.replace(/\s*×\s*\d+\s*$/, '').trim();
      add('wire-' + n.id, name, qty, cat, n.rated_max_v ? `rated to ${n.rated_max_v} V` : undefined);
    }
  }
  return out;
}

export default function BomTab({ spec, robotId, robotName, inventory }: {
  spec: Spec; robotId: string; robotName: string; inventory: InventoryPart[];
}) {
  /* The wizard's build-plan profile, through the store layer: in
   * demo mode this reads the profile's ".demo" twin, and no read
   * here ever leaves the browser. */
  const [profile, saveProfile] = useStore<ConstraintsProfile>(PROFILE_KEY, DEFAULT_PROFILE);
  /* Record (or clear) the builder's own price for one line. It goes in
   * the same build-plan store, under the same key the row reads, so the
   * badge and the total pick it up and label it "your entered price". */
  const setPrice = (key: string, raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw);
    const prices = { ...profile.prices };
    if (n === null || !Number.isFinite(n) || n < 0) delete prices[key]; else prices[key] = n;
    saveProfile({ ...profile, prices });
  };
  const rows: Row[] = useMemo(() => {
    const pool = inventory.filter((p) => partSection(p) === 'parts' && p.quantity > 0 && (!p.robot_id || p.robot_id === robotId));
    const left = new Map(pool.map((p) => [p.id, p.quantity]));
    // prefer a part assigned to this robot, then a real one, then sim-only
    const rank = (a: InventoryPart, b: InventoryPart) => Number(b.robot_id === robotId) - Number(a.robot_id === robotId) || Number(partReality(a) === 'sim_only') - Number(partReality(b) === 'sim_only');
    /* Attach the recorded price, if any. The price key is the
     * wizard's `part:<catalogue id>` when the matched shelf part
     * records that id — the only honest route from a spec-derived
     * line to a catalogue record — and the line's own key otherwise.
     * Both are exact lookups in the same store; nothing is matched
     * by name, and no record means the line stays unpriced. */
    const withPrice = (line: BomLine, category: string, have: Have): Row => {
      const partId = have.part?.catalog_part_id || undefined;
      const priceItem: PlanItem = {
        key: partId ? `part:${partId}` : line.key,
        name: line.name, qty: line.qty, role: 'buy', partId,
        sourceLabel: line.sourceLabel,
      };
      return { line, category, have, priceItem, price: resolvedPrice(priceItem, profile) };
    };
    return linesFromSpec(spec).map(({ line, category }) => {
      const family = pool.filter((p) => p.category === category).sort(rank);
      const fitting = family.filter((p) => fits(line, category, p) === true && (left.get(p.id) ?? 0) > 0);
      if (fitting.length) {
        // take units from fitting parts until the line's quantity is covered
        let got = 0, anySim = false;
        for (const p of fitting) {
          if (got >= line.qty) break;
          const take = Math.min(left.get(p.id) ?? 0, line.qty - got);
          left.set(p.id, (left.get(p.id) ?? 0) - take);
          got += take;
          if (partReality(p) === 'sim_only') anySim = true;
        }
        const part = fitting[0];
        const have: Have = got < line.qty ? { state: 'need', part, got } : { state: anySim ? 'sim' : 'have', part, got };
        return withPrice(line, category, have);
      }
      const maybe = family.find((p) => fits(line, category, p) === null);
      return withPrice(line, category, maybe ? { state: 'check', part: maybe, got: 0 } : { state: 'need', got: 0 });
    });
  }, [spec, inventory, robotId, profile]);

  /* The totals line: the same priceTotals() the wizard's budget
   * check reads, so both surfaces report the same figures — the
   * recorded total, its buckets, and the unverified web-gathered
   * share stated separately. Unpriced lines are counted out loud
   * and contribute nothing. */
  const totals = useMemo(
    () => priceTotals(rows.map((r) => r.priceItem), profile),
    [rows, profile],
  );
  const buckets = [
    totals.userSum ? `${money(totals.userSum)} your prices` : null,
    totals.sourcedSum ? `${money(totals.sourcedSum)} sourced estimates` : null,
    totals.apiSum ? `${money(totals.apiSum)} API prices` : null,
    totals.gatheredSum ? `${money(totals.gatheredSum)} web-gathered estimates` : null,
  ].filter(Boolean).join(' + ');

  const counts = { have: rows.filter((r) => r.have.state === 'have').length, sim: rows.filter((r) => r.have.state === 'sim').length, check: rows.filter((r) => r.have.state === 'check').length, need: rows.filter((r) => r.have.state === 'need').length };
  const label = (h: Have, qty: number) =>
    h.state === 'have' ? `On the shelf: ${h.part?.name}`
      : h.state === 'sim' ? `Sim only: ${h.part?.name}`
        : h.state === 'check' ? `Check it fits: ${h.part?.name}`
          : h.got > 0 ? `Have ${h.got} of ${qty} (${h.part?.name}); get ${qty - h.got} more` : 'To get';

  const exportCsv = () => {
    const lines = rows.map((r) => ({ ...r.line, note: [r.line.note, label(r.have, r.line.qty),
      /* A price rides into the export only with its record's label
       * behind it — the same rule the build plan's export follows. */
      r.price ? `${money(r.price.amount * r.line.qty)} (${r.price.label})` : 'unpriced — no price recorded'].filter(Boolean).join(' · ') }));
    const blob = new Blob([bomToCsv(lines)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${robotName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'robot'}-bom.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="ws-pane ws-bom" aria-label="Bill of materials">
      <div className="ws-history-head">
        <h3>Bill of materials</h3>
        <p className="faint">What this version of {robotName} is made of, read from its spec and wiring, checked against My parts. A part only counts as on the shelf when its name or specs match and there are enough of it. Pictures are illustrations of a typical part, not your own — except where the matched shelf part has a verified manufacturer photo in the catalogue, which is shown with its credit instead. Vendor links are searches. A line shows a price only where one is recorded for it — the price you type in, or a sourced estimate with its supplier and fetch date; a line with no record is marked unpriced and is never counted as $0.</p>
      </div>
      {rows.length === 0 ? (
        <p className="faint">The spec has no battery, motors, wheels or wiring yet, so there is nothing to list. Add them in Specs.</p>
      ) : (
        <>
          <div className="bom-summary">
            <span className="verdict pass">{counts.have} on the shelf</span>
            {counts.sim > 0 && <span className="verdict marginal">{counts.sim} sim only</span>}
            {counts.check > 0 && <span className="verdict marginal">{counts.check} to check</span>}
            <span className={'verdict ' + (counts.need ? 'fail' : 'pass')}>{counts.need} to get</span>
          </div>
          <ul className="bom-list">
            {rows.map((r) => {
              /* A verified photo belongs to a catalogue part, and the
               * only honest route from a spec-derived line to one is
               * the matched shelf part's recorded catalogue id —
               * never a name match (photoForLine's doctrine). */
              const photo = r.have.part?.catalog_part_id
                ? verifiedPhoto(catalogById.get(r.have.part.catalog_part_id))
                : null;
              return (
              <li key={r.line.key} className={'bom-row ' + r.have.state}>
                <span className="bom-art">
                  {photo ? <PartPhoto photo={photo} name={r.have.part?.name ?? r.line.name} />
                    : partArt(r.line.name, r.category) ? <span className="part-art" title="Illustration of a typical part like this, not a photo of yours"><img src={partArt(r.line.name, r.category)!} alt="" loading="lazy" /></span> : <span className="inv-noimg" aria-hidden="true">{r.category.slice(0, 1).toUpperCase()}</span>}
                  <span className="bom-qty">{r.line.qty}×</span>
                </span>
                <div className="bom-main">
                  <strong>{r.line.name}</strong>
                  <span className="faint g-small">{r.category.replace('_', ' ')}{r.line.note ? ` · ${r.line.note}` : ''}</span>
                  {/* The build-plan price badge, in the wizard's own
                   * language: a web-gathered figure is badged as an
                   * unverified estimate with its receipt; a sourced
                   * or API figure carries its ESTIMATE/API label; a
                   * user price is named as theirs; no record at all
                   * reads "Unpriced" — never a bare $0. */}
                  {r.price ? (
                    r.price.kind === 'web_gathered' ? (
                      <span>
                        <span style={{
                          border: '1px solid #b06000', color: '#b06000', borderRadius: 999,
                          padding: '0 8px', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap',
                        }}>web-gathered estimate</span>{' '}
                        <span className="faint g-small">{money(r.price.amount)} each{r.line.qty > 1 ? ` · ${money(r.price.amount * r.line.qty)} for ${r.line.qty}` : ''} · {r.price.label}</span>
                      </span>
                    ) : (
                      <span className="faint g-small">{money(r.price.amount)} each{r.line.qty > 1 ? ` · ${money(r.price.amount * r.line.qty)} for ${r.line.qty}` : ''} · {r.price.label}</span>
                    )
                  ) : (
                    <span className="faint g-small">Unpriced — no price recorded in your build plan</span>
                  )}
                  <label className="bom-price faint g-small">
                    Your price $
                    <input type="number" min={0} step={0.01} inputMode="decimal"
                      aria-label={`Your price for one ${r.line.name}`}
                      key={r.priceItem.key + ':' + (profile.prices[r.priceItem.key] ?? '')}
                      defaultValue={profile.prices[r.priceItem.key] ?? ''}
                      onBlur={(e) => setPrice(r.priceItem.key, e.currentTarget.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    each
                  </label>
                  {(r.have.state === 'need' || r.have.state === 'check') && <SourcingLinks query={r.line.searchQuery} />}
                </div>
                <span className={'bom-have ' + r.have.state} title={r.have.part ? r.have.part.name : undefined}>
                  {label(r.have, r.line.qty)}
                </span>
              </li>
              );
            })}
          </ul>
          {totals.known > 0 ? (
            <p className="g-small">
              Recorded prices total <strong>{money(totals.known)}</strong> ({buckets}).
              {totals.gatheredUnverified > 0 && <> Of the total, {money(totals.gatheredUnverified)} rests on unverified web-gathered data — the softest figure here; cross-checked or API data would outrank it.</>}
              {totals.unpricedCount > 0 && <> {totals.unpricedCount} line(s) are still unpriced — their cost is not in the total.</>}
              {' '}Shipping, tax and stock are unknown — not included in any total.
            </p>
          ) : (
            <p className="g-small faint">
              No prices are recorded for these lines in your build plan, so no total is shown — type the price you find next to a line and it will appear here as your price. Shipping, tax and stock are unknown — not included in any total.
            </p>
          )}
          <p className="ws-hist-actions">
            <button type="button" className="btn btn-sm" onClick={exportCsv}>Export CSV</button>
            <Link className="btn btn-sm btn-ghost" href={'/inventory/?robot=' + encodeURIComponent(robotId)}>Open My parts</Link>
          </p>
        </>
      )}
    </section>
  );
}
