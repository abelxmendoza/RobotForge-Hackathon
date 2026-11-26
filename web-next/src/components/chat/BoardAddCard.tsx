"use client";
/* Wrench adds a board from plain words (lib/boardAdd.ts): what changes,
 * the board chain before and after, and the 3.3 V / 5 V and ground
 * checks. Nothing is saved until Apply. */
import { useRef } from 'react';
import type { BoardAddPlan } from '@/lib/boardAdd';

export interface BoardAddProposal { robotId: string; robotName: string; baseVersionId: string; phrase: string; plan: BoardAddPlan }

export default function BoardAddCard({ proposal: p, onApply, onCancel }: { proposal: BoardAddProposal; onApply: () => void; onCancel: () => void }) {
  const once = useRef(false);
  const warn = p.plan.checks.filter((c) => c.severity === 'WARN');
  return (
    <section className="vexb" aria-label={`Add a board to ${p.robotName}`}>
      <div className="vexb-head"><strong>{p.robotName}: “{p.phrase}”</strong></div>
      <ul className="g-small">{p.plan.changes.map((c) => <li key={c}>{c}</li>)}</ul>
      <p className="g-small"><strong>Boards</strong> {p.plan.chainAfter || '—'}</p>
      {warn.map((c) => <p key={c.subject} className="g-small" role="alert"><span className="fbadge planned">Check</span> {c.detail}</p>)}
      {p.plan.todo.map((t) => <p key={t} className="g-small faint">{t}</p>)}
      <div className="dt-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { if (once.current) return; once.current = true; onApply(); }}>Apply as a new version</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
