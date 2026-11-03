'use client';
/* The wiring map for a stored robot: spec.connections rendered on
 * the Wiring tab as from → to rows with an evidence badge per row,
 * plus a small editor. Adding or removing a row saves the whole list
 * as a NEW version (Garage owns the save); rows the owner adds are
 * stamped evidence OWNER with today's date — they never inherit the
 * seeded rows' DOCUMENTED badge. */
import { useState } from 'react';
import type { SpecConnection } from '@/lib/omega1Garage';

const BADGE: Record<SpecConnection['evidence'], string> = {
  DOCUMENTED: 'fbadge live',
  CODE_DEFAULT: 'fbadge planned',
  OWNER: 'fbadge recorded',
};

export default function ConnectionsSection({ connections, onSave }: {
  connections: SpecConnection[] | undefined;
  onSave: (next: SpecConnection[]) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [eFrom, setEFrom] = useState('');
  const [eTo, setETo] = useState('');
  const [eDetail, setEDetail] = useState('');

  if (!Array.isArray(connections)) return null;
  const rows = connections.filter(
    (c): c is SpecConnection => Boolean(c) && typeof c === 'object' && typeof c.from === 'string' && typeof c.to === 'string',
  );

  const add = () => {
    const f = from.trim();
    const t = to.trim();
    if (!f || !t) return;
    onSave([...rows, { from: f, to: t, detail: detail.trim(), evidence: 'OWNER', at: new Date().toISOString() }]);
    setFrom(''); setTo(''); setDetail('');
  };

  /* One tap: the owner has checked this row against the real robot.
   * The row keeps its evidence badge; the confirmation date stands
   * next to it. */
  const confirm = (i: number) => {
    onSave(rows.map((r, j) => (j === i ? { ...r, verifiedAt: new Date().toISOString() } : r)));
  };

  /* Editing a row makes it the owner's own record: OWNER badge,
   * today's date, and any earlier confirmation cleared — the edited
   * words have not been confirmed yet. */
  const saveEdit = (i: number) => {
    const f = eFrom.trim();
    const t = eTo.trim();
    if (!f || !t) return;
    onSave(rows.map((r, j) => (j === i
      ? { from: f, to: t, detail: eDetail.trim(), evidence: 'OWNER' as const, at: new Date().toISOString() }
      : r)));
    setEditIdx(null);
  };

  return (
    <section className="ws-connections" aria-label="Connections">
      <h3>Connections — where everything plugs in</h3>
      <p className="faint g-small">
        Rows badged DOCUMENTED come from the robot&apos;s own records — from Omega1&apos;s repo records,
        verify on the bench before you power anything. Rows you add are badged OWNER with the date,
        so your own notes never borrow a record&apos;s badge.
      </p>
      {rows.length === 0 && <p className="faint g-small">No connections recorded yet. Add the first one below.</p>}
      <ul className="ws-conn-list">
        {rows.map((c, i) => (
          <li key={i} className="ws-conn-row">
            {editIdx === i ? (
              <span className="ws-conn-edit">
                <input aria-label="Edit connection from" value={eFrom} onChange={(e) => setEFrom(e.target.value)} />
                <input aria-label="Edit connection to" value={eTo} onChange={(e) => setETo(e.target.value)} />
                <input aria-label="Edit connection detail" value={eDetail} onChange={(e) => setEDetail(e.target.value)} />
                <button type="button" className="btn btn-sm" disabled={!eFrom.trim() || !eTo.trim()} onClick={() => saveEdit(i)}>Save edit</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditIdx(null)}>Cancel</button>
                <span className="faint g-small">Saving an edit records the row as yours (OWNER, today&apos;s date).</span>
              </span>
            ) : (
              <>
                <span className="ws-conn-main">
                  <strong>{c.from}</strong> → <strong>{c.to}</strong>
                  {c.detail && <span className="faint"> — {c.detail}</span>}
                </span>
                <span className={BADGE[c.evidence] ?? 'fbadge recorded'}>{c.evidence}</span>
                {c.evidence === 'OWNER' && c.at && (
                  <span className="faint g-small">added {new Date(c.at).toLocaleDateString()}</span>
                )}
                {c.verifiedAt ? (
                  <span className="faint g-small">Confirmed {new Date(c.verifiedAt).toLocaleDateString()}</span>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => confirm(i)}>Confirm</button>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditIdx(i); setEFrom(c.from); setETo(c.to); setEDetail(c.detail ?? ''); }}>
                  Edit
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onSave(rows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="ws-conn-add">
        <input aria-label="Connection from" placeholder="From (e.g. Raspberry Pi 4B)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input aria-label="Connection to" placeholder="To (e.g. HC-SR04)" value={to} onChange={(e) => setTo(e.target.value)} />
        <input aria-label="Connection detail" placeholder="Detail (pins, channel, voltage…)" value={detail} onChange={(e) => setDetail(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={!from.trim() || !to.trim()} onClick={add}>Add connection</button>
      </div>
      <p className="faint g-small">Adding or removing a connection saves a new version of this robot — the old one stays in History.</p>
    </section>
  );
}
