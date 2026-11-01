'use client';
/* The Garage: bring a robot in (a spec file, a Robodex robot, a photo,
 * or pasted JSON), edit it, and save every hardware upgrade as a new
 * version. Any version can be compared with the draft: a field diff,
 * the engineering checks before and after, and the rover field checks
 * before and after. "Fix with Muse Spark" runs the Forge loop on the
 * draft; parts confirmed in the inventory can be dropped in. */
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AssemblyWorkspace from '@/components/assembly/AssemblyWorkspace';
import RobodexPicker from './RobodexPicker';
import RobotAvatar from './RobotAvatar';
import WiringView from '@/components/wiring/WiringView';
const WiringBench3D = dynamic(() => import('@/components/wiring/WiringBench3D'), { ssr: false, loading: () => <p className="faint">Loading the 3D bench…</p> });
import { isWiring } from '@/lib/wiring';
import { robots as dexRobots } from '@/lib/data';
import { assetPath } from '@/components/home/asset';
import { forgeValidateSpec } from '@/components/forge/validate';
import { liveHealth, postJSON, routeOn, LiveOffReason } from '@/components/forge/live';
import { LiveProgress, ModeBanner, useLiveMode } from '@/components/shell/LiveStatus';
import type { LiveHealth } from '@/components/forge/model';
import { downloadJSON, uid, useStore } from '@/lib/store';
import { preparePhoto } from '@/lib/image';
import { checkRover, isRover, TERRAINS, type RoverCheck } from '@/lib/rover';
import SimulateTab from './SimulateTab';
import BomTab from './BomTab';
import { runForgeLoop, type LoopResult, type LoopRound } from '@/lib/fixloop';
import {
  diffSpecs, FIELD_GROUPS, fmtValue, GARAGE_KEY, getPath, partToChanges, setPath,
  SOURCE_LABEL, type Field, type GarageRobot, type RobotVersion, type Spec, type VersionSource,
} from '@/lib/garage';
import { INVENTORY_KEY, partReality, partSection, type InventoryPart } from '@/lib/inventory';

const now = () => new Date().toISOString();

function severityOf(line: string) {
  if (line.startsWith('[ERROR]')) return 'fail';
  if (line.startsWith('[WARN]')) return 'marginal';
  return 'pass';
}

function counts(lines: string[]) {
  return {
    errors: lines.filter((l) => l.startsWith('[ERROR]')).length,
    warns: lines.filter((l) => l.startsWith('[WARN]')).length,
  };
}

type WorkTab = 'overview' | 'build' | 'wiring' | 'specs' | 'simulate' | 'checks' | 'bom' | 'history';
const WORK_TABS: { id: WorkTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'build', label: 'Build', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { id: 'wiring', label: 'Wiring', icon: 'M6 4v6a6 6 0 0 0 12 0V4M6 20v-4M18 20v-4M4 4h4M16 4h4' },
  { id: 'specs', label: 'Specs', icon: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5' },
  { id: 'simulate', label: 'Simulate', icon: 'M3 17l5-5 4 3 8-9M14 6h6v6' },
  { id: 'checks', label: 'Checks', icon: 'M4 12l5 5L20 6' },
  { id: 'bom', label: 'BOM', icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
  { id: 'history', label: 'History', icon: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2' },
];

const ICON = {
  mass: 'M6 20h12l-2-11H8zM9.5 9a2.5 2.5 0 1 1 5 0',
  size: 'M3 17 17 3l4 4L7 21zM7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2',
  battery: 'M2 8h16v8H2zM20 11v2M6 11v2M10 11v2',
  wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  drive: 'M4 12h14M13 6l6 6-6 6',
  checks: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  field: 'M3 20l6-10 4 6 3-4 5 8z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  bench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  photo: 'M4 7h3l2-2h6l2 2h3v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
} as const;

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function verdictOf(lines: string[]): { cls: string; label: string } {
  const c = counts(lines);
  if (c.errors) return { cls: 'fail', label: `${c.errors} problem${c.errors === 1 ? '' : 's'}` };
  if (c.warns) return { cls: 'marginal', label: `${c.warns} warning${c.warns === 1 ? '' : 's'}` };
  return { cls: 'pass', label: 'Checks pass' };
}

/* A spec change in builder words: "Wheels · Diameter: 66 → 80 mm"
 * instead of a dotted path, using the editor's own field labels and
 * display units. Paths outside the editor keep their raw name. */
const FIELD_BY_PATH = new Map(FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.path, { group: g.title, field: f }] as const)));
function changeText(path: string, before: unknown, after: unknown): { label: string; before: string; after: string; unit: string } {
  const hit = FIELD_BY_PATH.get(path);
  if (!hit) return { label: path, before: fmtValue(before), after: fmtValue(after), unit: '' };
  const { group, field } = hit;
  const show = (v: unknown) => (typeof v === 'number' && field.scale ? fmtValue(+(v * field.scale).toFixed(3)) : fmtValue(v));
  return { label: `${group} · ${field.label}`, before: show(before), after: show(after), unit: field.unit ?? '' };
}

function num(v: unknown, scale = 1, digits = 0): string {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? (n * scale).toFixed(digits) : '—';
}

const STATUS_CLASS: Record<string, string> = { PASS: 'pass', MARGINAL: 'marginal', FAIL: 'fail', NOT_CHECKED: 'norun' };

/* ------------------------------------------------------------------ */

