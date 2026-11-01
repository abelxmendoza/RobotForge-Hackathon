'use client';
/* Workshop "BOM" tab (Abel, 2026-11-01): the bill of materials for the
 * robot being edited, read straight from its spec, the battery, the
 * motors and wheels with their counts, and every part in its wiring
 * block, then checked against the person's own parts list (My parts).
 * Each line says whether a matching part is already on the shelf,
 * only in the sim, or still to get, and carries vendor SEARCH links.
 * Like the BOM wizard, it never shows a price, a stock level or an
 * availability claim. */
import { useMemo } from 'react';
import Link from 'next/link';
import SourcingLinks from '@/components/robots/SourcingLinks';
import { bomToCsv, type BomLine } from '@/lib/bom';
import { partReality, partSection, type InventoryPart } from '@/lib/inventory';
import { isWiring, role } from '@/lib/wiring';
import type { Spec } from '@/lib/garage';

type Have = { state: 'have' | 'sim' | 'need'; part?: InventoryPart };
interface Row { line: BomLine; category: string; have: Have }

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
  const rows: Row[] = useMemo(() => {
    const pool = inventory.filter((p) => partSection(p) === 'parts' && p.quantity > 0 && (!p.robot_id || p.robot_id === robotId));
    const used = new Set<string>();
    return linesFromSpec(spec).map(({ line, category }) => {
      // prefer a part assigned to this robot, then a real one, then sim-only
      const cands = pool.filter((p) => p.category === category && !used.has(p.id))
        .sort((a, b) => Number(b.robot_id === robotId) - Number(a.robot_id === robotId) || Number(partReality(a) === 'sim_only') - Number(partReality(b) === 'sim_only'));
      const part = cands[0];
      if (part) used.add(part.id);
      const have: Have = !part ? { state: 'need' } : partReality(part) === 'sim_only' ? { state: 'sim', part } : { state: 'have', part };
      return { line, category, have };
    });
  }, [spec, inventory, robotId]);

  const counts = { have: rows.filter((r) => r.have.state === 'have').length, sim: rows.filter((r) => r.have.state === 'sim').length, need: rows.filter((r) => r.have.state === 'need').length };

  const exportCsv = () => {
    const lines = rows.map((r) => ({ ...r.line, note: [r.line.note, r.have.state === 'have' ? `on the shelf: ${r.have.part?.name}` : r.have.state === 'sim' ? `sim only: ${r.have.part?.name}` : 'to get'].filter(Boolean).join(' · ') }));
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
        <p className="faint">What this version of {robotName} is made of, read from its spec and wiring, checked against My parts. Vendor links are searches; this site never shows prices.</p>
      </div>
      {rows.length === 0 ? (
        <p className="faint">The spec has no battery, motors, wheels or wiring yet, so there is nothing to list. Add them in Specs.</p>
      ) : (
        <>
          <div className="bom-summary">
            <span className="verdict pass">{counts.have} on the shelf</span>
            {counts.sim > 0 && <span className="verdict marginal">{counts.sim} sim only</span>}
            <span className={'verdict ' + (counts.need ? 'fail' : 'pass')}>{counts.need} to get</span>
          </div>
          <ul className="bom-list">
            {rows.map((r) => (
              <li key={r.line.key} className={'bom-row ' + r.have.state}>
                <span className="bom-qty">{r.line.qty}×</span>
                <div className="bom-main">
                  <strong>{r.line.name}</strong>
                  <span className="faint g-small">{r.category.replace('_', ' ')}{r.line.note ? ` · ${r.line.note}` : ''}</span>
                  {r.have.state === 'need' && <SourcingLinks query={r.line.searchQuery} />}
                </div>
                <span className={'bom-have ' + r.have.state} title={r.have.part ? r.have.part.name : undefined}>
                  {r.have.state === 'have' ? `On the shelf: ${r.have.part?.name}` : r.have.state === 'sim' ? `Sim only: ${r.have.part?.name}` : 'To get'}
                </span>
              </li>
            ))}
          </ul>
          <p className="ws-hist-actions">
            <button type="button" className="btn btn-sm" onClick={exportCsv}>Export CSV</button>
            <Link className="btn btn-sm btn-ghost" href={'/inventory/?robot=' + encodeURIComponent(robotId)}>Open My parts</Link>
            <Link className="btn btn-sm btn-ghost" href="/bom/">Full BOM wizard</Link>
          </p>
        </>
      )}
    </section>
  );
}
