'use client';
/* Robot page section: the spec's wiring harness, when the spec has one.
 * Fetches the spec file the same way the take-apart viewer does and
 * renders nothing if there is no wiring block. */
import { useEffect, useState } from 'react';
import { assetPath } from '@/components/home/asset';
import { isWiring, type Wiring } from '@/lib/wiring';
import WiringView from './WiringView';

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
      <p className="sub">Every cable in the spec, drawn once. Tap a part or a cable. Power on lights the harness in supply order.</p>
      <WiringView wiring={w} />
    </section>
  );
}
