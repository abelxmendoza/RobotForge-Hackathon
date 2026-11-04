'use client';
import { downloadText } from '@/lib/store';
import type { UpgradePlan } from '@/lib/upgradePlan';
export default function SavedUpgrade({plan,artifacts,versionId,wiring}:{plan:UpgradePlan;artifacts:{filename:string;source:string}[];versionId:string;wiring:unknown}) {
  const stale=plan.assembly.id!==versionId||JSON.stringify(plan.wiring)!==JSON.stringify(wiring);
  return <details className="ws-disclosure" open>
    <summary>Coordinated Pi 5 upgrade · {stale?'previous proposal — recheck required':'planned and incomplete'}</summary>
    <p>{stale?'The robot or wiring changed after this proposal. Its previous check results and CAD need a fresh review.':plan.summary}</p>
    <p>This is a build plan, not approval to power the hardware. Converter geometry is illustrative; electrical, mechanical and simulation gaps remain visible below.</p>
    <details className="ws-disclosure"><summary>Missing evidence ({plan.missing.length})</summary><ul>{plan.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></details>
    {plan.candidate&&<p>Electrical candidate: <a href={plan.candidate.url} target="_blank" rel="noreferrer">{plan.candidate.name}</a></p>}
    <details className="ws-disclosure"><summary>Version-bound printable proposals</summary>
      {artifacts.map(a=><p key={a.filename}><button type="button" disabled={stale} className="btn btn-sm" onClick={()=>downloadText(a.filename,a.source)}>Download {a.filename}</button></p>)}
      <p>Fit, cooling, fastener retention and printability require physical review.</p>
    </details>
  </details>;
}