function AddRobot({ onAdd, health, firstRobot }: { onAdd: (name: string, spec: Spec, source: VersionSource, note: string) => void; health: LiveHealth | null | undefined; firstRobot: boolean }) {
  /* Omega1 is the robot this Garage was built for: the first robot
   * in an empty Garage is named for it unless the owner changes it. */
  const [name, setName] = useState(firstRobot ? 'Omega1' : '');
  const [mode, setMode] = useState<'photo' | 'file' | 'robodex' | 'paste'>('photo');
  const [paste, setPaste] = useState('');
  const [dex, setDex] = useState(dexRobots[0]?.spec_file ?? '');
  const [dexOpen, setDexOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoLive = routeOn(health ?? null, 'photo');

  const finish = (spec: Spec, source: VersionSource, why: string) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      setError('That is not a robot spec (expected a JSON object).');
      return;
    }
    const named = name.trim() ? { ...spec, name: name.trim() } : spec;
    onAdd(named.name || 'My robot', named, source, why);
    setError('');
    setPaste('');
  };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      finish(JSON.parse(await f.text()), 'upload', `Uploaded ${f.name}`);
    } catch {
      setError(`${f.name} is not valid JSON.`);
    }
  };

  const fromPhoto = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    setBusy('Muse Spark is reading the photo');
    try {
      const { full } = await preparePhoto(f);
      const r = await postJSON<{ draft: { spec: Spec; identity_guess: string } }>('/photo', { image_data_url: full, note });
      finish(r.draft.spec, 'photo', `Photo draft (${r.draft.identity_guess}); every dimension is ESTIMATED until you measure it`);
    } catch (e) {
      setError('The photo draft failed: ' + (e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const fromDex = async (file: string = dex) => {
    setError('');
    try {
      const r = await fetch(assetPath(file));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const robot = dexRobots.find((x) => x.spec_file === file);
      finish(await r.json(), 'robodex', `Started from ${robot?.name ?? file}`);
    } catch (e) {
      setError('Could not load that spec: ' + (e as Error).message);
    }
  };

  return (
    <div className="garage-add">
      {firstRobot && <EmptyBench />}
      <h2>Bring a robot in</h2>
      <p className="sub">Start with the robot as it is today.</p>
      <label className="g-field">
        <span>Robot name</span>
        <input id="garage-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave empty to keep the spec's own name" />
      </label>
      <div className="g-tabs" role="tablist" aria-label="How to bring it in">
        {([['photo', 'Photo', ICON.photo], ['file', 'Spec file', ICON.file], ['robodex', 'From the Robodex', ICON.grid], ['paste', 'Paste JSON', ICON.code]] as const).map(([id, label, icon]) => (
          <button key={id} type="button" className="chip g-addchip" role="tab" aria-pressed={mode === id} onClick={() => { setMode(id); if (id === 'robodex') setDexOpen(true); }}><Icon d={icon} size={16} />{label}</button>
        ))}
      </div>
      {mode === 'photo' && (
        <div className="g-pane">
          <p className="muted">Take or pick a photo of the whole robot. Muse Spark drafts a spec from it. Every dimension is marked ESTIMATED until you edit it with a real measurement.</p>
          <label className="g-field">
            <span>Anything the photo can’t show (optional)</span>
            <input id="garage-photo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 4S LiPo, 37 mm 12 V gearmotors, 120 mm wheels" />
          </label>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromPhoto(e.target.files?.[0])} />
          <button type="button" className="btn btn-primary" disabled={!photoLive || Boolean(busy)} onClick={() => photoRef.current?.click()}>Take or choose a photo</button>
          {!photoLive && health !== undefined && (
            <p className="faint g-note">Photo drafts are off right now: <LiveOffReason h={health ?? null} route="photo" />. Use a spec file or start from the Robodex instead.</p>
          )}
        </div>
      )}
      {mode === 'file' && (
        <div className="g-pane">
          <p className="muted">A RobotForge spec JSON, for example one written by <code>robotforge describe</code> or exported from My robots.</p>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose a spec file</button>
        </div>
      )}
      {mode === 'robodex' && (
        <div className="g-pane">
          <p className="muted">Start from a known robot and change it into yours.</p>
          <button type="button" className="btn btn-primary" onClick={() => setDexOpen(true)}>Open the Robodex</button>
        </div>
      )}
      <RobodexPicker
        open={dexOpen}
        onClose={() => setDexOpen(false)}
        onPick={(r) => {
          setDexOpen(false);
          if (r.spec_file) { setDex(r.spec_file); void fromDex(r.spec_file); }
        }}
      />
      {mode === 'paste' && (
        <div className="g-pane">
          <textarea id="garage-paste" className="g-json" rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"name": "Omega1", "drivetrain": "skid_steer", ...}' />
          <button type="button" className="btn btn-primary" disabled={!paste.trim()} onClick={() => {
            try { finish(JSON.parse(paste), 'upload', 'Pasted spec'); } catch { setError('That text is not valid JSON.'); }
          }}>Add robot</button>
        </div>
      )}
      {busy && <LiveProgress what={busy} next="The draft lands in the editor, every dimension marked ESTIMATED" />}
      {error && <p className="g-error" role="alert">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/* Empty Workshop: a robot waiting on a workbench. Decorative only. */
function EmptyBench() {
  return (
    <svg className="g-empty-art" viewBox="0 0 240 120" role="img" aria-label="An empty workbench, ready for your first robot">
      <rect x="20" y="92" width="200" height="8" rx="3" fill="var(--surface-3)" />
      <rect x="36" y="100" width="8" height="18" fill="var(--surface-3)" /><rect x="196" y="100" width="8" height="18" fill="var(--surface-3)" />
      <g className="g-empty-bot">
        <path d="M120 30v-8" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="120" cy="19" r="4" fill="var(--accent)" />
        <rect x="94" y="30" width="52" height="36" rx="10" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="2" />
        <circle cx="110" cy="48" r="5" fill="var(--accent)" /><circle cx="130" cy="48" r="5" fill="var(--accent)" />
        <rect x="88" y="68" width="64" height="12" rx="6" fill="var(--surface-3)" />
        <circle cx="100" cy="84" r="7" fill="var(--border-strong)" /><circle cx="140" cy="84" r="7" fill="var(--border-strong)" />
      </g>
      <path d="M44 86l10-22 6 4-10 22z" fill="var(--marginal)" opacity=".8" />
      <rect x="168" y="74" width="30" height="18" rx="3" fill="var(--surface-2)" stroke="var(--border)" />
      <circle cx="176" cy="83" r="2.5" fill="var(--pass)" /><circle cx="186" cy="83" r="2.5" fill="var(--fail)" />
    </svg>
  );
}

const ESTIMATED_TIP = 'ESTIMATED from the photo. Measure the real part and type it in.';

function FieldInput({ field, spec, onChange, estimated = false }: { field: Field; spec: Spec; onChange: (path: string, v: unknown) => void; estimated?: boolean }) {
  const raw = getPath(spec, field.path);
  const id = 'g-' + field.path.replace(/\./g, '-');
  if (field.kind === 'select') {
    return (
      <label className="g-field">
        <span>{field.label}</span>
        <select id={id} value={raw === undefined ? '' : String(raw)} onChange={(e) => onChange(field.path, e.target.value)}>
          {raw !== undefined && !field.options?.includes(String(raw)) && <option value={String(raw)}>{String(raw)}</option>}
          {field.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
    );
  }
  if (field.kind === 'string') {
    return (
      <label className="g-field">
        <span>{field.label}</span>
        <input id={id} value={raw === undefined || raw === null ? '' : String(raw)} onChange={(e) => onChange(field.path, e.target.value)} />
      </label>
    );
  }
  const scale = field.scale ?? 1;
  const shown = typeof raw === 'number' ? String(parseFloat((raw * scale).toPrecision(6))) : '';
  return (
    <label className={'g-field' + (estimated ? ' is-est' : '')}>
      <span>{field.label}{field.unit ? <em> {field.unit}</em> : null}{estimated && <i className="est-dot" title={ESTIMATED_TIP} aria-label="estimated" />}</span>
      <input id={id} inputMode="decimal" defaultValue={shown} key={shown} onBlur={(e) => {
        const t = e.target.value.trim();
        if (!t) { onChange(field.path, null); return; }
        const n = Number(t);
        if (!Number.isFinite(n)) { e.target.value = shown; return; }
        onChange(field.path, field.kind === 'integer' ? Math.round(n) : n / scale);
      }} />
    </label>
  );
}

function Findings({ lines }: { lines: string[] }) {
  if (lines.length === 1 && lines[0].startsWith('[INFO] all:')) {
    return <p className="g-findings-ok"><span className="verdict pass">All checks pass</span></p>;
  }
  return (
    <ul className="g-findings">
      {lines.map((l, i) => (
        <li key={i} className={severityOf(l)}><span className={'verdict ' + severityOf(l)}>{l.slice(1, l.indexOf(']'))}</span> {l.slice(l.indexOf(']') + 2)}</li>
      ))}
    </ul>
  );
}

export function RoverTable({ before, after, labels = ['Baseline', 'Draft'] }: { before: RoverCheck[] | null; after: RoverCheck[] | null; labels?: [string, string] }) {
  const rows = (after ?? before ?? []).map((c, i) => ({ name: c.name, b: before?.[i], a: after?.[i] }));
  const label: Record<string, string> = { 'rover.slope_climb': 'Slope climb', 'rover.step_climb': 'Step climb', 'rover.runtime': 'Battery runtime' };
  return (
    <div className="g-tablewrap">
      <table className="g-table">
        <thead><tr><th>Check</th><th>{labels[0]}</th><th>{labels[1]}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{label[r.name] ?? r.name}</td>
              {[r.b, r.a].map((c, i) => (
                <td key={i}>
                  {c ? (<><span className={'verdict ' + STATUS_CLASS[c.status]}>{c.status.replace('_', ' ')}</span><div className="g-small">{c.summary}</div></>) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoopView({ res, rounds, running, live }: { res: LoopResult | null; rounds: LoopRound[]; running: boolean; live: boolean }) {
  return (
    <div className="g-loop" aria-live="polite">
      {rounds.map((r) => (
        <div key={r.n} className="g-round">
          <div className="g-round-head">
            <strong>Round {r.n}</strong>
            <span className={'fbadge ' + (r.live ? 'live' : 'local')}>{r.live ? 'LIVE' : 'LOCAL'}</span>
            <span className="faint">{r.proposer}</span>
          </div>
          {r.summary && <p>{r.summary}</p>}
          <ul className="g-changes">
            {r.changes.map((c) => <li key={c.path}><code>{c.path}</code> {fmtValue(c.before)} → <strong>{fmtValue(c.value)}</strong>{c.reason ? <span className="faint"> · {c.reason}</span> : null}</li>)}
          </ul>
          <p className="g-small">Validator after this round: {r.errorsAfter} error{r.errorsAfter === 1 ? '' : 's'}.</p>
        </div>
      ))}
      {running && (live
        ? <LiveProgress what={`Muse Spark is proposing round ${rounds.length + 1}`} next="The validator re-checks the spec in your browser and decides" />
        : <p className="g-busy" role="status">Offline rules are proposing a fix…</p>)}
      {res && !running && (
        <p className={'g-loop-end ' + (res.resolved ? 'pass' : 'fail')}>
          {res.resolved ? 'Resolved' : 'Not resolved'}: {res.stop}. The validator made this call, not the model.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Garage() {
  const [robots, saveRobots, ready] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const [inventory] = useStore<InventoryPart[]>(INVENTORY_KEY, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Spec | null>(null);
  const [draftNote, setDraftNote] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [plannedDraft, setPlannedDraft] = useState(false);
  const [note, setNote] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState('');
  const [health, setHealth] = useState<LiveHealth | null | undefined>(undefined);
  const [loop, setLoop] = useState<LoopResult | null>(null);
  const [loopRounds, setLoopRounds] = useState<LoopRound[]>([]);
  const [looping, setLooping] = useState(false);
  const [withWarnings, setWithWarnings] = useState(true);
  const [rover, setRover] = useState({ terrain: 'outdoor', slopeDeg: 15, stepM: 0.05, targetMin: 30 });
  const [saveError, setSaveError] = useState('');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<WorkTab>('overview');
  const [benchWires, setBenchWires] = useState(false);
  /* #assembly (Wrench's assembly proposals link there) opens Build.
   * #tab=<workshop tab> is Wrench's Tier-0 navigation landing here. */
  useEffect(() => {
    const check = (hash: string) => {
      if (hash === '#assembly') setTab('build');
      const t = hash.match(/^#tab=(overview|build|wiring|specs|simulate|checks|bom|history)$/);
      if (t) setTab(t[1] as WorkTab);
    };
    check(window.location.hash);
    const onHash = () => check(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#assembly']") as HTMLAnchorElement | null;
      if (a) check(a.hash);
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('click', onClick, true); };
  }, []);

  /* #robot=<id> is Wrench's "open <my robot>" landing: select that robot
   * when it exists in this browser's store. Unknown ids are ignored so a
   * stale link can never blank the Workshop. */
  useEffect(() => {
    const check = () => {
      const r = window.location.hash.match(/^#robot=([A-Za-z0-9_-]+)$/);
      if (r && robots.some((x) => x.id === r[1])) setSelected(r[1]);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [robots]);

  useEffect(() => { liveHealth().then(setHealth); }, []);
  const lm = useLiveMode('fix', 'mock');
  /* Each Forge loop run gets a token; switching robots or editing the
   * draft retires it, so a slow live result can never land in another
   * robot's editor or overwrite newer edits. */
  const runRef = useRef(0);

  const robot = robots.find((r) => r.id === selected) ?? null;
  const latest = robot ? robot.versions[robot.versions.length - 1] : null;
  const base = robot ? robot.versions.find((v) => v.id === baseId) ?? latest : null;

  useEffect(() => {
    if (!ready) return;
    if (!selected && robots.length) setSelected(robots[0].id);
  }, [ready, robots, selected]);

  useEffect(() => {
    if (!robot) { setDraft(null); return; }
    const v = robot.versions[robot.versions.length - 1];
    setDraft(JSON.parse(JSON.stringify(v.spec)));
    setBaseId(v.id);
    setDraftNote([]);
    runRef.current += 1;
    setLooping(false);
    setLoop(null);
    setLoopRounds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot?.id]);

  const persist = (next: GarageRobot[]) => setSaveError(saveRobots(next) ?? '');

  const addRobot = (name: string, spec: Spec, source: VersionSource, why: string) => {
    const r: GarageRobot = {
      id: uid('robot'), name, createdAt: now(),
      versions: [{ id: uid('v'), label: 'Baseline', note: why, source, createdAt: now(), spec }],
    };
    persist([...robots, r]);
    setSelected(r.id);
    setAdding(false);
  };

  const saveVersion = (source: VersionSource) => {
    if (!robot || !draft) return;
    const v: RobotVersion = {
      id: uid('v'), label: label.trim() || `Upgrade ${robot.versions.length}`,
      note: [note.trim(), ...draftNote].filter(Boolean).join(' · '), source, createdAt: now(), spec: draft,
      ...(plannedDraft ? { planned: true } : {}),
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, name: draft.name || r.name, versions: [...r.versions, v] } : r)));
    setLabel('');
    setNote('');
    setDraftNote([]);
    setPlannedDraft(false);
  };

  const togglePlanned = (versionId: string) => {
    if (!robot) return;
    persist(robots.map((r) => (r.id === robot.id
      ? { ...r, versions: r.versions.map((v) => (v.id === versionId ? { ...v, planned: !v.planned } : v)) }
      : r)));
  };

  const removeRobot = () => {
    if (!robot) return;
    persist(robots.filter((r) => r.id !== robot.id));
    setSelected(null);
  };

  const edit = (path: string, value: unknown) => setDraft((d: Spec) => setPath(d, path, value));
  /* A finished loop result belongs to the draft it started from; once
   * the draft changes, "Use these changes" would overwrite newer edits,
   * so the result is retired. */
  const loopFrom = useRef<string>('');
  useEffect(() => {
    if (loop && JSON.stringify(draft) !== loopFrom.current) {
      setLoop(null);
      setLoopRounds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const draftLines = useMemo(() => (draft ? forgeValidateSpec(draft).lines : []), [draft]);
  const baseLines = useMemo(() => (base ? forgeValidateSpec(base.spec).lines : []), [base]);
  const diff = useMemo(() => (base && draft ? diffSpecs(base.spec, draft) : []), [base, draft]);
  /* Unsaved = the draft against the latest saved version (diff compares
   * against whichever version is picked on the timeline). */
  const unsaved = useMemo(() => (latest && draft ? diffSpecs(latest.spec, draft) : []), [latest, draft]);
  const roverOn = draft && isRover(draft);
  const roverDraft = useMemo(() => (draft && isRover(draft) ? checkRover(draft, rover).checks : null), [draft, rover]);
  const roverBase = useMemo(() => (base && isRover(base.spec) ? checkRover(base.spec, rover).checks : null), [base, rover]);
  /* Tools are equipment, not components — they live in the inventory's
   * Tools section and are never fitted to a robot. Sim-only parts CAN
   * be fitted (the fit is a simulation fit, and usePart says so). */
  const usableParts = inventory.filter((p) => p.status === 'confirmed' && p.quantity > 0 && partSection(p) === 'parts' && (!p.robot_id || p.robot_id === robot?.id) && partToChanges(p).length);
  const dc = counts(draftLines);
  const fixable = dc.errors > 0 || (withWarnings && dc.warns > 0);

  const draftRef = useRef<Spec | null>(null);
  draftRef.current = draft;

  const runLoop = async () => {
    if (!draft) return;
    const token = ++runRef.current;
    const started = JSON.stringify(draft);
    loopFrom.current = started;
    const current = () => runRef.current === token && JSON.stringify(draftRef.current) === started;
    setLooping(true);
    setLoop(null);
    setLoopRounds([]);
    try {
      const res = await runForgeLoop(draft, { includeWarnings: withWarnings, onRound: (r) => { if (current()) setLoopRounds((x) => [...x, r]); } });
      const failed = res.rounds.find((r) => r.proposer.includes('live call failed'));
      if (failed) lm.noteFailure(new Error(failed.proposer.replace(/^.*live call failed: /, '').replace(/\)$/, '')));
      else if (res.rounds.some((r) => r.live)) lm.noteSuccess();
      if (current()) setLoop(res);
      else if (runRef.current === token) setLoopRounds([]);
    } finally {
      if (runRef.current === token) setLooping(false);
    }
  };

  const acceptLoop = () => {
    if (!loop) return;
    setDraft(loop.finalSpec);
    setDraftNote((n) => [...n, `Muse Spark fix: ${loop.rounds.flatMap((r) => r.changes.map((c) => c.path)).join(', ')}`]);
    if (!label) setLabel('Forge loop fix');
    setLoop(null);
    setLoopRounds([]);
  };

  const usePart = (p: InventoryPart) => {
    let d = draft;
    for (const c of partToChanges(p)) d = setPath(d, c.path, c.value);
    setDraft(d);
    setDraftNote((n) => [...n, partReality(p) === 'sim_only' ? `Fitted ${p.name} from inventory (sim only — not on your shelf)` : `Fitted ${p.name} from inventory`]);
    if (!label) setLabel(`Fit ${p.name}`);
  };

  if (!ready) return <p className="muted">Loading your garage…</p>;

  return (
    <>
    <div className="garage">
      <aside className="garage-list" aria-label="Your robots">
        <h2>Your robots</h2>
        {robots.length === 0 && <p className="faint g-small">No robots yet.</p>}
        <ul hidden={!robots.length}>
          {robots.map((r) => (
            <li key={r.id}>
              <button type="button" className="g-robot" aria-current={r.id === selected ? 'true' : undefined} onClick={() => { setSelected(r.id); setAdding(false); }}>
                <RobotAvatar names={[r.name, String(r.versions[0]?.spec?.name ?? '')]} size={36} />
                <span className="g-robot-text"><strong>{r.name}</strong>
                <span className="faint">{r.versions.length} version{r.versions.length === 1 ? '' : 's'}{r.versions[r.versions.length - 1]?.planned ? ' · planned' : ''}</span></span>
              </button>
            </li>
          ))}
        </ul>
        {robots.length > 0 && <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>+ Add a robot</button>}
        <p className="faint g-small" title="Saved in this browser only. Use Export to keep a copy.">Saved in this browser</p>
      </aside>

      <div className="garage-main">
        {saveError && <p className="g-error" role="alert">{saveError}</p>}
        {(adding || robots.length === 0) && <AddRobot onAdd={addRobot} health={health} firstRobot={robots.length === 0} />}

        {!adding && robot && draft && (() => {
          const verdict = verdictOf(draftLines);
          const roverCounts = roverDraft ? {
            pass: roverDraft.filter((c) => c.status === 'PASS').length,
            fail: roverDraft.filter((c) => c.status === 'FAIL').length,
            marginal: roverDraft.filter((c) => c.status === 'MARGINAL').length,
            unchecked: roverDraft.filter((c) => c.status !== 'PASS' && c.status !== 'FAIL' && c.status !== 'MARGINAL').length,
          } : null;
          const roverText = roverCounts ? [
            `${roverCounts.pass} pass`,
            roverCounts.marginal ? `${roverCounts.marginal} marginal` : '',
            `${roverCounts.fail} fail`,
            roverCounts.unchecked ? `${roverCounts.unchecked} not checked` : '',
          ].filter(Boolean).join(' · ') : '';
          /* A number still equal to what the photo draft guessed is ESTIMATED:
           * it gets an amber dot until the owner types a measured value. */
          const photoV = robot.versions.find((v) => v.source === 'photo')
            /* An imported or re-imported photo draft keeps its provenance only in the description. */
            ?? robot.versions.find((v) => String(v.spec?.description || '').startsWith('Photo draft'));
          const estimated = new Set<string>(photoV ? FIELD_GROUPS.flatMap((g) => g.fields)
            .filter((f) => f.kind === 'number' || f.kind === 'integer')
            .map((f) => f.path)
            .filter((p) => { const v = getPath(draft, p); return v != null && JSON.stringify(v) === JSON.stringify(getPath(photoV.spec, p)); }) : []);
          const tiles: { label: string; value: string; unit: string; icon: string; paths: string[] }[] = [
            { label: 'Mass', value: num(draft.mass_kg, 1, 2), unit: 'kg', icon: ICON.mass, paths: ['mass_kg'] },
            { label: 'Size', value: `${num(draft.length_m, 1000)} × ${num(draft.width_m, 1000)} × ${num(draft.height_m, 1000)}`, unit: 'mm', icon: ICON.size, paths: ['length_m', 'width_m', 'height_m'] },
            { label: 'Battery', value: `${num(getPath(draft, 'battery.voltage_v'), 1, 1)} V`, unit: `${num(getPath(draft, 'battery.capacity_mah'))} mAh`, icon: ICON.battery, paths: ['battery.voltage_v', 'battery.capacity_mah'] },
            { label: 'Wheels', value: `${num(getPath(draft, 'wheel.count'))} × ${num(getPath(draft, 'wheel.diameter_m'), 1000)}`, unit: 'mm', icon: ICON.wheel, paths: ['wheel.diameter_m'] },
            { label: 'Drive', value: String(draft.drivetrain ?? '—').replace(/_/g, ' '), unit: '', icon: ICON.drive, paths: [] },
          ];
          return (
          <>
            <div className="g-head ws-head">
              <div className="ws-title">
                <RobotAvatar names={[robot.name, String(draft.name ?? '')]} size={48} />
                <h2>{draft.name || robot.name}</h2>
                <span className="ws-vchip">v{robot.versions.length}</span>
                {latest?.planned && <span className="fbadge planned" title="The current version is a plan — not built yet, and its parts may not be owned.">PLANNED — not built yet</span>}
                <span key={verdict.cls} className={'verdict ws-verdict ' + verdict.cls}>{verdict.label}</span>
                <ModeBanner compact mode={lm.mode} reason={lm.reason} />
              </div>
              <div className="g-head-actions">
                <button type="button" className="btn btn-sm" onClick={() => downloadJSON(`${(draft.name || 'robot').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, draft)}>Export</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={removeRobot}>Remove</button>
              </div>
            </div>

            <ol className="ws-timeline" aria-label="Versions (pick one to compare with the draft)">
              {robot.versions.map((v, i) => (
                <li key={v.id}>
                  <button type="button" aria-pressed={v.id === base?.id} onClick={() => setBaseId(v.id)} title={`${v.label} · ${SOURCE_LABEL[v.source]} · ${new Date(v.createdAt).toLocaleDateString()}${v.note ? ' · ' + v.note : ''}`}>
                    <span className="ws-dot" aria-hidden="true" />v{i + 1} <span className="ws-vlabel">{v.label}</span>{v.planned && <span className="fbadge planned">PLANNED</span>}
                  </button>
                </li>
              ))}
            </ol>

            <div className="ws-tabs" role="tablist" aria-label="Workshop">
              {WORK_TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
                  {t.label}
                  {t.id === 'checks' && <span className={'ws-dotbadge ' + verdict.cls} aria-label={verdict.label} />}
                </button>
              ))}
            </div>

            {unsaved.length > 0 && (
              <div className="ws-savebar" role="region" aria-label="Unsaved changes">
                <span><strong>{unsaved.length} unsaved change{unsaved.length === 1 ? '' : 's'}</strong></span>
                <input id="garage-label" aria-label="Version name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version" />
                <input id="garage-note" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                <label className="ws-planned-toggle" title="A planned version is an upgrade or build that is not built yet — its parts may not be owned. It keeps a plan from being read as the as-built robot.">
                  <input type="checkbox" checked={plannedDraft} onChange={(e) => setPlannedDraft(e.target.checked)} /> Planned — not built yet
                </label>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => saveVersion(draftNote.some((n) => n.startsWith('Muse')) ? 'muse-fix' : draftNote.some((n) => n.startsWith('Fitted')) ? 'inventory' : 'edit')}>Save version</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(JSON.parse(JSON.stringify(latest!.spec))); setDraftNote([]); }}>Discard</button>
              </div>
            )}

            {tab === 'overview' && (
              <section className="ws-pane" aria-label="Overview">
                <div className="ws-tiles">
                  {tiles.map((t) => (
                    <div className="ws-tile" key={t.label}>
                      <span className="ws-tile-icon"><Icon d={t.icon} size={18} /></span>
                      <span className="ws-tile-label">{t.label}{t.paths.some((p) => estimated.has(p)) && <i className="est-dot" title={ESTIMATED_TIP} aria-label="estimated" />}</span>
                      <strong>{t.value}</strong>{t.unit && <span className="ws-tile-unit">{t.unit}</span>}
                    </div>
                  ))}
                </div>
                <div className="ws-cards">
                  <button type="button" className={'ws-card ' + verdict.cls} onClick={() => setTab('checks')}>
                    <span className="ws-card-icon"><Icon d={ICON.checks} size={22} /></span>
                    <span className="ws-card-label">Engineering checks</span>
                    <strong>{verdict.label}</strong>
                    <span className="ws-card-go">See checks →</span>
                  </button>
                  {roverCounts && (
                    <button type="button" className={'ws-card ' + (roverCounts.fail ? 'fail' : (roverCounts.marginal || roverCounts.unchecked) ? 'marginal' : 'pass')} onClick={() => setTab('simulate')}>
                      <span className="ws-card-icon"><Icon d={ICON.field} size={22} /></span>
                      <span className="ws-card-label">Field checks</span>
                      <strong>{roverText}</strong>
                      <span className="ws-card-go">Watch the test runs →</span>
                    </button>
                  )}
                  <button type="button" className="ws-card" onClick={() => setTab('history')}>
                    <span className="ws-card-icon"><Icon d={ICON.history} size={22} /></span>
                    <span className="ws-card-label">Version history</span>
                    <strong>{robot.versions.length} version{robot.versions.length === 1 ? '' : 's'}</strong>
                    <span className="ws-card-go">Open History →</span>
                  </button>
                  <button type="button" className="ws-card" onClick={() => setTab('build')}>
                    <span className="ws-card-icon"><Icon d={ICON.bench} size={22} /></span>
                    <span className="ws-card-label">Bench</span>
                    <strong>Add and place parts in 3D</strong>
                    <span className="ws-card-go">Open Build →</span>
                  </button>
                </div>
                {estimated.size > 0 && (
                  <button type="button" className="ws-estnote" onClick={() => setTab('specs')}>
                    <i className="est-dot" aria-hidden="true" /> {estimated.size} number{estimated.size === 1 ? ' is' : 's are'} guessed from the photo. <span>Measure in Specs →</span>
                  </button>
                )}
                <p><Link className="btn btn-sm" href={'/inventory/?robot=' + encodeURIComponent(robot.id)}>Photos & parts for {robot.name}</Link> </p>
              </section>
            )}

            {tab === 'wiring' && (
              <section className="ws-pane" aria-label="Wiring">
                {isWiring(draft.wiring) ? <><WiringBench3D wiring={draft.wiring} /><WiringView wiring={draft.wiring} /></> : (
                  <div className="ws-empty">
                    <svg viewBox="0 0 120 60" width="140" aria-hidden="true"><rect x="6" y="20" width="30" height="20" rx="4" fill="var(--surface-3)" /><rect x="84" y="8" width="30" height="18" rx="4" fill="var(--surface-3)" /><rect x="84" y="34" width="30" height="18" rx="4" fill="var(--surface-3)" /><path d="M36 30 C60 30 60 17 84 17" stroke="var(--marginal)" strokeWidth="2" fill="none" /><path d="M36 30 C60 30 60 43 84 43" stroke="var(--link)" strokeWidth="2" strokeDasharray="5 4" fill="none" /></svg>
                    <p><strong>No wiring recorded for this robot yet.</strong> Robodex robots such as Pathfinder and TurtleBot3 come with their harness. You can plan connections on the bench below.</p>
                  </div>
                )}
                {!benchWires && <button type="button" className="btn btn-sm" onClick={() => setBenchWires(true)}>Plan new connections on the 3D bench</button>}
              </section>
            )}

            {/* One bench instance for Build and the Wiring planner, so picking a
                planned cable in Build keeps its selection when it opens Wiring. */}
            {(tab === 'build' || (tab === 'wiring' && benchWires)) && (
              <AssemblyWorkspace key={robot.id} robotId={robot.id} view={tab === 'build' ? 'components' : 'wiring'}
                onView={(v) => { if (v === 'wiring') setBenchWires(true); setTab(v === 'components' ? 'build' : 'wiring'); }} />
            )}

            {tab === 'specs' && (
            <section className="g-editor ws-pane" aria-label="Specs">
              <div className="g-groups">
                {FIELD_GROUPS.map((g) => (
                  <fieldset key={g.title} className="g-group">
                    <legend>{g.title}</legend>
                    {g.fields.map((f) => <FieldInput key={f.path} field={f} spec={draft} onChange={edit} estimated={estimated.has(f.path)} />)}
                  </fieldset>
                ))}
              </div>
              <details className="g-raw" open={rawOpen} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setRawOpen(o); if (o) { setRawText(JSON.stringify(draft, null, 2)); setRawError(''); } }}>
                <summary>Edit as JSON</summary>
                <textarea id="garage-raw" className="g-json" rows={14} value={rawText} onChange={(e) => setRawText(e.target.value)} />
                <button type="button" className="btn btn-sm" onClick={() => {
                  try { setDraft(JSON.parse(rawText)); setRawError(''); } catch { setRawError('That is not valid JSON; the draft was not changed.'); }
                }}>Apply JSON</button>
                {rawError && <p className="g-error">{rawError}</p>}
              </details>

              {usableParts.length > 0 && (
                <div className="g-parts">
                  <h4>Fit a part from your inventory</h4>
                  <ul>
                    {usableParts.map((p) => (
                      <li key={p.id}>
                        {p.photo && <img src={p.photo} alt="" width={40} height={40} />}
                        <span><strong>{p.name}</strong> <span className="faint g-small">{partReality(p) === 'sim_only' ? 'sim only · ' : ''}{partToChanges(p).map((c) => c.path).join(', ')}</span></span>
                        <button type="button" className="btn btn-sm" onClick={() => usePart(p)}>Fit</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            )}

            {tab === 'simulate' && (
              <SimulateTab spec={draft} checks={roverDraft} opts={rover} setOpts={setRover} />
            )}

            {tab === 'bom' && (
              <BomTab spec={draft} robotId={robot.id} robotName={draft.name || robot.name} inventory={inventory} />
            )}

            {tab === 'history' && (
              <section className="ws-pane ws-history" aria-label="Version history">
                <div className="ws-history-head">
                  <h3>Version history</h3>
                  <p className="faint">Every saved change is a new version, so nothing is overwritten. Newest first.</p>
                </div>
                <ol className="ws-hist">
                  {robot.versions.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
                    const prev = i > 0 ? robot.versions[i - 1] : null;
                    const rows = prev ? diffSpecs(prev.spec, v.spec) : [];
                    const shown = rows.slice(0, 8);
                    const isLatest = i === robot.versions.length - 1;
                    return (
                      <li key={v.id} className={'ws-hist-item' + (v.id === base?.id ? ' sel' : '') + (v.planned ? ' planned' : '')}>
                        <span className="ws-hist-dot" aria-hidden="true" />
                        <div className="ws-hist-card">
                          <div className="ws-hist-top">
                            <span className="ws-hist-num">v{i + 1}</span>
                            <strong>{v.label}</strong>
                            {isLatest && <span className="fbadge">CURRENT</span>}
                            {v.planned && <span className="fbadge planned">PLANNED</span>}
                            <span className="faint ws-hist-when">{SOURCE_LABEL[v.source]} · {new Date(v.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          </div>
                          {v.note && <p className="ws-hist-note">{v.note}</p>}
                          {!prev ? (
                            <p className="faint ws-hist-none">Starting point for this robot.</p>
                          ) : rows.length === 0 ? (
                            <p className="faint ws-hist-none">Same spec as v{i}.</p>
                          ) : (
                            <ul className="ws-hist-changes" aria-label={`Changes from v${i}`}>
                              {shown.map((d) => { const c = changeText(d.path, d.before, d.after); return (
                                <li key={d.path}><span className="ws-hist-field">{c.label}</span> <span className="faint">{c.before}</span> → <strong>{c.after}</strong>{c.unit && <span className="faint"> {c.unit}</span>}</li>
                              ); })}
                              {rows.length > shown.length && <li className="faint">+{rows.length - shown.length} more change{rows.length - shown.length === 1 ? '' : 's'}</li>}
                            </ul>
                          )}
                          <div className="ws-hist-actions">
                            <button type="button" className="btn btn-sm" onClick={() => { setBaseId(v.id); setTab('checks'); }} title="Compare this version with the current draft in Checks">Compare with draft</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(v.spec)))} title="Load this version into the editor; saving it makes a new version">Load into editor</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => togglePlanned(v.id)} title={v.planned ? 'Mark this version as built (it records the robot as it is)' : 'Mark this version as planned (not built yet)'}>{v.planned ? 'Mark built' : 'Mark planned'}</button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <p><button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadJSON('garage.json', robot)}>Export history</button></p>
              </section>
            )}

            {tab === 'checks' && (
            <section className="g-compare ws-pane" aria-label="Checks">
              <h3>{base?.label} → draft</h3>
              {diff.length === 0 ? <p className="faint">No changes yet. Edit a spec to compare.</p> : (
                <div className="g-tablewrap">
                  <table className="g-table">
                    <thead><tr><th>Field</th><th>{base?.label}</th><th>Draft</th></tr></thead>
                    <tbody>{diff.map((d) => <tr key={d.path}><td><code>{d.path}</code></td><td>{fmtValue(d.before)}</td><td><strong>{fmtValue(d.after)}</strong></td></tr>)}</tbody>
                  </table>
                </div>
              )}

              <div className="g-checks">
                <div>
                  <h4>Engineering · {base?.label}</h4>
                  <Findings lines={baseLines} />
                </div>
                <div>
                  <h4>Engineering · draft <span className="fbadge local">LOCAL</span></h4>
                  <Findings lines={draftLines} />
                </div>
              </div>

              <div className="g-fix">
                <div className="g-fix-head">
                  <h4>Fix with Muse Spark</h4>
                  <label className="g-check"><input type="checkbox" id="garage-warnings" checked={withWarnings} onChange={(e) => setWithWarnings(e.target.checked)} /> include warnings</label>
                </div>
                <p className="g-small muted" title="Muse Spark proposes field changes for the findings, the checks re-run, up to three rounds. The validator decides, and you decide whether to keep it.">Proposes fixes. The checks decide, then you do.</p>
                <button type="button" className="btn btn-primary" disabled={!fixable || looping} onClick={runLoop}>{fixable ? 'Run the Forge loop' : 'Nothing to fix'}</button>
                {health !== undefined && !routeOn(health ?? null, 'fix') && fixable && (
                  <p className="faint g-small">Offline: uses textbook rules (<LiveOffReason h={health ?? null} route="fix" />).</p>
                )}
                {(looping || loop) && <LoopView res={loop} rounds={loopRounds} running={looping} live={lm.mode === 'live'} />}
                {loop && loop.rounds.length > 0 && !looping && (
                  <button type="button" className="btn" onClick={acceptLoop}>Use these changes in the draft</button>
                )}
              </div>

              {roverOn && (
                <div className="g-rover">
                  <h4>Field checks <span className="g-small faint">estimates</span></h4>
                  <div className="g-rover-opts">
                    <label className="g-field"><span>Terrain</span>
                      <select id="garage-terrain" value={rover.terrain} onChange={(e) => setRover({ ...rover, terrain: e.target.value })}>
                        {Object.keys(TERRAINS).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="g-field"><span>Slope <em>°</em></span><input id="garage-slope" type="number" min={0} max={60} value={rover.slopeDeg} onChange={(e) => setRover({ ...rover, slopeDeg: Number(e.target.value) || 0 })} /></label>
                    <label className="g-field"><span>Step <em>mm</em></span><input id="garage-step" type="number" min={0} value={Math.round(rover.stepM * 1000)} onChange={(e) => setRover({ ...rover, stepM: (Number(e.target.value) || 0) / 1000 })} /></label>
                    <label className="g-field"><span>Runtime target <em>min</em></span><input id="garage-target" type="number" min={1} value={rover.targetMin} onChange={(e) => setRover({ ...rover, targetMin: Number(e.target.value) || 1 })} /></label>
                  </div>
                  <RoverTable before={roverBase} after={roverDraft} />
                  <details className="g-small faint"><summary>Assumptions</summary><ul>{roverDraft?.flatMap((c) => c.assumptions).filter((a, i, all) => all.indexOf(a) === i).map((a) => <li key={a}>{a}</li>)}</ul></details>
                </div>
              )}
            </section>
            )}
          </>
          );
        })()}
      </div>
    </div>
    </>
  );
}
