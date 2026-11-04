'use client';
/* Upgrades approved in Wrench (lib/upgradeProposal.ts applyUpgrade),
 * shown read-only on the Wiring tab: the planned wiring rows each one
 * added, and its check counts. They are PLANNED: nothing is fitted. */
import type { Spec } from '@/lib/garage';
import type { SpecConnection } from '@/lib/omega1Garage';

interface SavedUpgrade { id: string; name: string; approved_at: string; checks: { id: string; verdict: string }[]; needs_review: string[]; mount?: { file?: string } }

export default function PlannedUpgrades({ spec }: { spec: Spec }) {
  const ups: SavedUpgrade[] = Array.isArray(spec?.upgrades) ? spec.upgrades : [];
  if (!ups.length) return null;
  const rows: SpecConnection[] = (Array.isArray(spec?.connections) ? spec.connections : []).filter((c: SpecConnection) => c?.evidence === 'PLANNED');
  return (
    <section className="ws-planned-upgrades" aria-label="Planned upgrades">
      <h3>Planned upgrades</h3>
      {ups.map((u) => {
        const mine = rows.filter((r) => r.at === u.approved_at);
        const n = (v: string) => u.checks.filter((c) => c.verdict === v).length;
        return (
          <div key={u.id} className="ws-planned-upgrade">
            <p><strong>Add {u.name.split(' — ')[0]}</strong> <span className="fbadge planned">PLANNED</span>{' '}
              <span className="faint g-small">approved {new Date(u.approved_at).toLocaleDateString()} · {n('PASS')} passed, {n('WARN')} to watch, {n('NOT_CHECKED')} not checked · {u.needs_review.length} to review</span></p>
            <ul>{mine.map((r, i) => <li key={i}><strong>{r.from}</strong> → <strong>{r.to}</strong>{r.detail && <span className="faint"> — {r.detail}</span>}</li>)}</ul>
          </div>
        );
      })}
      <p className="faint g-small">Planned wiring from approved upgrades. Not fitted yet; ask Wrench to change it, or restore an earlier version on the History tab.</p>
    </section>
  );
}
