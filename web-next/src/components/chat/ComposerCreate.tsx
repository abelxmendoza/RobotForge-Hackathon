'use client';
/* Composer Create panel: the Forge Engine's generation features,
 * inside the chat composer (Abel, 2026-11-02 — generation moves into
 * the main chatbot; the Garage's standalone Generate panel is gone).
 *
 * Three deterministic, local actions — no Worker or model calls, so
 * they all work in demo mode. The catalogue the engine grounds in
 * is the built-in catalogue merged with the visitor's confirmed
 * web parts (engineCatalogue below; demo reads the empty demo
 * twin, so the demo's catalogue is the built-in one exactly):
 *   1. Generate a robot from a brief (lib/forgeEngine.generateRobot),
 *      saved to the Garage store with the exact record shape the
 *      Garage's own addGenerated used: a PLANNED first version,
 *      source 'generated', label 'Generated plan'.
 *   2. Generate acceptance tests for the current robot
 *      (lib/forgeTests.generateForgeTests), stored on that robot's
 *      latest version as spec.forgeTests — the same field the
 *      Workshop's Simulate tab reads and writes.
 *   3. Apply a Forge Engine modification to the current robot
 *      (lib/forgeEngine.applyModification), saved as a NEW version —
 *      never an in-place edit; outside the grammar, nothing is saved.
 *
 * Results are handed to the host composer via onResult and posted as
 * local action messages (pill + text + optional Open-in-Workshop
 * action) by ChatDock's postCreateResult — they never go through the
 * recorded/live answer pipeline and never carry a grounding caption
 * (that caption is reserved for live model answers, PR #122). */
import { useEffect, useState } from 'react';
import { parts as catalogParts } from '@/lib/data';
import {
  applyModification, generateRobot, parseBrief,
  type ArchetypeId, type CataloguePart, type ForgeSize,
} from '@/lib/forgeEngine';
import { mergeCatalogue, WEB_PARTS_KEY, type WebPartRecord } from '@/lib/webParts';
import { generateForgeTests, forgeTestTally } from '@/lib/forgeTests';
import {
  GARAGE_KEY, diffSpecs,
  type GarageRobot, type RobotVersion, type Spec,
} from '@/lib/garage';
import { readStore, writeStore, uid } from '@/lib/store';
import { activeRecords } from '@/lib/lifecycle';
import { readWorkshopContext, WORKSHOP_CONTEXT_EVENT } from '@/lib/workshopContext';

export interface CreateResult {
  pill: 'FORGE ENGINE' | 'FORGE TESTS';
  text: string;
  openAction?: { robotId: string; tab?: string; label: string };
}

const ARCH_LABEL: Record<string, string> = {
  differential_rover: 'Differential rover',
  mecanum_rover: 'Mecanum rover',
  robotic_arm: 'Robotic arm',
  multirotor: 'Multirotor',
};

const MOD_EXAMPLES = 'add a camera · add lidar · make it wider · swap in a bigger battery · add a part by name';

/* The engine's catalogue view: the built-in catalogue merged with
 * the visitor's confirmed web parts (lib/webParts.ts) — web entries
 * ride in flagged WEB-SOURCED — UNVERIFIED and the engine's checks
 * flag any build that uses one. A local store read only (no Worker
 * or model call), so the panel stays fully local; in demo mode the
 * store layer reads the demo twin, which holds no web parts, so
 * demo generation grounds in exactly the built-in catalogue. */
function engineCatalogue(): CataloguePart[] {
  return mergeCatalogue(
    catalogParts as unknown as CataloguePart[],
    readStore<WebPartRecord[]>(WEB_PARTS_KEY, []),
  ) as unknown as CataloguePart[];
}

/* The robot the Create panel most recently made this session: the
 * "current robot" fallback between the Workshop's selection and the
 * store's most recently created robot. */
let lastCreatedId: string | null = null;

/* Which robot tests/modify act on, in order: the Workshop-selected
 * robot (the published snapshot's name, matched against the store —
 * Garage owns selection and publishes it through the workshopContext
 * bridge), else the robot this panel last created, else the most
 * recently created robot in the store. */
