'use client';
/* Rover kit panel: the old rover designer's parts, chassis CAD and
 * build package as one Workshop side panel. Edits go into the
 * Workshop draft; Save makes the version, as for any other change. */
import { useMemo, useState } from 'react';
import { parts as catalogue } from '@/lib/data';
import type { CataloguePart, ForgeSpec } from '@/lib/forgeEngine';
import { roverRoleChoices, swapRoverPart } from '@/lib/roverDesign';
import { defaultRoverCad, roverCadArtifacts, type RoverCadSettings } from '@/lib/roverPackage';
import { readStore } from '@/lib/store';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { parseHoles, withCad } from '@/lib/roverKit';

const cat = catalogue as unknown as CataloguePart[];
const ENCLOSURE = { length_mm: 120, width_mm: 90, height_mm: 45, wall_mm: 2, clearance_mm: 0.3, cable_dia_mm: 8, cable_count: 0 };

export async function downloadRoverPackage(robotId: string, versionId: string): Promise<string> {
  const robot = readStore<GarageRobot[]>(GARAGE_KEY, []).find((r) => r.id === robotId);
  if (!robot) throw new Error('That robot no longer exists.');
  const { createRoverPackage } = await import('@/lib/roverPackage');
  const pack = createRoverPackage(robot, versionId, new Date().toISOString());
  const url = URL.createObjectURL(new Blob([new Uint8Array(pack.bytes)], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = pack.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `Build kit downloaded: ${pack.files.length} files.`;
}

export default function RoverKitPanel({ spec, robotId, versionId, dirty, onChange, onNotice }: {
  spec: ForgeSpec; robotId: string; versionId: string; dirty: boolean;
  onChange: (next: ForgeSpec) => void; onNotice: (text: string) => void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cad: RoverCadSettings = spec.roverDesign?.cad ?? defaultRoverCad(spec);
  const [holes, setHoles] = useState(cad.chassis.holes.map((p) => p.join(', ')).join('\n'));
  const roles = useMemo(() => roverRoleChoices(spec, cat), [spec]);
  const warnings = useMemo(() => { try { return roverCadArtifacts(spec, cad).warnings; } catch (e) { return [(e as Error).message]; } }, [spec, cad]);
  const name = (id: string) => cat.find((p) => p.id === id)?.name || id;
  const setCad = (next: RoverCadSettings) => {
    try { roverCadArtifacts(spec, next); onChange(withCad(spec, next)); setError(''); } catch (e) { setError((e as Error).message); }
  };
  const plate = (key: 'lengthMm' | 'widthMm' | 'thicknessMm', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setCad({ ...cad, chassis: { ...cad.chassis, [key]: value } });
  };

  const picked = role ? roles.find((r) => r.role === role) : null;
  if (picked) return <>
    <div className="studio-panel-head"><h2>{picked.label[0].toUpperCase() + picked.label.slice(1)}</h2><button onClick={() => setRole(null)}>Back</button></div>
    <div className="studio-options" role="group" aria-label={'Choose the ' + picked.label}>
      {picked.options.map((p) => <button key={p.id} aria-pressed={p.id === picked.partId} onClick={() => {
        try { onChange(swapRoverPart(spec, picked.role, p.id, cat)); setRole(null); setError(''); } catch (e) { setError((e as Error).message); }
      }}>{p.name || p.id}</button>)}
    </div>
    {error && <p className="g-error" role="alert">{error}</p>}
  </>;

  return <>
    <span className="studio-bay">Parts</span>
    <div className="studio-roles">
      {roles.map((r) => <button key={r.role} onClick={() => setRole(r.role)} aria-label={`Change ${r.label}: ${name(r.partId)}`}>
        <small>{r.label}{r.quantity > 1 ? ` ×${r.quantity}` : ''}</small><span>{name(r.partId)}</span>
      </button>)}
    </div>
    <span className="studio-bay">Chassis plate (mm)</span>
    <div className="studio-trio">
      {([['lengthMm', 'Length'], ['widthMm', 'Width'], ['thicknessMm', 'Thick']] as const).map(([key, label]) =>
        <label className="studio-field" key={key}><span>{label}</span>
          <input type="number" min={0.5} step={1} value={cad.chassis[key]} onChange={(e) => plate(key, Number(e.target.value))} /></label>)}
    </div>
    <label className="studio-field"><span>Holes, X, Y per line <small>(blank = none)</small></span>
      <textarea rows={2} value={holes} placeholder="35, 20" onChange={(e) => {
        setHoles(e.target.value);
        try { setCad({ ...cad, chassis: { ...cad.chassis, holes: parseHoles(e.target.value) } }); } catch (err) { setError((err as Error).message); }
      }} /></label>
    <button aria-pressed={!!cad.enclosure} onClick={() => setCad({ ...cad, enclosure: cad.enclosure ? null : { ...ENCLOSURE } })}>
      {cad.enclosure ? 'Enclosure on · 120 × 90 × 45 mm' : 'Add an electronics enclosure'}
    </button>
    {error && <p className="g-error" role="alert">{error}</p>}
    {warnings.length > 0 && <p className="studio-muted">{warnings[0]}</p>}
    <button className="studio-primary" disabled={busy || dirty} onClick={async () => {
      setBusy(true); setError('');
      try { onNotice(await downloadRoverPackage(robotId, versionId)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{busy ? 'Preparing…' : 'Export build kit'}</button>
    <p className="studio-muted">{dirty ? 'Save first, then export.' : 'ZIP: parts list, CAD, STL, wiring plan. Planned, not built.'}</p>
  </>;
}
