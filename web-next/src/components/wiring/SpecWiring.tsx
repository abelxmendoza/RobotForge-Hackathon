'use client';
/* Robot page section: the spec's wiring harness, when the spec has one.
 * Fetches the spec file the same way the take-apart viewer does and
 * renders nothing if there is no wiring block. */
import { useEffect, useState } from 'react';
import { assetPath } from '@/components/home/asset';
import { isWiring, type Wiring } from '@/lib/wiring';
import dynamic from 'next/dynamic';
import WiringView from './WiringView';
const WiringBench3D = dynamic(() => import('./WiringBench3D'), { ssr: false, loading: () => <p className="faint">Loading the 3D bench…</p> });

export default function SpecWiring({ specFile }: { specFile: string }) {
  const [w, setW] = useState<Wiring | null>(null);
  useEffect(() => {
    let live = true;
    fetch(assetPath(specFile)).then((r) => (r.ok ? r.json() : null)).then((s) => { if (live && s && isWiring(s.wiring)) setW(s.wiring); }).catch(() => {});
    return () => { live = false; };
  }, [specFile]);
  if (!w) return null;
  return (
    <section className="section" id="wiring">
      <h2>Wiring harness</h2>
      <p className="sub">The parts on a bench in 3D, then every cable as a schematic. Power on lights the harness in supply order; Take it apart lifts the parts off one at a time.</p>
      <WiringBench3D wiring={w} />
      <WiringView wiring={w} />
    </section>
  );
}