export function resolveCurrentRobot(all: GarageRobot[]): GarageRobot | null {
  const active = activeRecords(all);
  if (!active.length) return null;
  const ws = readWorkshopContext();
  if (ws?.robotName) {
    const want = ws.robotName.toLowerCase();
    const byName = active.filter((r) => r.name.toLowerCase() === want);
    if (byName.length === 1) return byName[0];
    const bySpec = active.filter(
      (r) => String(r.versions[r.versions.length - 1]?.spec?.name ?? '').toLowerCase() === want,
    );
    if (bySpec.length === 1) return bySpec[0];
  }
  if (lastCreatedId) {
    const hit = active.find((r) => r.id === lastCreatedId);
    if (hit) return hit;
  }
  return [...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export default function ComposerCreate({ onResult }: { onResult: (r: CreateResult) => void }) {
  const [prompt, setPrompt] = useState('');
  const [archetype, setArchetype] = useState<'auto' | ArchetypeId>('auto');
  const [size, setSize] = useState<ForgeSize>('standard');
  const [sensors, setSensors] = useState<string[]>([]);
  const [genError, setGenError] = useState('');
  const [modText, setModText] = useState('');
  /* Re-read the store when the Workshop selection changes (the
   * bridge event) or after this panel's own writes. */
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  useEffect(() => {
    const onWs = () => bump();
    window.addEventListener(WORKSHOP_CONTEXT_EVENT, onWs);
    return () => window.removeEventListener(WORKSHOP_CONTEXT_EVENT, onWs);
  }, []);

  const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
  const current = resolveCurrentRobot(all);
  const toggleSensor = (s: string) =>
    setSensors((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const doGenerate = () => {
    const brief = parseBrief(prompt, {
      ...(archetype !== 'auto' ? { archetype } : {}),
      size,
      ...(sensors.length ? { sensors } : {}),
    });
    const spec = generateRobot(brief, engineCatalogue());
    if (!spec?.forge?.bom?.length) {
      setGenError('The engine could not ground that brief in catalogue parts — nothing was generated.');
      return;
    }
    /* The same record the Garage's addGenerated built: a PLANNED
     * first version from the Forge Engine, nothing else invented. */
    const at = new Date().toISOString();
    const entry: GarageRobot = {
      id: uid('robot'),
      name: spec.name || 'Generated robot',
      createdAt: at,
      versions: [{
        id: uid('v'), label: 'Generated plan',
        note: 'Generated by the Forge Engine — planned, not built yet',
        source: 'generated', createdAt: at, spec, planned: true,
      }],
    };
    const err = writeStore(GARAGE_KEY, [...readStore<GarageRobot[]>(GARAGE_KEY, []), entry]);
    if (err) { setGenError(err); return; }
    setGenError('');
    lastCreatedId = entry.id;
    bump();
    const checks: { verdict: string }[] = spec.forge.checks ?? [];
    const tally = (v: string) => checks.filter((c) => c.verdict === v).length;
    const partLines = (spec.forge.bom as { qty: number }[]).reduce((n, b) => n + (b.qty || 0), 0);
    onResult({
      pill: 'FORGE ENGINE',
      text:
        `Generated “${entry.name}” — PLANNED, not built yet.\n` +
        `${ARCH_LABEL[brief.archetype] ?? brief.archetype} · ${partLines} catalogue parts on the plan.\n` +
        `Forge Engine checks on its own plan: ${tally('PASS')} PASS · ${tally('WARN')} WARN · ${tally('ERROR')} ERROR · ${tally('NOT_CHECKED')} NOT_CHECKED.\n` +
        `Placement, wiring and print plans are on its Workshop tabs.`,
      openAction: { robotId: entry.id, label: 'Open in Workshop' },
    });
  };

  const doTests = () => {
    if (!current) return;
    const latest = current.versions[current.versions.length - 1];
    if (!latest) return;
    const plan = generateForgeTests(latest.spec as Spec, new Date().toISOString());
    const nextSpec = { ...(latest.spec as Spec), forgeTests: plan };
    const now = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const err = writeStore(GARAGE_KEY, now.map((r) => (r.id === current.id
      ? { ...r, versions: r.versions.map((v) => (v.id === latest.id ? { ...v, spec: nextSpec } : v)) }
      : r)));
    if (err) { setGenError(err); return; }
    bump();
    const failing = plan.tests.filter((t) => t.verdict === 'FAIL').map((t) => t.name);
    onResult({
      pill: 'FORGE TESTS',
      text:
        `Acceptance tests for “${current.name}”: ${forgeTestTally(plan)}.\n` +
        (failing.length
          ? `Failing: ${failing.join(' · ')}.\n`
          : 'No failing tests in the plan.\n') +
        `Predictions from the spec's recorded fields — not measurements. The full plan is on the Simulate tab.`,
      openAction: { robotId: current.id, tab: 'simulate', label: 'Open in Workshop — Simulate tab' },
    });
  };

  const doModify = () => {
    if (!current) return;
    const text = modText.trim();
    if (!text) return;
    const latest = current.versions[current.versions.length - 1];
    const spec = latest?.spec as Spec;
    const mod = applyModification(spec, text, engineCatalogue());
    if (!mod) {
      onResult({
        pill: 'FORGE ENGINE',
        text: spec?.forge
          ? `I can't apply “${text}” to “${current.name}” — it is outside the Forge Engine's modification grammar, so nothing was saved. Recognised modifications: ${MOD_EXAMPLES}.`
          : `I can't apply “${text}” to “${current.name}” — Forge Engine modifications apply to generated robots, and this one wasn't generated by the engine, so nothing was saved. On a generated robot, recognised modifications are: ${MOD_EXAMPLES}.`,
      });
      return;
    }
    const rows = diffSpecs(spec, mod.spec).length;
    const v: RobotVersion = {
      id: uid('v'), label: `Forge mod ${current.versions.length + 1}`,
      note: mod.summary, source: 'generated', createdAt: new Date().toISOString(),
      spec: mod.spec, planned: true,
    };
    const now = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const err = writeStore(GARAGE_KEY, now.map((r) => (r.id === current.id
      ? { ...r, versions: [...r.versions, v] }
      : r)));
    if (err) { setGenError(err); return; }
    setModText('');
    bump();
    onResult({
      pill: 'FORGE ENGINE',
      text:
        `${mod.summary}\n` +
        `Saved as a new version of “${current.name}” (${rows} spec field${rows === 1 ? '' : 's'} differ). The previous version is unchanged.`,
      openAction: { robotId: current.id, label: 'Open in Workshop' },
    });
  };

  return (
    <section className="composer-create" aria-label="Create with the Forge Engine">
      <div className="composer-create-group">
        <h4>Generate a robot <span className="fbadge local">FORGE ENGINE</span></h4>
        <p className="faint g-small">Describe it and the Forge Engine picks real catalogue parts, places them, plans the wiring and prints, and checks its own work. The result is a <strong>planned</strong> robot — not built yet.</p>
        <label className="g-field"><span>Brief</span>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. a rover with lidar and a camera for the hallway" aria-label="Robot brief" />
        </label>
        <div className="forge-gen-row">
          <label className="g-field"><span>Type</span>
            <select value={archetype} onChange={(e) => setArchetype(e.target.value as 'auto' | ArchetypeId)} aria-label="Robot type">
              <option value="auto">From the brief</option>
              <option value="differential_rover">Differential rover</option>
              <option value="mecanum_rover">Mecanum rover</option>
              <option value="robotic_arm">Robotic arm</option>
              <option value="multirotor">Multirotor</option>
            </select>
          </label>
          <label className="g-field"><span>Size</span>
            <select value={size} onChange={(e) => setSize(e.target.value as ForgeSize)} aria-label="Robot size">
              <option value="compact">Compact</option>
              <option value="standard">Standard</option>
              <option value="large">Large</option>
            </select>
          </label>
        </div>
        <fieldset className="forge-gen-sensors">
          <legend>Sensors</legend>
          {[['lidar', 'Lidar'], ['camera', 'Camera'], ['depth_camera', 'Depth camera'], ['imu', 'IMU'], ['ultrasonic', 'Ultrasonic']].map(([id, label]) => (
            <label key={id} className="g-check"><input type="checkbox" checked={sensors.includes(id)} onChange={() => toggleSensor(id)} /> {label}</label>
          ))}
        </fieldset>
        <button type="button" className="btn btn-primary" onClick={doGenerate}>Generate robot</button>
      </div>

      <div className="composer-create-group">
        <h4>Acceptance tests <span className="fbadge local">FORGE TESTS</span></h4>
        {current ? (
          <>
            <p className="faint g-small">For <strong>{current.name}</strong> — its latest version. Predictions from the spec&rsquo;s recorded fields, not measurements; the plan is stored on the version, like the Simulate tab does.</p>
            <button type="button" className="btn" onClick={doTests}>Generate acceptance tests</button>
          </>
        ) : (
          <p className="faint g-small">No robot yet — generate one above first, and its acceptance tests can be made here.</p>
        )}
      </div>

      <div className="composer-create-group">
        <h4>Modify <span className="fbadge local">FORGE ENGINE</span></h4>
        {current ? (
          <>
            <div className="forge-gen-row">
              <label className="g-field"><span>Modification — {current.name}</span>
                <input value={modText} onChange={(e) => setModText(e.target.value)} placeholder="e.g. add a camera · make it wider · swap in a bigger battery" aria-label="Modification" />
              </label>
              <button type="button" className="btn" onClick={doModify}>Apply as new version</button>
            </div>
            <p className="faint g-small">Applies to generated robots, in the engine&rsquo;s grammar ({MOD_EXAMPLES}). Anything else saves nothing and says so.</p>
          </>
        ) : (
          <p className="faint g-small">No robot yet — generate one above first, and it can be modified here.</p>
        )}
      </div>

      {genError && <p className="g-error" role="alert">{genError}</p>}
    </section>
  );
}
