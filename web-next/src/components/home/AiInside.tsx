'use client';
/* "AI inside": every place a Meta model works in RobotForge, which
 * model, and whether that route is live right now. The second list is
 * what is deliberately NOT AI, so a reader can see where the model's
 * job ends and the deterministic checks take over. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { liveHealth, routeOn } from '@/components/forge/live';
import type { LiveHealth } from '@/components/forge/model';

const OPEN = 'Muse Spark Open (Baseten, Fireworks failover)';
const VISION = 'Muse Spark vision (muse-spark-1.3, Meta Model API)';

const ROWS: { step: string; model: string; route: string; where: string; href: string }[] = [
  { step: 'Plain words → engineering spec', model: OPEN, route: 'describe', where: 'Forge', href: '/forge/' },
  { step: 'Parts list → assembled draft', model: OPEN, route: 'list', where: 'Forge', href: '/forge/' },
  { step: 'Robot photo or spec-sheet photo → draft (ESTIMATED / DOCUMENT-READ)', model: VISION, route: 'photo', where: 'Forge, Garage', href: '/forge/' },
  { step: 'Failed check → proposed fix, up to 3 rounds', model: OPEN, route: 'fix', where: 'Demo, Garage', href: '/demo/' },
  { step: 'Part photo → identified part, label values read', model: VISION, route: 'part', where: 'Parts', href: '/inventory/' },
  { step: 'Confirm each part in a chat', model: OPEN, route: 'part_chat', where: 'Parts', href: '/inventory/' },
  { step: 'Forge Guide follow-up questions', model: OPEN, route: 'chat', where: 'Every app page', href: '/forge/' },
];

const NOT_AI = [
  'Engineering checks (geometry, mass, electrical, drivetrain)',
  'Accepting or rejecting every model-proposed fix',
  'Rover slope, step and runtime estimates',
  'URDF and Gazebo twin generation',
  'The Gazebo motion gate verdict, measured against ground truth',
];

export default function AiInside() {
  const [h, setH] = useState<LiveHealth | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    liveHealth().then((x) => { if (alive) setH(x); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="ai-inside">
      <div className="ai-grid">
        <div className="g-tablewrap">
          <table className="g-table ai-table">
            <thead><tr><th>What Muse Spark does</th><th>Model</th><th>Where</th><th>Now</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.route}>
                  <td>{r.step}</td>
                  <td className="g-small">{r.model}</td>
                  <td><Link href={r.href}>{r.where}</Link></td>
                  <td>
                    {h === undefined ? <span className="faint g-small">checking…</span>
                      : routeOn(h, r.route) ? <span className="fbadge live">LIVE</span>
                      : <span className="fbadge recorded" title="Falls back to recorded runs or offline rules, and says so">FALLBACK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ai-not">
          <h3>Not AI, on purpose</h3>
          <p className="faint g-small">The model proposes. These decide, the same way every time:</p>
          <ul>{NOT_AI.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
