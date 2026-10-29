'use client';
/* The Garage: bring a robot in (a spec file, a Robodex robot, a photo,
 * or pasted JSON), edit it, and save every hardware upgrade as a new
 * version. Any version can be compared with the draft: a field diff,
 * the engineering checks before and after, and the rover field checks
 * before and after. "Fix with Muse Spark" runs the Forge loop on the
 * draft; parts confirmed in the inventory can be dropped in. */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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

const STATUS_CLASS: Record<string, string> = { PASS: 'pass', MARGINAL: 'marginal', FAIL: 'fail', NOT_CHECKED: 'norun' };

/* ------------------------------------------------------------------ */

function AddRobot({ onAdd, health, firstRobot }: { onAdd: (name: string, spec: Spec, source: VersionSource, note: string) => void; health: LiveHealth | null | undefined; firstRobot: boolean }) {
  /* Omega1 is the robot this Garage was built for: the first robot
   * in an empty Garage is named for it unless the owner changes it. */
  const [name, setName] = useState(firstRobot ? 'Omega1' : '');
  const [mode, setMode] = useState<'photo' | 'file' | 'robodex' | 'paste'>('photo');
  const [paste, setPaste] = useState('');
  const [dex, setDex] = useState(dexRobots[0]?.spec_file ?? '');
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

  const fromDex = async () => {
    setError('');
    try {
      const r = await fetch(assetPath(dex));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const robot = dexRobots.find((x) => x.spec_file === dex);
      finish(await r.json(), 'robodex', `Started from ${robot?.name ?? dex}`);
    } catch (e) {
      setError('Could not load that spec: ' + (e as Error).message);
    }
  };

  return (
    <div className="garage-add">
      <h2>Bring a robot in</h2>
      <p className="sub">Start with the robot as it is today. That becomes its baseline, and every upgrade after it is saved as a new version.</p>
      <label className="g-field">
        <span>Robot name</span>
        <input id="garage-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave empty to keep the spec's own name" />
      </label>
      <div className="g-tabs" role="tablist" aria-label="How to bring it in">
        {([['photo', 'Photo'], ['file', 'Spec file'], ['robodex', 'From the Robodex'], ['paste', 'Paste JSON']] as const).map(([id, label]) => (
          <button key={id} type="button" className="chip" role="tab" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>
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
          <p className="muted">A RobotForge spec JSON, for example one written by <code>robotforge describe</code> or exported from this Garage.</p>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose a spec file</button>
        </div>
      )}
      {mode === 'robodex' && (
        <div className="g-pane">
          <p className="muted">Start from a known robot and change it into yours.</p>
          <label className="g-field">
            <span>Robot</span>
            <select id="garage-dex" value={dex} onChange={(e) => setDex(e.target.value)}>
              {dexRobots.filter((r) => r.spec_file).map((r) => <option key={r.spec_file} value={r.spec_file}>{r.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={fromDex}>Use this robot</button>
        </div>
      )}
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
  return (
    <ul className="g-findings">
      {lines.map((l, i) => (
        <li key={i} className={severityOf(l)}><span className={'verdict ' + severityOf(l)}>{l.slice(1, l.indexOf(']'))}</span> {l.slice(l.indexOf(']') + 2)}</li>
      ))}
    </ul>
  );
}

function RoverTable({ before, after }: { before: RoverCheck[] | null; after: RoverCheck[] | null }) {
  const rows = (after ?? before ?? []).map((c, i) => ({ name: c.name, b: before?.[i], a: after?.[i] }));
  const label: Record<string, string> = { 'rover.slope_climb': 'Slope climb', 'rover.step_climb': 'Step climb', 'rover.runtime': 'Battery runtime' };
  return (
    <div className="g-tablewrap">
      <table className="g-table">
        <thead><tr><th>Check</th><th>Baseline</th><th>Draft</th></tr></thead>
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

function LoopView({ res, rounds, running, live }: { res: LoopResult | null; rounds: LoopRound[]; running: boolean; live: boolean }) {
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
  const roverOn = draft && isRover(draft);
  const roverDraft = useMemo(() => (draft && isRover(draft) ? checkRover(draft, rover).checks : null), [draft, rover]);
  const roverBase = useMemo(() => (base && isRover(base.spec) ? checkRover(base.spec, rover).checks : null), [base, rover]);
  const usableParts = inventory.filter((p) => p.status === 'confirmed' && partToChanges(p).length);
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
    <ModeBanner mode={lm.mode} reason={lm.reason}>
      {lm.mode === 'mock' ? 'Fix with Muse Spark uses offline textbook rules until live is back; the validator still decides every change.' : null}
    </ModeBanner>
    <div className="garage">
      <aside className="garage-list" aria-label="Your robots">
        <h2>Your robots</h2>
        {robots.length === 0 && <p className="faint g-small">No robots yet. Bring one in to start.</p>}
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
        <p className="faint g-small">Saved in this browser only. Use Export to keep a copy.</p>
      </aside>

      <div className="garage-main">
        {saveError && <p className="g-error" role="alert">{saveError}</p>}
        {(adding || robots.length === 0) && <AddRobot onAdd={addRobot} health={health} firstRobot={robots.length === 0} />}

        {!adding && robot && draft && (
          <>
            <div className="g-head">
              <div>
                <div className="eyebrow">Garage</div>
                <h2>{draft.name || robot.name}</h2>
              </div>
              <div className="g-head-actions">
                <button type="button" className="btn btn-sm" onClick={() => downloadJSON(`${(draft.name || 'robot').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, draft)}>Export spec</button>
                <button type="button" className="btn btn-sm" onClick={() => downloadJSON('garage.json', robot)}>Export history</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={removeRobot}>Remove</button>
              </div>
            </div>

            <section className="g-versions" aria-label="Versions">
              <h3>Versions</h3>
              <ol>
                {robot.versions.map((v, i) => (
                  <li key={v.id}>
                    <button type="button" className="g-version" aria-pressed={v.id === base?.id} onClick={() => setBaseId(v.id)} title="Compare the draft with this version">
                      <span className="g-vnum">v{i + 1}</span>
                      <span><strong>{v.label}</strong><span className="g-small faint">{SOURCE_LABEL[v.source]} · {new Date(v.createdAt).toLocaleDateString()}</span></span>
                    </button>
                    {v.note && <p className="g-small faint">{v.note}</p>}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(v.spec)))}>Load into editor</button>
                  </li>
                ))}
              </ol>
              {String(draft.description || '').startsWith('Photo draft') && (
                <p className="est">Photo draft · dimensions ESTIMATED · measure and edit them</p>
              )}
            </section>

            <section className="g-editor" aria-label="Editor">
              <h3>Edit the draft</h3>
              <p className="sub">Change what you would change on the bench. Nothing is saved until you save it as a version.</p>
              <div className="g-groups">
                {FIELD_GROUPS.map((g) => (
                  <fieldset key={g.title} className="g-group">
                    <legend>{g.title}</legend>
                    {g.fields.map((f) => <FieldInput key={f.path} field={f} spec={draft} onChange={edit} />)}
                  </fieldset>
                ))}
              </div>
              <details className="g-raw" open={rawOpen} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setRawOpen(o); if (o) { setRawText(JSON.stringify(draft, null, 2)); setRawError(''); } }}>
                <summary>Edit the full spec as JSON (sensors, wiring, part masses)</summary>
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
              {usableParts.length === 0 && (
                <p className="faint g-small">Confirmed batteries, motors and wheels in your <Link href="/inventory/">parts inventory</Link> can be fitted here with one click.</p>
              )}

              <div className="g-save">
                <label className="g-field"><span>Version name</span><input id="garage-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 4S battery upgrade" /></label>
                <label className="g-field"><span>Note</span><input id="garage-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="why, cost, where the part came from" /></label>
                <button type="button" className="btn btn-primary" disabled={!diff.length} onClick={() => saveVersion(draftNote.some((n) => n.startsWith('Muse')) ? 'muse-fix' : draftNote.some((n) => n.startsWith('Fitted')) ? 'inventory' : 'edit')}>Save as new version</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!diff.length} onClick={() => { setDraft(JSON.parse(JSON.stringify(latest!.spec))); setDraftNote([]); }}>Discard changes</button>
              </div>
            </section>

            <section className="g-compare" aria-label="Compare">
              <h3>Compare: {base?.label} → draft</h3>
              {diff.length === 0 ? <p className="faint">The draft matches {base?.label}. Edit a field to see the difference.</p> : (
                <div className="g-tablewrap">
                  <table className="g-table">
                    <thead><tr><th>Field</th><th>{base?.label}</th><th>Draft</th></tr></thead>
                    <tbody>{diff.map((d) => <tr key={d.path}><td><code>{d.path}</code></td><td>{fmtValue(d.before)}</td><td><strong>{fmtValue(d.after)}</strong></td></tr>)}</tbody>
                  </table>
                </div>
              )}

              <div className="g-checks">
                <div>
                  <h4>Engineering checks · {base?.label}</h4>
                  <Findings lines={baseLines} />
                </div>
                <div>
                  <h4>Engineering checks · draft <span className="fbadge local">LOCAL</span></h4>
                  <Findings lines={draftLines} />
                </div>
              </div>

              <div className="g-fix">
                <div className="g-fix-head">
                  <h4>Fix with Muse Spark</h4>
                  <label className="g-check"><input type="checkbox" id="garage-warnings" checked={withWarnings} onChange={(e) => setWithWarnings(e.target.checked)} /> include warnings</label>
                </div>
                <p className="g-small muted">Muse Spark proposes field changes for the findings, the checks re-run, up to three rounds. The model only proposes. The validator decides, and you decide whether to keep it.</p>
                <button type="button" className="btn btn-primary" disabled={!fixable || looping} onClick={runLoop}>{fixable ? 'Run the Forge loop' : 'Nothing to fix'}</button>
                {health !== undefined && !routeOn(health ?? null, 'fix') && fixable && (
                  <p className="faint g-small">Live fixes are off right now (<LiveOffReason h={health ?? null} route="fix" />), so the loop uses the offline textbook rules.</p>
                )}
                {(looping || loop) && <LoopView res={loop} rounds={loopRounds} running={looping} live={lm.mode === 'live'} />}
                {loop && loop.rounds.length > 0 && !looping && (
                  <button type="button" className="btn" onClick={acceptLoop}>Use these changes in the draft</button>
                )}
              </div>

              {roverOn && (
                <div className="g-rover">
                  <h4>Rover field checks <span className="g-small faint">estimates, with their assumptions</span></h4>
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
          </>
        )}
      </div>
    </div>
    </>
  );
}
