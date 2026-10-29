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

function useHealth() {
  const [h, setH] = useState<LiveHealth | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    liveHealth().then((x) => { if (alive) setH(x); });
    return () => { alive = false; };
  }, []);
  return h;
}

/* The landing page's short version: three jobs, one card each. */
const JOBS: { title: string; body: string; routes: string[] }[] = [
  { title: 'Reads', body: 'Robot photos, spec sheets and part labels become numbers, each marked ESTIMATED or DOCUMENT-READ.', routes: ['photo', 'part'] },
  { title: 'Drafts', body: 'Plain words or a parts list become a full engineering spec.', routes: ['describe', 'list'] },
  { title: 'Proposes fixes', body: 'When a check fails, it suggests a change. The checks accept or reject it, up to three rounds.', routes: ['fix', 'part_chat'] },
];

export function AiInsideCards() {
  const h = useHealth();
  return (
    <div className="ai-cards">
      {JOBS.map((j) => {
        const live = h ? j.routes.some((r) => routeOn(h, r)) : false;
        return (
          <article className="card ai-card" key={j.title}>
            <div className="ai-card-head">
              <h3>{j.title}</h3>
              {h === undefined ? null : live
                ? <span className="fbadge live">LIVE</span>
                : <span className="fbadge recorded" title="Falls back to recorded runs or offline rules, and says so">FALLBACK</span>}
            </div>
            <p>{j.body}</p>
          </article>
        );
      })}
      <article className="card ai-card ai-card-not">
        <h3>Not AI, on purpose</h3>
        <p>The engineering checks, the rover estimates, the URDF and twin, and the Gazebo verdict. Same answer every time.</p>
      </article>
    </div>
  );
}

export default function AiInside() {
  const h = useHealth();
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
