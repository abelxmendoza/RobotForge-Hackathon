"use client";
/* One upgrade proposal in Wrench (lib/upgradeProposal.ts): the part,
 * power and converter, wiring with connectors and pins, the mount, and
 * what was checked vs what still needs review. One Approve saves it
 * all as ONE robot version, then the saved version is checked again. */
import { useRef } from 'react';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { readStore, uid, writeStore } from '@/lib/store';
import { activeRecords } from '@/lib/lifecycle';
import { applyUpgrade, hasBlocking, recheckUpgrade, type UpgradeProposal, type Verdict } from '@/lib/upgradeProposal';

const BADGE: Record<Verdict, string> = { PASS: 'fbadge live', WARN: 'fbadge planned', ERROR: 'fbadge local', NOT_CHECKED: 'fbadge recorded' };
const WORD: Record<Verdict, string> = { PASS: 'Pass', WARN: 'Watch', ERROR: 'Blocking', NOT_CHECKED: 'Not checked' };

function downloadScad(p: UpgradeProposal) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([p.mount.scad], { type: 'text/plain' }));
  a.download = p.mount.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function UpgradeProposalCard({ proposal: p, onDone, onCancel }: {
  proposal: UpgradeProposal; onDone: (text: string, savedVersionId?: string) => void; onCancel: () => void;
}) {
  const consumed = useRef(false);
  const blocking = hasBlocking(p);
  const part = p.component.name.split(' — ')[0];
  return (
    <div className="fc-msg bot upgrade-card" role="region" aria-label={`Upgrade proposal: add ${part} to ${p.robotName}`}>
      <strong>Upgrade proposal: add {part} to {p.robotName}</strong>
      <p className="faint">{p.summary} Nothing is saved until you approve.</p>

      <h4>1 · The part</h4>
      <p>{p.component.name}. {p.component.note}{p.component.source && <> <a href={p.component.source} target="_blank" rel="noreferrer">Source</a></>}</p>
      {p.component.missing.length > 0 && <p className="faint">Not in its records yet: {p.component.missing.join('; ')}.</p>}

      <h4>2 · Power</h4>
      {p.load ? <p>{part} needs {p.load.volts} V at up to {p.load.amps} A into its {p.load.inputConnector}
        {p.battery ? <>; {p.robotName}&apos;s battery is {p.battery.nominalV} V {p.battery.chemistry}{p.battery.minV != null && <> ({p.battery.minV}–{p.battery.maxV} V)</>}.</> : '.'}
        {p.converter && <> Proposed converter: <strong>{p.converter.name}</strong> (input up to {p.converter.inputMaxV} V, {p.converter.outputV} V / {p.converter.outputA} A out).</>}</p>
        : <p>{part}&apos;s supply isn&apos;t recorded, so no power plan.</p>}

      <h4>3 · Wiring</h4>
      {p.wiring.length ? <ul>{p.wiring.map((w, i) => <li key={i}><strong>{w.from}</strong> → <strong>{w.to}</strong>: {w.detail}</li>)}</ul>
        : <p className="faint">No wiring rows: the power plan above is incomplete.</p>}

      <h4>4 · Mount and enclosure</h4>
      <p>Plate {p.mount.plateMm.join(' × ')} mm with {p.mount.standoffMm} mm standoffs on the {p.mount.partHoles.pattern} pattern; open-frame enclosure {p.mount.enclosureInnerMm.join(' × ')} mm inside, open on {p.mount.openSide}.{' '}
        <button type="button" className="btn btn-sm" onClick={() => downloadScad(p)}>Download {p.mount.filename}</button></p>
      <details><summary>Assumptions behind the mount</summary><ul>{p.mount.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>

      <h4>5 · What was checked</h4>
      <ul className="upgrade-checks">{p.checks.map((c) => <li key={c.id}><span className={BADGE[c.verdict]}>{WORD[c.verdict]}</span> <strong>{c.label}.</strong> {c.detail}</li>)}</ul>
      <details open={p.needsReview.length <= 4}><summary>Still needs your review ({p.needsReview.length})</summary><ul>{p.needsReview.map((r, i) => <li key={i}>{r}</li>)}</ul></details>

      <p className="faint">Approving saves this as one PLANNED version of {p.robotName}: the wiring rows show on its Wiring tab under Planned upgrades, and the mount, checks and review list are kept with the version. Nothing is bought or fitted.</p>
      <button type="button" className="btn btn-primary btn-sm" disabled={blocking} onClick={() => {
        if (consumed.current) return; consumed.current = true;
        try {
          const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
          if (!activeRecords(current).some((r) => r.id === p.robotId)) throw new Error('That robot is archived or no longer exists.');
          const versionId = uid('v');
          const next = applyUpgrade(current, p, versionId, new Date().toISOString());
          const err = writeStore(GARAGE_KEY, next);
          if (err) throw new Error(err);
          const robot = next.find((r) => r.id === p.robotId)!;
          const again = recheckUpgrade(robot, versionId);
          onDone(`Saved as one new version of ${p.robotName}: “Upgrade: add ${part}” (PLANNED). ${again.line} The planned wiring is on the Wiring tab under Planned upgrades. Type “undo” to restore the version before it.`, versionId);
        } catch (e) { consumed.current = false; onDone((e as Error).message); }
      }}>{blocking ? 'Fix the blocking check first' : 'Approve and save as one version'}</button>{' '}
      <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}
