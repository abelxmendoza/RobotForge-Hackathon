'use client';
/* The Garage: bring a robot in (a spec file, a Robodex robot, a photo,
 * or pasted JSON), edit it, and save every hardware upgrade as a new
 * version. Any version can be compared with the draft: a field diff,
 * the engineering checks before and after, and the rover field checks
 * before and after. "Fix with Muse Spark" runs the Forge loop on the
 * draft; parts confirmed in the inventory can be dropped in. */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AssemblyWorkspace from '@/components/assembly/AssemblyWorkspace';
import RobodexPicker from './RobodexPicker';
import { robots as dexRobots } from '@/lib/data';
import { assetPath } from '@/components/home/asset';
import { forgeValidateSpec } from '@/components/forge/validate';
import { liveHealth, postJSON, routeOn, LiveOffReason } from '@/components/forge/live';
import { LiveProgress, ModeBanner, useLiveMode } from '@/components/shell/LiveStatus';
import type { LiveHealth } from '@/components/forge/model';
import { downloadJSON, uid, useStore } from '@/lib/store';
import { preparePhoto } from '@/lib/image';
import { checkRover, isRover, TERRAINS, type RoverCheck } from '@/lib/rover';
import { runForgeLoop, type LoopResult, type LoopRound } from '@/lib/fixloop';
import {
  diffSpecs, FIELD_GROUPS, fmtValue, GARAGE_KEY, getPath, partToChanges, setPath,
  SOURCE_LABEL, type Field, type GarageRobot, type RobotVersion, type Spec, type VersionSource,
} from '@/lib/garage';
import { INVENTORY_KEY, type InventoryPart } from '@/lib/inventory';

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

