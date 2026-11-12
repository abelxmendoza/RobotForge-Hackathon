'use client';
import { useState } from 'react';
import type { GarageRobot } from '@/lib/garage';

const fields = [
  ['Mass', 'mass_kg', 'kg'], ['Length', 'length_m', 'm'], ['Width', 'width_m', 'm'],
  ['Height', 'height_m', 'm'], ['Wheel diameter', 'wheel.diameter_m', 'm'],
  ['Battery', 'battery.voltage_v', 'V'], ['Capacity', 'battery.capacity_mah', 'mAh'],
] as const;

export default function RobotComparison({robots, selectedId}: {robots: GarageRobot[]; selectedId: string}) {
  const [otherId, setOtherId] = useState('');
  const selected = robots.find(r => r.id === selectedId);
  const other = robots.find(r => r.id === otherId && r.id !== selectedId) ?? robots.find(r => r.id !== selectedId);
  if (!selected || !other) return null;
  const display = (robot: GarageRobot, path: string, unit: string) => {
    const spec = robot.versions.at(-1)?.spec;
    const value = path.split('.').reduce((obj, key) => obj?.[key], spec);
    return typeof value === 'number' && Number.isFinite(value) ? `${value} ${unit}` : 'Not recorded';
  };
  return <details className="ws-disclosure"><summary>Compare your robots</summary>
    <p className="faint g-small">Latest saved specs. User-entered and estimated values retain their original evidence level; this is not measured performance.</p>
    <label className="g-field">Compare with<select value={other.id} onChange={e => setOtherId(e.target.value)}>{robots.filter(r => r.id !== selectedId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <div style={{overflowX:'auto'}}><table className="g-table"><caption>Saved specifications</caption><thead><tr><th>Property</th><th>{selected.name}</th><th>{other.name}</th></tr></thead><tbody>{fields.map(([label,path,unit]) => <tr key={path}><th scope="row">{label}</th><td>{display(selected,path,unit)}</td><td>{display(other,path,unit)}</td></tr>)}</tbody></table></div>
  </details>;
}
