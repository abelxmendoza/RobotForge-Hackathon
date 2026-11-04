'use client';
import { useMemo } from 'react';
import type { Wiring } from '@/lib/wiring';
import { harnessPlan, harnessCSV, wirevizYAML } from '@/lib/harnessPlan';

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function HarnessReport({ wiring }: { wiring: Wiring }) {
  const plan = useMemo(() => harnessPlan(wiring), [wiring]);
  const wireviz = useMemo(() => wirevizYAML(wiring), [wiring]);
  const errors = plan.checks.filter(c => c.severity === 'ERROR').length;
  const unchecked = plan.checks.filter(c => c.coverage !== 'CHECKED').length;
  return <details className="g-howto wv-notebox">
    <summary>Inspect electrical report · {errors} errors · {unchecked} incomplete checks</summary>
    <p>Recorded wiring only. Coverage describes available evidence; severity describes findings. No overall safety pass is claimed. Logic levels, ampacity, connector mating, polarity, protection and thermal limits are not checked here.</p>
    {!plan.checks.length && <p>NOT_CHECKED: no power connections are documented.</p>}
    <div style={{ overflowX: 'auto' }}><table><thead><tr><th scope="col">Check / subject</th><th scope="col">Coverage</th><th scope="col">Severity / evidence</th></tr></thead><tbody>
      {plan.checks.map((c,i) => <tr key={i}><th scope="row">{c.check.replaceAll('_',' ')}<br />{c.subject}</th><td>{c.coverage}</td><td><strong>{c.severity}</strong> · {c.detail}
        {c.values && <p>{Object.entries(c.values).map(([k,v])=>`${k}: ${Number(v.toFixed(4))}`).join(' · ')}</p>}
        {!!c.missing.length && <p>Missing: {c.missing.join('; ')}</p>}
      </td></tr>)}
    </tbody></table></div>
    <p>{plan.converterAdvice}</p>
    <p>Voltage input fields: connection volts_min_v / volts_max_v, source output_min_v / output_max_v, or fixed connection volts; target rated_min_v / rated_max_v. Pin exports use explicit connection from_pin and to_pin only.</p>
    <p><button type="button" className="btn btn-sm" onClick={()=>download('harness-report.json',JSON.stringify({wiring,...plan},null,2),'application/json')}>Export JSON + checks</button>{' '}
      <button type="button" className="btn btn-sm" onClick={()=>download('harness-connections.csv',harnessCSV(wiring),'text/csv')}>Export connection CSV</button>{' '}
      <button type="button" className="btn btn-sm" disabled={!wireviz.yaml} onClick={()=>{if(wireviz.yaml) download('harness-wireviz.yml',wireviz.yaml,'application/yaml');}}>Export WireViz YAML</button></p>
    {wireviz.missing.length > 0 && <details><summary>WireViz unavailable: missing documented pin endpoints</summary><ul>{wireviz.missing.map((m,i)=><li key={i}>{m}</li>)}</ul><p>JSON and CSV remain available with blanks preserved. Connector labels do not establish a pinout.</p></details>}
    <p className="faint">WireViz export uses YAML-compatible JSON with one conductor per documented connection. It does not infer cable bundles. No WireViz engine is included.</p>
  </details>;
}