type WorkTab = 'overview' | 'build' | 'wiring' | 'specs' | 'checks';
const WORK_TABS: { id: WorkTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'build', label: 'Build', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { id: 'wiring', label: 'Wiring', icon: 'M6 4v6a6 6 0 0 0 12 0V4M6 20v-4M18 20v-4M4 4h4M16 4h4' },
  { id: 'specs', label: 'Specs', icon: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5' },
  { id: 'checks', label: 'Checks', icon: 'M4 12l5 5L20 6' },
];

function verdictOf(lines: string[]): { cls: string; label: string } {
  const c = counts(lines);
  if (c.errors) return { cls: 'fail', label: `${c.errors} problem${c.errors === 1 ? '' : 's'}` };
  if (c.warns) return { cls: 'marginal', label: `${c.warns} warning${c.warns === 1 ? '' : 's'}` };
  return { cls: 'pass', label: 'Checks pass' };
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
      <h2>Bring a robot in</h2>
      <p className="sub">Start with the robot as it is today.</p>
      <label className="g-field">
        <span>Robot name</span>
        <input id="garage-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave empty to keep the spec's own name" />
      </label>
      <div className="g-tabs" role="tablist" aria-label="How to bring it in">
        {([['photo', 'Photo'], ['file', 'Spec file'], ['robodex', 'From the Robodex'], ['paste', 'Paste JSON']] as const).map(([id, label]) => (
          <button key={id} type="button" className="chip" role="tab" aria-pressed={mode === id} onClick={() => { setMode(id); if (id === 'robodex') setDexOpen(true); }}>{label}</button>
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

function FieldInput({ field, spec, onChange }: { field: Field; spec: Spec; onChange: (path: string, v: unknown) => void }) {
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
    <label className="g-field">
      <span>{field.label}{field.unit ? <em> {field.unit}</em> : null}</span>
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
  /* #assembly (Wrench's assembly proposals link there) opens Build. */
  useEffect(() => {
    const check = (hash: string) => { if (hash === '#assembly') setTab('build'); };
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
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, name: draft.name || r.name, versions: [...r.versions, v] } : r)));
    setLabel('');
    setNote('');
    setDraftNote([]);
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
  const usableParts = inventory.filter((p) => p.status === 'confirmed' && p.quantity > 0 && (!p.robot_id || p.robot_id === robot?.id) && partToChanges(p).length);
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
    setDraftNote((n) => [...n, `Fitted ${p.name} from inventory`]);
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
                <strong>{r.name}</strong>
                <span className="faint">{r.versions.length} version{r.versions.length === 1 ? '' : 's'}</span>
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
          const tiles: { label: string; value: string; unit: string }[] = [
            { label: 'Mass', value: num(draft.mass_kg, 1, 2), unit: 'kg' },
            { label: 'Size', value: `${num(draft.length_m, 1000)} × ${num(draft.width_m, 1000)} × ${num(draft.height_m, 1000)}`, unit: 'mm' },
            { label: 'Battery', value: `${num(getPath(draft, 'battery.voltage_v'), 1, 1)} V`, unit: `${num(getPath(draft, 'battery.capacity_mah'))} mAh` },
            { label: 'Wheels', value: `${num(getPath(draft, 'wheel.count'))} × ${num(getPath(draft, 'wheel.diameter_m'), 1000)}`, unit: 'mm' },
            { label: 'Drive', value: String(draft.drivetrain ?? '—').replace(/_/g, ' '), unit: '' },
          ];
          return (
          <>
            <div className="g-head ws-head">
              <div className="ws-title">
                <h2>{draft.name || robot.name}</h2>
                <span className="ws-vchip">v{robot.versions.length}</span>
                <span className={'verdict ' + verdict.cls}>{verdict.label}</span>
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
                    <span className="ws-dot" aria-hidden="true" />v{i + 1} <span className="ws-vlabel">{v.label}</span>
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
                <button type="button" className="btn btn-primary btn-sm" onClick={() => saveVersion(draftNote.some((n) => n.startsWith('Muse')) ? 'muse-fix' : draftNote.some((n) => n.startsWith('Fitted')) ? 'inventory' : 'edit')}>Save version</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(JSON.parse(JSON.stringify(latest!.spec))); setDraftNote([]); }}>Discard</button>
              </div>
            )}

            {tab === 'overview' && (
              <section className="ws-pane" aria-label="Overview">
                <div className="ws-tiles">
                  {tiles.map((t) => (
                    <div className="ws-tile" key={t.label}><span className="ws-tile-label">{t.label}</span><strong>{t.value}</strong>{t.unit && <span className="ws-tile-unit">{t.unit}</span>}</div>
                  ))}
                </div>
                <div className="ws-cards">
                  <button type="button" className={'ws-card ' + verdict.cls} onClick={() => setTab('checks')}>
                    <span className="ws-card-label">Engineering checks</span>
                    <strong>{verdict.label}</strong>
                    <span className="ws-card-go">See checks →</span>
                  </button>
                  {roverCounts && (
                    <button type="button" className={'ws-card ' + (roverCounts.fail ? 'fail' : (roverCounts.marginal || roverCounts.unchecked) ? 'marginal' : 'pass')} onClick={() => setTab('checks')}>
                      <span className="ws-card-label">Field checks</span>
                      <strong>{roverText}</strong>
                      <span className="ws-card-go">See checks →</span>
                    </button>
                  )}
                  <button type="button" className="ws-card" onClick={() => setTab('build')}>
                    <span className="ws-card-label">Bench</span>
                    <strong>Add and place parts in 3D</strong>
                    <span className="ws-card-go">Open Build →</span>
                  </button>
                </div>
                {String(draft.description || '').startsWith('Photo draft') && (
                  <p className="est">Photo draft · dimensions ESTIMATED · measure and edit them</p>
                )}
                <section className="g-versions" aria-label="Versions">
                  <h3>Versions</h3>
                  <ol>
                    {robot.versions.map((v, i) => (
                      <li key={v.id}>
                        <button type="button" className="g-version" aria-pressed={v.id === base?.id} onClick={() => setBaseId(v.id)} title="Compare the draft with this version">
                          <span className="g-vnum">v{i + 1}</span>
                          <span><strong>{v.label}</strong><span className="g-small faint">{SOURCE_LABEL[v.source]} · {new Date(v.createdAt).toLocaleDateString()}</span></span>
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(v.spec)))}>Load</button>
                      </li>
                    ))}
                  </ol>
                </section>
                <p><Link className="btn btn-sm" href={'/inventory/?robot=' + encodeURIComponent(robot.id)}>Photos & parts for {robot.name}</Link> <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadJSON('garage.json', robot)}>Export history</button></p>
              </section>
            )}

            {(tab === 'build' || tab === 'wiring') && (
              <AssemblyWorkspace key={robot.id} robotId={robot.id} view={tab === 'build' ? 'components' : 'wiring'} onView={(v) => setTab(v === 'components' ? 'build' : 'wiring')} />
            )}

            {tab === 'specs' && (
            <section className="g-editor ws-pane" aria-label="Specs">
              <div className="g-groups">
                {FIELD_GROUPS.map((g) => (
                  <fieldset key={g.title} className="g-group">
                    <legend>{g.title}</legend>
                    {g.fields.map((f) => <FieldInput key={f.path} field={f} spec={draft} onChange={edit} />)}
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
                        <span><strong>{p.name}</strong> <span className="faint g-small">{partToChanges(p).map((c) => c.path).join(', ')}</span></span>
                        <button type="button" className="btn btn-sm" onClick={() => usePart(p)}>Fit</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
