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
import {requireRobotVersion} from '@/lib/versionGuard';
import RobodexPicker from './RobodexPicker';
import SampleRobotCard from '@/components/sample/SampleRobotCard';
import { takeSampleOpenRequest } from '@/lib/sampleRobot';
import RobotAvatar from './RobotAvatar';
import SpecsDialog from './SpecsDialog';
import WrenchStart from './WrenchStart';
import WiringView from '@/components/wiring/WiringView';
import { isWiring } from '@/lib/wiring';
import { parts as catalogParts, robots as dexRobots } from '@/lib/data';
import { applyModification, type CataloguePart } from '@/lib/forgeEngine';
import { mergeCatalogue, WEB_PARTS_KEY, type WebPartRecord } from '@/lib/webParts';
import { forgeTestTally, generateForgeTests, type ForgeTest } from '@/lib/forgeTests';
import { assetPath } from '@/components/home/asset';
import { forgeValidateSpec } from '@/components/forge/validate';
import { liveHealth, postJSON, routeOn, LiveOffReason } from '@/components/forge/live';
import { LiveProgress, useLiveMode } from '@/components/shell/LiveStatus';
import type { LiveHealth, RobotSpec } from '@/components/forge/model';
import { downloadJSON, readStore, writeStore, uid, useStore } from '@/lib/store';
import { promptWrench } from '@/lib/wrenchPrompt';
import { consumeWorkshopFixRequest, publishWorkshopContext, summarizeSpec, WORKSHOP_ACTION_EVENT, WORKSHOP_FIX_EVENT, type WorkshopAction } from '@/lib/workshopContext';
import { checkRover, isRover, type RoverCheck } from '@/lib/rover';
import SimulateTab from './SimulateTab';
import SimulationWorkspace,{SavedSimulationRuns} from '@/components/simulation/SimulationWorkspace';
import OverviewTurntable, { hasBody } from './OverviewTurntable';
import { OverviewMedia } from './PhotoSpin';
import { cardImagesOf } from '@/lib/repoImport';
import BomTab from './BomTab';
import ToolsMaterialsTab from './ToolsMaterialsTab';
import Omega1Twin from './Omega1Twin';
import TwinView from './TwinView';
import ConnectionsSection from './ConnectionsSection';
import PlannedUpgrades from './PlannedUpgrades';
import ImproveTwin from './ImproveTwin';
import TakeApartPanel from './TakeApartPanel';
import WorkshopExplainer from '@/components/explain/WorkshopExplainer';
import WiringViews from './WiringViews';
import type { ScanKind, SlotScan } from '@/lib/scan3d';
import { OMEGA1_CHECK_LINES, OMEGA1_FACTS, OMEGA1_PHOTO, omega1Rover, TWIN_LABEL } from '@/lib/omega1Twin';
import { OMEGA1_ROBOT_ID, OMEGA1_SEED_NOTE, OMEGA1_SEED_SOURCE, omega1SeedSpec, type SpecConnection } from '@/lib/omega1Garage';
import { runForgeLoop, type LoopResult, type LoopRound } from '@/lib/fixloop';
import {
  clearRepos, detachRepo, diffSpecs, FIELD_GROUPS, fmtValue, GARAGE_KEY, getPath, partToChanges, robotRepos, setPath,
  SOURCE_LABEL, type Field, type GarageRobot, type RobotVersion, type Spec, type VersionSource,
} from '@/lib/garage';
import { copyAsNew, isOmega1Name, uniqueCopyName } from '@/lib/saveRobot';
import { INVENTORY_KEY, partReality, partSection, type InventoryPart } from '@/lib/inventory';
import { activeRecords, activeSelection, archivedRecords, recordSnapshot } from '@/lib/lifecycle';
import { archiveRobotInStore, replaceRobotInStore, restoreRobotInStore } from '@/lib/robotLifecycleRepository';
import { deleteOwnedRobot } from '@/lib/robotDelete';
import { workshopDraftKey } from '@/lib/robotOwnership';
import { forgetRobotScans } from '@/lib/scanStore';
import { attachRealsenseScan } from '@/lib/scanBridge';
import ScanStudioModal from '@/components/scan/ScanStudioModal';
import { noteContextLines, notesFor, removeRobotNote, ROBOT_NOTES_KEY, type RobotNote } from '@/lib/robotNotes';
import { SCAN_SLOTS } from '@/lib/scan3d';
import { tabFocus } from '@/lib/tabFocus';
import { SIM_COMMAND_EVENT } from '@/lib/simulation';

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

type WorkTab = 'overview' | 'build' | 'wiring' | 'specs' | 'simulate' | 'checks' | 'bom' | 'tools' | 'history';
const WORK_TABS: { id: WorkTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'build', label: 'Build', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { id: 'wiring', label: 'Wiring', icon: 'M6 4v6a6 6 0 0 0 12 0V4M6 20v-4M18 20v-4M4 4h4M16 4h4' },
  { id: 'bom', label: 'BOM', icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h4' },
  { id: 'checks', label: 'Test', icon: 'M4 12l5 5L20 6' },
  { id: 'history', label: 'History', icon: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2' },
  { id: 'simulate', label: 'Simulate', icon: 'M8 4l12 8-12 8z' },
];

// Preserve old specs/tools deep links alongside the seven main destinations.
function mainTab(tab: WorkTab): WorkTab {
  if (tab === 'tools') return 'bom';
  if (tab === 'specs') return 'overview';
  return tab;
}
const BOM_SECTIONS = [{ id: 'bom', label: 'Parts list' }, { id: 'tools', label: 'Tools & materials' }] as const;
type BrowserDraft = { baseline: string; spec: Spec; label: string; note: string; planned: boolean };
const draftKey = workshopDraftKey;

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

/* The verified official Scaniverse destination (Niantic Spatial's
 * site — it links the iOS and Android apps). The QR beside it
 * encodes exactly this URL; a guard test pins the three together. */
const SCANIVERSE_URL = 'https://scaniverse.com';

function AddRobot({ firstRobot, onOpenRobot }: { onAdd: (name: string, spec: Spec, source: VersionSource, note: string) => void; firstRobot: boolean; onOpenRobot: (id: string) => void }) {
  const [dexOpen, setDexOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  return (
    <div className="garage-add">
      {firstRobot && <EmptyBench />}
      {/* First run only: the Omega1 sample card leads, above every
          other way in (lib/sampleRobot.ts). Later "+ Add a robot"
          renders skip it — firstRobot is false once a robot exists. */}
      {firstRobot && <SampleRobotCard />}
      <h2>Your next robot starts in Wrench</h2>
      <p className="sub">Attach photos, a mesh scan or a spec file; bring one in from your Robodex; scan with Scaniverse on your phone or hook up an Intel RealSense camera; or describe a robot that doesn’t exist yet.</p>
      <button type="button" className="btn btn-primary" onClick={() => promptWrench({mode:'chat',text:'',attach:true})}>Attach files to Wrench</button>
      <div className="garage-add-actions">
        <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'design',text:'Generate a robot '})}>Describe a new concept</button>
        <button type="button" className="btn btn-sm" onClick={() => setDexOpen(true)}>Add from Robodex</button>
        <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Add a robot from these photos.',attach:true})}>Add photos through Wrench</button>
        <button type="button" className="btn btn-sm" aria-expanded={scanOpen} onClick={() => setScanOpen((o) => !o)}>Add a scan through Wrench</button>
        <Link href="/scan/" className="btn btn-sm">Connect Intel RealSense camera</Link>
      </div>
      {scanOpen && (
        <div className="garage-scan-how">
          <p><strong>Scan it with Scaniverse on your phone.</strong> Walk around the real robot in the Scaniverse app so it sees every side, export the scan as a PLY or GLB file, then attach that file to Wrench — a scan’s sizes stay estimated until you measure the real thing.</p>
          <div className="garage-scan-qr">
            {/* Static QR asset for SCANIVERSE_URL (generated once, decode-verified; no runtime dependency). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetPath('assets/img/scaniverse-qr.svg')} alt="QR code for the Scaniverse app site, scaniverse.com" width="120" height="120" />
            <p className="faint g-small">Point your phone camera at the code, or open <a href={SCANIVERSE_URL} target="_blank" rel="noreferrer">scaniverse.com</a> — Scaniverse by Niantic Spatial, free on iPhone and Android.</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => promptWrench({mode:'chat',text:'Add a robot from this 3D scan.',attach:true})}>Attach a scan in Wrench</button>
        </div>
      )}
      <RobodexPicker open={dexOpen} onClose={() => setDexOpen(false)} onAdded={(id) => { setDexOpen(false); onOpenRobot(id); }} />
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

/* RobotForge's own drawings (assets/img/illustrations), shown on the
 * Overview when the robot's name matches one. A drawing of the model,
 * never a photo of the person's own build, and captioned that way. */
const DRAWINGS: [string, string][] = [
  ['turtlebot3wafflepi', 'turtlebot3-waffle-pi.svg'], ['turtlebot3burger', 'turtlebot3-burger.svg'],
  ['minipupper', 'mini-pupper.svg'], ['andino', 'andino.svg'], ['pathfinder', 'pathfinder.svg'], ['deliveryrover', 'delivery-rover.svg'],
];
function drawingFor(...names: unknown[]): string | null {
  for (const n of names) {
    const k = String(n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const hit = k && DRAWINGS.find(([key]) => k.includes(key));
    if (hit) return assetPath('assets/img/illustrations/' + hit[1]);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Forge Engine v1 (lib/forgeEngine): the generated plan renders     */
/* inside the existing Workshop tabs, and a modification applies as   */
/* a NEW version. Generation itself lives in the chat's Create panel  */
/* (components/chat/ComposerCreate) since 2026-11-02. Generated = planned. */

function ForgePlacement({ spec }: { spec: Spec }) {
  const forge = spec?.forge;
  if (!forge?.placement?.length) return null;
  const L = Math.max(1, Math.round((spec.length_m ?? 0.3) * 1000));
  const W = Math.max(1, Math.round((spec.width_m ?? 0.25) * 1000));
  return (
    <section className="forge-block" aria-label="Suggested placement">
      <h3>Suggested placement <span className="fbadge local">FORGE ENGINE</span></h3>
      <p className="faint g-small">Top-down: +X is the front of the robot. Every position carries the rule that placed it.</p>
      <div className="forge-map" role="img" aria-label="Top-down placement map">
        <span className="forge-map-front" aria-hidden="true">front (+X) ↑</span>
        {forge.placement.map((p: { partId: string; role: string; pos_mm: number[] }, i: number) => {
          const left = 50 + (p.pos_mm[1] / W) * 90;
          const top = 50 - (p.pos_mm[0] / L) * 90;
          return <span key={i} className="forge-dot" style={{ left: `${left}%`, top: `${top}%` }} title={`${p.role} (${p.partId}) at [${p.pos_mm.join(', ')}] mm`} aria-hidden="true" />;
        })}
      </div>
      <ul className="forge-list">
        {forge.placement.map((p: { partId: string; role: string; pos_mm: number[]; orient: string; why: string }, i: number) => (
          <li key={i}><strong>{p.role}</strong> <span className="faint">({p.partId})</span> — [{p.pos_mm.join(', ')}] mm · {p.orient}<br /><span className="faint">{p.why}</span></li>
        ))}
      </ul>
      {forge.gather?.length > 0 && <p className="faint g-small">Not in the catalogue (gather requests, never invented): {forge.gather.join(' ')}</p>}
    </section>
  );
}

function ForgeBuild({ spec }: { spec: Spec }) {
  const forge = spec?.forge;
  if (!forge?.prints?.length && !forge?.assembly?.length) return null;
  return (
    <section className="forge-block" aria-label="Prints and assembly">
      <h3>3D prints & assembly <span className="fbadge local">FORGE ENGINE</span></h3>
      {forge.prints?.length > 0 && (
        <div className="g-tablewrap"><table className="g-table">
          <thead><tr><th>Print</th><th>Material</th><th>Orientation</th><th>Settings</th><th>Bed fit (220×220 assumed)</th><th>Filament / time</th></tr></thead>
          <tbody>{forge.prints.map((p: { name: string; scad: string; material: string; orientation: string; infill_pct: number; walls: number; bed_fit: string; filament_g_est: number; time_min_est: number; estimate_label: string }, i: number) => (
            <tr key={i}><td><strong>{p.name}</strong><br /><span className="faint">{p.scad}</span></td><td>{p.material}</td><td>{p.orientation}</td><td>{p.infill_pct}% infill · {p.walls} walls</td><td>{p.bed_fit}</td><td>{p.filament_g_est} g · ~{p.time_min_est} min<br /><span className="faint">{p.estimate_label}</span></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {forge.assembly?.length > 0 && (<>
        <h4>Assembly order</h4>
        <ol className="forge-list">{forge.assembly.map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
      </>)}
    </section>
  );
}

function ForgeWiring({ spec }: { spec: Spec }) {
  const forge = spec?.forge;
  if (!forge?.wiring?.length) return null;
  return (
    <section className="forge-block" aria-label="Suggested connections">
      <h3>Suggested connections <span className="fbadge local">FORGE ENGINE</span></h3>
      <ul className="forge-list">
        {forge.wiring.map((w: { from: string; to: string; kind: string; volts: number | null; connector: string; why: string }, i: number) => (
          <li key={i}><strong>{w.from} → {w.to}</strong> <span className="fbadge">{w.kind}</span>{w.volts !== null && w.volts !== undefined ? ` ${w.volts} V` : ''} · {w.connector}<br /><span className="faint">{w.why}</span></li>
        ))}
      </ul>
      <p className="faint g-small">Orientation: power runs battery → fuse → driver/regulator → loads; sensor orientations are on the Overview placement list. Voltage verdicts are in Checks.</p>
    </section>
  );
}

function ForgeChecks({ spec }: { spec: Spec }) {
  const forge = spec?.forge;
  if (!forge?.checks?.length) return null;
  const cls: Record<string, string> = { PASS: 'pass', WARN: 'marginal', ERROR: 'fail', NOT_CHECKED: 'norun' };
  return (
    <section className="forge-block" aria-label="Forge Engine checks">
      <h3>Forge Engine checks <span className="fbadge local">GENERATED PLAN</span></h3>
      <ul className="forge-list">
        {forge.checks.map((c: { id: string; verdict: string; detail: string }, i: number) => (
          <li key={i}><span className={'verdict ' + (cls[c.verdict] ?? 'norun')}>{c.verdict}</span> <strong>{c.id}</strong> — {c.detail}</li>
        ))}
      </ul>
    </section>
  );
}

/* Forge Tests (lib/forgeTests): a generated acceptance-test plan for
 * the draft spec, rendered in the Simulate tab. The plan is stored on
 * the spec itself (spec.forgeTests, the spec.forge pattern), so it
 * persists with whichever version the draft is saved as. A FAIL whose
 * fix is a recognised Forge Engine modification gets a button wired
 * to the same applyMod handler the Modify box uses — on generated
 * robots only; everywhere else the fix renders as guidance text. */
function ForgeTestsSection({ spec, onGenerate, onModify }: { spec: Spec; onGenerate: () => void; onModify: (text: string) => string | null }) {
  const [msg, setMsg] = useState('');
  const plan = spec?.forgeTests;
  const cls: Record<string, string> = { PASS: 'pass', FAIL: 'fail', NOT_CHECKED: 'norun' };
  const applyFix = (text: string) => {
    const r = onModify(text);
    setMsg(r ?? 'That fix could not be applied — nothing was changed.');
  };
  return (
    <section className="forge-block" aria-label="Forge Tests">
      <h3>Forge Tests <span className="fbadge local">ACCEPTANCE PLAN</span></h3>
      <p className="faint g-small">Acceptance tests generated from this spec: procedures you can run, with predicted numbers computed from the spec’s own recorded fields (the lib/rover.ts formulas the Simulate and Checks tabs use). Predictions are estimates, not measurements or a physics run; thresholds are the plan’s own, stated on each test. A test whose inputs the spec does not record is NOT_CHECKED and names the missing field. The plan is stored on the spec — save a version to keep it with this robot.</p>
      <button type="button" className="btn btn-primary" onClick={onGenerate}>{plan ? 'Regenerate acceptance tests' : 'Generate acceptance tests'}</button>
      {msg && <p className="g-small" role="status">{msg}</p>}
      {plan?.tests?.length > 0 && (
        <>
          <p className="g-small"><strong>{forgeTestTally(plan)}</strong>{plan.generatedAt ? ` · generated ${new Date(plan.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}<br /><span className="faint">{plan.model}</span></p>
          <ul className="forge-list">
            {plan.tests.map((t: ForgeTest, i: number) => (
              <li key={i}>
                <span className={'verdict ' + (cls[t.verdict] ?? 'norun')}>{t.verdict}</span> <strong>{t.name}</strong>{' '}
                <span className="fbadge">{t.kind === 'fault_injection' ? 'FAULT INJECTION' : 'ACCEPTANCE'}</span>
                {t.expected && <><br /><span className="faint">Expected:</span> {t.expected}</>}
                {t.predicted && <><br /><span className="faint">Predicted:</span> {t.predicted}</>}
                {!t.expected && t.basis && <><br />{t.basis}</>}
                {t.procedure?.length > 0 && (
                  <ol className="forge-list">{t.procedure.map((s: string, j: number) => <li key={j}>{s}</li>)}</ol>
                )}
                {t.inputs?.length > 0 && <><br /><span className="faint">Inputs: {t.inputs.join(' · ')}</span></>}
                {t.expected && t.basis && <><br /><span className="faint">Basis: {t.basis}</span></>}
                {t.suggestedFix && (t.suggestedFix.kind === 'modification' && spec?.forge ? (
                  <><br /><button type="button" className="btn btn-sm" onClick={() => applyFix(t.suggestedFix!.text)}>Apply fix: {t.suggestedFix.text}</button> <span className="faint">saves as a new version, like the Modify box</span></>
                ) : (
                  <><br /><span className="faint">Suggested fix:</span> {t.suggestedFix.text}{t.suggestedFix.kind === 'modification' ? ' (a Forge Engine modification — the Apply button appears on generated robots; otherwise use Fix with Muse Spark in the Checks tab.)' : ''}</>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ModifyBox({ spec, onModify }: { spec: Spec; onModify: (text: string) => string | null }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  if (!spec?.forge) return null;
  const go = () => {
    const r = onModify(text);
    setMsg(r ?? 'That modification is outside the engine grammar (try: add a camera, add lidar, make it wider, swap in a bigger battery) — nothing was changed.');
    if (r) setText('');
  };
  return (
    <section className="forge-block" aria-label="Modify this robot">
      <h3>Modify <span className="fbadge local">FORGE ENGINE</span></h3>
      <div className="forge-gen-row">
        <label className="g-field"><span>Modification</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. add a camera · make it wider · swap in a bigger battery" aria-label="Modification" />
        </label>
        <button type="button" className="btn" onClick={go}>Apply as new version</button>
      </div>
      {msg && <p className="g-small" role="status">{msg}</p>}
    </section>
  );
}

const ALL_REPOS = '*all*';

export default function Garage() {
  const [robots, saveRobots, ready] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const activeRobots = useMemo(() => activeRecords(robots), [robots]);
  const archivedRobots = useMemo(() => archivedRecords(robots), [robots]);
  const [inventory] = useStore<InventoryPart[]>(INVENTORY_KEY, []);
  const [allNotes] = useStore<RobotNote[]>(ROBOT_NOTES_KEY, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Spec | null>(null);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const [draftError, setDraftError] = useState('');
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
  const [lifecycleNotice, setLifecycleNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [realsenseFor, setRealsenseFor] = useState<{ id: string; name: string } | null>(null);
  /* The built-in Omega1 twin specimen (lib/omega1Twin.ts): not a
   * stored robot — a fixed entry whose view replaces the workshop
   * while it is open. */
  const [twinOpen, setTwinOpen] = useState(false);
  const [tab, setTab] = useState<WorkTab>('overview');
  /* While the twin is open, the SAME tab bar controls Omega1 instead
   * of the selected stored robot — its own tab state, so switching
   * Omega1 panes never closes the twin or touches the stored robot.
   * Entering the twin always starts it at Overview. */
  const [omegaTab, setOmegaTab] = useState<WorkTab>('overview');
  const specsReturn = useRef({ stored: 'overview' as WorkTab, twin: 'overview' as WorkTab });
  useEffect(() => { if (tab !== 'specs') specsReturn.current.stored = tab; if (omegaTab !== 'specs') specsReturn.current.twin = omegaTab; }, [tab, omegaTab]);
  const [benchWires, setBenchWires] = useState(false);
  /* #assembly (Wrench's assembly proposals link there) opens Build.
   * #tab=<workshop tab> is Wrench's Tier-0 navigation landing here. */
  useEffect(() => {
    const check = (hash: string) => {
      if (hash === '#assembly') { setTab('build'); setTwinOpen(false); setAdding(false); }
      const t = hash.match(/^#tab=(overview|build|wiring|specs|simulate|checks|bom|tools|history)$/);
      if (t) { setTab(t[1] as WorkTab); setTwinOpen(false); setAdding(false); }
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
   * stale link can never blank the Workshop. An optional &tab=<tab>
   * suffix (the chat's Create results: "Open in Workshop — Simulate
   * tab") also switches the Workshop tab in the same landing. */
  useEffect(() => {
    const check = () => {
      const r = window.location.hash.match(/^#robot=([A-Za-z0-9_-]+)(?:&tab=(overview|build|wiring|specs|simulate|checks|bom|tools|history))?$/);
      if (r && activeRobots.some((x) => x.id === r[1])) {
        setSelected(r[1]);
        setTwinOpen(false);
        if (r[2]) { setTab(r[2] as WorkTab); setAdding(false); }
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [activeRobots]);

  useEffect(() => { liveHealth().then(setHealth); }, []);
  const lm = useLiveMode('fix', 'mock');
  /* Each Forge loop run gets a token; switching robots or editing the
   * draft retires it, so a slow live result can never land in another
   * robot's editor or overwrite newer edits. */
  const runRef = useRef(0);

  const robot = activeRobots.find((r) => r.id === selected) ?? null;
  const latest = robot ? robot.versions[robot.versions.length - 1] : null;
  /* Omega1 identity is the canonical stored copy OR any robot the owner
   * has named as Omega1 (a photo import renamed "Omega1" / "Freenove"):
   * the name match (lib/saveRobot isOmega1Name) is what links it to the
   * ProjectSim twin and the real reference photo in the Overview. The
   * twin's geometry stays labelled an estimate either way. */
  const isOmegaRobot = !!robot && (robot.id === OMEGA1_ROBOT_ID || isOmega1Name(robot.name) || isOmega1Name(latest?.spec?.name));
  const base = robot ? robot.versions.find((v) => v.id === baseId) ?? latest : null;

  useEffect(() => {
    if (!ready) return;
    const requested=window.location.hash.match(/^#robot=([A-Za-z0-9_-]+)/)?.[1];
    const next = activeSelection(activeRobots, selected??(activeRobots.some(r=>r.id===requested)?requested!:null));
    if (next !== selected) setSelected(next);
  }, [ready, activeRobots, selected]);

  const loadedSpec = useRef<{id:string; spec:Spec} | null>(null);
  useEffect(() => {
    if (!robot) { setDraft(null); loadedSpec.current = null; return; }
    const v = robot.versions[robot.versions.length - 1];
    const previous = loadedSpec.current;
    loadedSpec.current = {id:robot.id,spec:v.spec};
    if (previous?.id === robot.id && draft && diffSpecs(previous.spec,draft).length > 0) return;
    const cached = readStore<BrowserDraft | null>(draftKey(robot.id), null);
    const restored = cached?.baseline === v.id && cached.spec && typeof cached.spec === 'object' && !Array.isArray(cached.spec) ? cached : null;
    setDraft(JSON.parse(JSON.stringify(restored?.spec ?? v.spec)));
    setLabel(restored?.label ?? '');
    setNote(restored?.note ?? '');
    setPlannedDraft(restored?.planned ?? !!v.planned);
    setDraftOwner(robot.id);
    setBaseId(v.id);
    setDraftNote([]);
    runRef.current += 1;
    setLooping(false);
    setLoop(null);
    setLoopRounds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot?.id, latest?.id]);

  const persist = (next: GarageRobot[]) => { const error = saveRobots(next); setSaveError(error ?? ''); return error; };
  /* Photos and scans take a while to process: read the garage as it is
   * now, so edits made meanwhile are kept, and skip a robot deleted
   * while they were processing. */
  const patchRobot = (id: string, fn: (r: GarageRobot) => GarageRobot): string | null => {
    const now = readStore<GarageRobot[]>(GARAGE_KEY, []);
    if (!now.some((r) => r.id === id)) return 'That robot was removed before the upload finished.';
    return saveRobots(now.map((r) => (r.id === id ? fn(r) : r))) ?? null;
  };

  const addRobot = (name: string, spec: Spec, source: VersionSource, why: string) => {
    const r: GarageRobot = {
      id: uid('robot'), name, createdAt: now(),
      versions: [{ id: uid('v'), label: 'Baseline', note: why, source, createdAt: now(), spec }],
    };
    persist([...robots, r]);
    setSelected(r.id);
    setAdding(false);
  };

  /* Adopt Omega1: the built-in twin is a fixed, estimated specimen;
   * the stored copy (fixed id 'omega1', so scans and links can find
   * it) is the one Abel improves. Seeded from the records only —
   * lib/omega1Garage.ts holds the seed and its provenance. Shown
   * only while no stored 'omega1' exists; adopting selects it. */
  /* Only an ACTIVE stored copy counts: an archived Omega1 stays in
   * Archived robots (restore it, or delete it forever to start fresh). */
  const storedOmega1 = activeRobots.find((r) => r.id === OMEGA1_ROBOT_ID) ?? null;
  const archivedOmega1 = archivedRobots.find((r) => r.id === OMEGA1_ROBOT_ID) ?? null;
  const freshOmega1 = (): GarageRobot => ({
    id: OMEGA1_ROBOT_ID, name: 'Omega1', createdAt: now(),
    versions: [{ id: uid('v'), label: 'Baseline', note: OMEGA1_SEED_NOTE, source: OMEGA1_SEED_SOURCE, createdAt: now(), spec: omega1SeedSpec() }],
  });
  /* Scan files live in IndexedDB under the robot id, so a fresh start
   * clears them too; failures here only leave an unused file behind. */
  const clearOmega1Scans = () => {
    void forgetRobotScans(OMEGA1_ROBOT_ID).catch(() => undefined);
  };
  const adoptOmega1 = () => {
    if (storedOmega1) { setSelected(OMEGA1_ROBOT_ID); setTwinOpen(false); setAdding(false); return; }
    if (archivedOmega1) {
      setLifecycleNotice('Your earlier Omega1 copy is in Archived robots. Restore it there, or tap Delete forever to start fresh from the records.');
      return;
    }
    const r = freshOmega1();
    persist([...robots, r]);
    setSelected(r.id);
    setAdding(false);
    setTwinOpen(false);
  };
  const openStoredOmega1 = () => { setSelected(OMEGA1_ROBOT_ID); setTwinOpen(false); setAdding(false); setTab('overview'); };

  /* #omega1 puts Omega1 in the Workshop (Wrench and the Forge link
   * here instead of generating Omega1 from scratch): landing here
   * adopts the stored copy from the records, or opens it if it is
   * already yours. The built-in specimen no longer opens — the
   * stored copy is the Omega1 you edit, scan and re-run. */
  useEffect(() => {
    const check = () => {
      /* A queued "open Omega1" from the sign-in gate or another
       * page (lib/sampleRobot.ts) counts the same as the hash. */
      if (window.location.hash !== '#omega1') {
        if (takeSampleOpenRequest()) adoptOmega1();
        return;
      }
      if (window.location.hash === '#omega1') adoptOmega1();
      /* Drop the hash once it has done its job, so deleting Omega1
       * later doesn't re-adopt it, and the next "Open Omega1 now"
       * click fires hashchange again. */
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    if (!ready) return;
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, storedOmega1, archivedOmega1]);

  /* The wiring map (spec.connections): adding or removing a row
   * saves a NEW version, like every other spec edit — the draft as
   * it stands, with the new list, under an 'edit' source. */
  const saveConnections = (next: SpecConnection[]) => {
    if (!robot || !draft) return;
    if (baseId !== latest?.id) { setSaveError('A newer version exists. Export your draft and load the latest saved version first.'); return; }
    const spec = { ...draft, connections: next };
    const v: RobotVersion = {
      id: uid('v'), label: `Version ${robot.versions.length + 1}`,
      note: 'Connections edited in the Wiring tab', source: 'edit', createdAt: now(), spec,
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, v] } : r)));
    setDraft(JSON.parse(JSON.stringify(spec)));
    setBaseId(v.id);
  };

  /* Improve-this-twin flow: a labelled scan slot lands on the robot
   * (the file already went to IndexedDB in the slot component); the
   * newest slot also mirrors into `scan`, the Overview viewer's
   * primary scan. Removing the mirrored slot falls back to the
   * newest remaining one. */
  const patchSlotScan = (id: string, kind: ScanKind, next: SlotScan | null): string | null =>
    patchRobot(id, (r) => {
      const scans = next
        ? [...(r.scans ?? []).filter((s) => s.kind !== kind), next]
        : (r.scans ?? []).filter((s) => s.kind !== kind);
      const out: GarageRobot = { ...r, scans };
      const mirror = scans[scans.length - 1];
      if (mirror) out.scan = { name: mirror.name, format: mirror.format, bytes: mirror.bytes, addedAt: mirror.addedAt };
      else delete out.scan;
      return out;
    });

  /* Step 3 of the flow: the tape-measure numbers, saved as ONE new
   * version badged Measured with today's date — never scattered
   * through the full Specs editor one field at a time. */
  const saveMeasured = (fields: { path: string; value: number }[]) => {
    if (!robot || !draft || fields.length === 0) return;
    if (baseId !== latest?.id) { setSaveError('A newer version exists. Export your draft and load the latest saved version first.'); return; }
    let spec = draft;
    for (const f of fields) spec = setPath(spec, f.path, f.value);
    const v: RobotVersion = {
      id: uid('v'), label: 'Measured',
      note: `Measured on the real robot by the owner — tape measure, calipers and scale (${now().slice(0, 10)}): ${fields.map((f) => f.path).join(', ')}`,
      source: 'edit', createdAt: now(), spec,
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, v] } : r)));
    setDraft(JSON.parse(JSON.stringify(spec)));
    setBaseId(v.id);
  };

  /* Scan → measured dimensions: the scan card measured the file's
   * bounding box (components/forge/scan.ts, axes as stored: x →
   * length, y → width, z → height); applying it saves a NEW version
   * whose note names the scan, the date and the unit rule that ran.
   * Source 'upload': the dimensions came out of an uploaded file. */
  const applyScanSize = (dims: { length_m: number; width_m: number; height_m: number }, scanName: string, unitNote: string) => {
    if (!robot || !draft) return;
    if (baseId !== latest?.id) { setSaveError('A newer version exists. Export your draft and load the latest saved version first.'); return; }
    const spec = { ...draft, length_m: dims.length_m, width_m: dims.width_m, height_m: dims.height_m };
    const v: RobotVersion = {
      id: uid('v'), label: `Version ${robot.versions.length + 1}`,
      note: `Dimensions measured from scan ${scanName} (${now().slice(0, 10)}) — bounding box of the scan file, axes as stored in the file (x → length, y → width, z → height)${unitNote ? `; ${unitNote}` : ''}. A scan gives size only — mass, motors and voltage do not come from it.`,
      source: 'upload', createdAt: now(), spec,
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, v] } : r)));
    setDraft(JSON.parse(JSON.stringify(spec)));
    setBaseId(v.id);
  };

  /* Forge Engine generation itself now lives in the chat's Create
   * panel (components/chat/ComposerCreate), which writes the same
   * PLANNED 'generated' first-version record this panel used to —
   * the Workshop keeps the rendering and the Modify flow below. */

  /* A modification never edits in place: it saves the modified spec
   * as a NEW version (planned flag kept) and reports the diff. The
   * engine returns null for anything outside its grammar. */
  const applyMod = (text: string): string | null => {
    if (!robot || !draft) return null;
    /* The engine's catalogue view includes the visitor's confirmed
     * web parts (lib/webParts) next to the built-in catalogue —
     * flagged WEB-SOURCED — UNVERIFIED, and the checks say so. */
    const catalogue = mergeCatalogue(
      catalogParts as unknown as CataloguePart[],
      readStore<WebPartRecord[]>(WEB_PARTS_KEY, []),
    ) as unknown as CataloguePart[];
    const mod = applyModification(draft, text, catalogue);
    if (!mod) return null;
    const rows = diffSpecs(draft, mod.spec).length;
    const v: RobotVersion = {
      id: uid('v'), label: `Forge mod ${robot.versions.length + 1}`,
      note: mod.summary, source: 'generated', createdAt: now(), spec: mod.spec, planned: true,
    };
    persist(robots.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, v] } : r)));
    setDraft(JSON.parse(JSON.stringify(mod.spec)));
    setBaseId(v.id);
    return `${mod.summary} Saved as a new version (${rows} spec field${rows === 1 ? '' : 's'} differ).`;
  };

  /* Forge Tests: generate (or regenerate) the acceptance-test plan
   * for the current draft and store it on the draft spec, following
   * the spec.forge pattern — it persists with the version the draft
   * is saved as, and re-running replaces the plan. */
  const generateTests = () => {
    if (!draft) return;
    setDraft({ ...draft, forgeTests: generateForgeTests(draft, new Date().toISOString()) });
  };

  /* Save a copy: the save-as-new half of the chat's save choice,
   * as a button — a separate entry carrying this robot's versions
   * and provenance, selected so the user sees it land. The
   * original is untouched. */
  const saveCopy = () => {
    if (!robot) return;
    const copy = copyAsNew(robot, uniqueCopyName(robot.name, robots), now(), uid('robot'));
    persist([copy, ...robots]);
    setSelected(copy.id);
  };

  const saveVersion = (source: VersionSource) => {
    if (!robot || !draft) return;
    const fresh = readStore<GarageRobot[]>(GARAGE_KEY, []);
    try { requireRobotVersion(fresh, robot.id, baseId); } catch(e) { setSaveError((e as Error).message); return; }
    const v: RobotVersion = {
      id: uid('v'), label: label.trim() || `Version ${robot.versions.length + 1}`,
      note: [note.trim(), ...draftNote].filter(Boolean).join(' · '), source, createdAt: now(), spec: draft,
      ...(plannedDraft ? { planned: true } : {}),
    };
    if (persist(fresh.map((r) => (r.id === robot.id ? { ...r, name: draft.name || r.name, versions: [...r.versions, v] } : r)))) return;
    setBaseId(v.id);
    setLabel('');
    setNote('');
    setDraftNote([]);
  };

  const togglePlanned = (versionId: string) => {
    if (!robot) return;
    persist(robots.map((r) => (r.id === robot.id
      ? { ...r, versions: r.versions.map((v) => (v.id === versionId ? { ...v, planned: !v.planned } : v)) }
      : r)));
  };

  /* Archive asks first and always commits against a fresh store read.
   * Switching robots disarms the pending action. */
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  useEffect(() => { setConfirmArchive(null); }, [robot?.id]);
  const archiveRobot = () => {
    if (!robot) return;
    if (confirmArchive !== robot.id) { setConfirmArchive(robot.id); return; }
    const result = archiveRobotInStore(
      () => readStore<GarageRobot[]>(GARAGE_KEY, []), saveRobots,
      robot.id, recordSnapshot(robot), now(),
    );
    if (!result.ok) { setSaveError(result.error); return; }
    const next = activeRecords(readStore<GarageRobot[]>(GARAGE_KEY, []));
    setConfirmArchive(null);
    setSelected(next[0]?.id ?? null);
    setLifecycleNotice(`Archived ${robot.name}. You can restore it below.`);
  };
  /* Delete forever: from the active "Your robots" list or from
   * Archived, and it asks first (the first click only arms the inline
   * confirmation). Deleting also drops the robot's cached editor
   * draft, so re-adding a robot with the same id starts clean. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const deleteForever = (archived: GarageRobot) => {
    if (confirmDelete !== archived.id) { setConfirmDelete(archived.id); return; }
    const result = deleteOwnedRobot(archived);
    setConfirmDelete(null);
    if (!result.ok) { setSaveError(result.error); return; }
    if (archived.id === selected) {
      const next = activeRecords(readStore<GarageRobot[]>(GARAGE_KEY, []));
      setSelected(next[0]?.id ?? null);
    }
    setLifecycleNotice(archived.id === OMEGA1_ROBOT_ID
      ? 'Deleted your Omega1 copy. Ask Wrench to make Omega1, or open this Workshop again, and a fresh copy is added from its records.'
      : `Deleted ${archived.name} for good.`);
  };
  /* Start Omega1 over: swap the stored copy for a fresh one seeded
   * from the records, dropping its versions, scans and photo spin. */
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { setConfirmReset(false); }, [robot?.id]);
  const resetOmega1 = () => {
    if (!robot || robot.id !== OMEGA1_ROBOT_ID) return;
    if (!confirmReset) { setConfirmReset(true); return; }
    const result = replaceRobotInStore(
      () => readStore<GarageRobot[]>(GARAGE_KEY, []), saveRobots,
      robot.id, recordSnapshot(robot), freshOmega1(),
    );
    setConfirmReset(false);
    if (!result.ok) { setSaveError(result.error); return; }
    /* Drop the old editor draft too: forget the loaded spec so the load
     * effect doesn't keep unsaved edits, and clear the cached draft so
     * they aren't restored against the new Baseline. */
    loadedSpec.current = null;
    writeStore(draftKey(OMEGA1_ROBOT_ID), null);
    clearOmega1Scans();
    setSelected(OMEGA1_ROBOT_ID);
    setTab('overview');
    setLifecycleNotice('Omega1 starts over: one Baseline version from its records. Nothing measured yet.');
  };
  const restoreRobot = (archived: GarageRobot) => {
    const result = restoreRobotInStore(
      () => readStore<GarageRobot[]>(GARAGE_KEY, []), saveRobots,
      archived.id, recordSnapshot(archived),
    );
    if (!result.ok) { setSaveError(result.error); return; }
    setSelected(archived.id);
    setAdding(false);
    setLifecycleNotice(`Restored ${archived.name}.`);
  };

  /* Removing a repo also asks twice; the robot and its versions stay.
   * ALL_REPOS stands for "Remove all". */
  const [confirmDetach, setConfirmDetach] = useState<string | null>(null);
  useEffect(() => { setConfirmDetach(null); }, [robot?.id]);
  const detach = (repoUrl: string) => {
    if (!robot) return;
    if (confirmDetach !== repoUrl) { setConfirmDetach(repoUrl); return; }
    persist(robots.map((r) => (r.id === robot.id ? (repoUrl === ALL_REPOS ? clearRepos(r) : detachRepo(r, repoUrl)) : r)));
    setConfirmDetach(null);
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
  useEffect(() => {
    if (!robot || !latest || !draft || draftOwner !== robot.id) return;
    const value: BrowserDraft | null = unsaved.length ? { baseline: latest.id, spec: draft, label, note, planned: plannedDraft } : null;
    setDraftError(writeStore(draftKey(robot.id), value) ?? '');
  }, [robot?.id, latest?.id, draftOwner, draft, label, note, plannedDraft, unsaved.length]);

  const roverDraft = useMemo(() => (draft && isRover(draft) ? checkRover(draft, rover).checks : null), [draft, rover]);
  /* Tools are equipment, not components — they live in the inventory's
   * Tools section and are never fitted to a robot. Sim-only parts CAN
   * be fitted (the fit is a simulation fit, and usePart says so). */
  const usableParts = inventory.filter((p) => !p.archivedAt && p.ownership !== 'wishlist' && p.status === 'confirmed' && p.quantity > 0 && partSection(p) === 'parts' && (!p.robot_id || p.robot_id === robot?.id) && partToChanges(p).length);
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

  /* ONE Workshop tab bar, rendered unconditionally at the top of the
   * Workshop in every state — it is the Workshop's menu, not a part of
   * any one robot's detail view. It controls whichever robot is in
   * front of the user:
   *  - Omega1 twin open: the bar drives Omega1's own panes (omegaTab)
   *    and never closes the twin or touches the stored robot; the
   *    Checks dot shows Omega1's own state (not gated), never a
   *    stored robot's verdict.
   *  - Stored robot selected: picking a tab returns to that pane of
   *    the robot (closing the twin / Add panel), as before.
   *  - Nothing selected and no twin: the bar is present but disabled —
   *    presence without fake function. */
  const wsVerdict = verdictOf(draftLines);
  const barTab = twinOpen ? omegaTab : tab;
  const barDisabled = !twinOpen && (adding || !(robot && draft));
  const goTab = (t: WorkTab) => {
    if (twinOpen) { setOmegaTab(t); return; }
    setTab(t); setTwinOpen(false); setAdding(false);
  };
  const tabBar = (
    <div className="ws-tabs" role="tablist" aria-label="Workshop">
      {WORK_TABS.map((t) => (
        <button key={t.id} type="button" role="tab" id={`ws-tab-${t.id}`} aria-selected={mainTab(barTab) === t.id} tabIndex={mainTab(barTab) === t.id ? 0 : -1} disabled={barDisabled} aria-disabled={barDisabled} onClick={() => goTab(t.id)} onKeyDown={(e) => {
          const index = WORK_TABS.findIndex((item) => item.id === t.id);
          const next = e.key === 'ArrowRight' ? (index + 1) % WORK_TABS.length : e.key === 'ArrowLeft' ? (index + WORK_TABS.length - 1) % WORK_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? WORK_TABS.length - 1 : -1;
          if (next < 0) return;
          e.preventDefault(); goTab(WORK_TABS[next].id);
          document.getElementById(`ws-tab-${WORK_TABS[next].id}`)?.focus();
        }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
          {t.label}
          {t.id === 'checks' && (twinOpen
            ? <span className="ws-dotbadge norun" aria-label="Omega1 is not gated" />
            : <span className={'ws-dotbadge ' + wsVerdict.cls} aria-label={wsVerdict.label} />)}
        </button>
      ))}
    </div>
  );

  /* Publish the live Workshop picture for Wrench: the chat reads this
   * snapshot when a question goes to the live model, so its answers are
   * about the robot on screen (see lib/workshopContext). Cleared on
   * unmount, so a stale robot never follows the user to another page. */
  useEffect(() => {
    if (twinOpen) {
      /* Omega1's snapshot comes from its own records only: the facts
       * list stands in for spec lines, the Checks pane lines for check
       * lines, and the verdict names its real state — not gated —
       * never a stored robot's verdict. */
      publishWorkshopContext({
        robotName: 'Omega1',
        versionLabel: TWIN_LABEL,
        tab: omegaTab,
        tabLabel: WORK_TABS.find((t) => t.id === mainTab(omegaTab))?.label ?? omegaTab,
        specLines: OMEGA1_FACTS.map((f) => `${f.label}: ${f.value}`),
        checksVerdict: 'Not gated',
        checkLines: OMEGA1_CHECK_LINES,
      });
    } else if (!adding && robot && draft) {
      const bi = base ? robot.versions.findIndex((v) => v.id === base.id) : -1;
      publishWorkshopContext({
        robotId: robot.id,
        robotName: draft.name || robot.name,
        versionLabel: base ? `v${bi + 1} — ${base.label}` : '',
        tab,
        tabLabel: WORK_TABS.find((t) => t.id === mainTab(tab))?.label ?? tab,
        specLines: summarizeSpec(draft),
        checksVerdict: wsVerdict.label,
        checkLines: draftLines,
        factLines: [
          ...(robot.scans ?? []).map((s) => `Scan on file · ${SCAN_SLOTS.find((k) => k.kind === s.kind)?.label ?? s.kind}: ${s.name}, added ${s.addedAt.slice(0, 10)}`),
          ...noteContextLines(notesFor(allNotes, robot.id)),
        ],
      });
    } else {
      publishWorkshopContext(null);
    }
    return () => publishWorkshopContext(null);
  }, [twinOpen, omegaTab, robot, draft, base, tab, adding, draftLines, wsVerdict.label, allNotes]);

  /* Wrench's one-tap Workshop actions (lib/workshopContext): open the
   * RealSense camera window for the robot on screen, or switch tabs. */
  useEffect(() => {
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<{ action: WorkshopAction; handled: boolean }>).detail;
      if (!detail || twinOpen || adding || !robot) return;
      detail.handled = true;
      if (detail.action.kind === 'realsense') { setTab('overview'); setRealsenseFor({ id: robot.id, name: robot.name }); }
      else setTab(detail.action.tab as WorkTab);
    };
    window.addEventListener(WORKSHOP_ACTION_EVENT, onAction);
    return () => window.removeEventListener(WORKSHOP_ACTION_EVENT, onAction);
  }, [twinOpen, adding, robot]);

  /* One-tap Fix from a grounded chat answer (lib/workshopContext):
   * the chat's "Fix this" button on a FAIL-grounded answer asks for
   * the Checks tab of the selected robot, where the "Fix with Muse
   * Spark" loop lives. Consumed on the event and once on mount, so a
   * request that landed just before Garage mounted is not lost. */
  useEffect(() => {
    const goChecks = () => {
      if (!consumeWorkshopFixRequest()) return;
      setTab('checks');
      setTwinOpen(false);
      setAdding(false);
    };
    goChecks();
    window.addEventListener(WORKSHOP_FIX_EVENT, goChecks);
    return () => window.removeEventListener(WORKSHOP_FIX_EVENT, goChecks);
  }, []);

  if (!ready) return <p className="muted">Loading your garage…</p>;

  return (
    <>
    {realsenseFor && (
      <ScanStudioModal
        robot={realsenseFor}
        onClose={() => setRealsenseFor(null)}
        onAttach={(meta) => {
          // Saved through the Workshop's own state so the Overview shows the scan at once.
          const next = attachRealsenseScan(readStore<GarageRobot[]>(GARAGE_KEY, []), realsenseFor.id, meta);
          if (!next) return `${realsenseFor.name} was archived or removed meanwhile.`;
          return saveRobots(next) ?? null;
        }}
      />
    )}
    <div className="garage">
      <aside className="garage-list" aria-label="Your robots">
        <h2>Your robots</h2>
        {activeRobots.length === 0 && <p className="faint g-small">No active robots yet.</p>}
        <ul hidden={!activeRobots.length}>
          {activeRobots.map((r) => (
            <li key={r.id}>
              <button type="button" className="g-robot" aria-current={r.id === selected && !twinOpen ? 'true' : undefined} onClick={() => { setSelected(r.id); setAdding(false); setTwinOpen(false); }}>
                <RobotAvatar names={[r.name, String(r.versions[0]?.spec?.name ?? '')]} size={36} />
                <span className="g-robot-text"><strong>{r.name}</strong>
                {robotRepos(r).length > 0 && <span className="fbadge live">{robotRepos(r).length > 1 ? `${robotRepos(r).length} repos` : 'From repo'}</span>}
                <span className="faint">{r.versions.length} version{r.versions.length === 1 ? '' : 's'}{r.versions[r.versions.length - 1]?.planned ? ' · planned' : ''}</span></span>
              </button>
              {r.repoImport && (
                <span className="g-robot-links faint">
                  <a href={r.repoImport.provenance.repoUrl} target="_blank" rel="noreferrer">{r.repoImport.provenance.owner}/{r.repoImport.provenance.repo}</a>
                  {robotRepos(r).length > 1 && ` +${robotRepos(r).length - 1} more`}
                  {' · '}
                  <Link href={`/import/?robot=${r.id}`}>import details</Link>
                </span>
              )}
              {confirmDelete === r.id ? (
                <span className="g-remove-confirm" role="alert">
                  Delete {r.name} and its {r.versions.length} version{r.versions.length === 1 ? '' : 's'} for good? This can&apos;t be undone. If you saved it to your account, press Save afterwards to remove it there too.{' '}
                  <button type="button" className="btn btn-sm" onClick={() => deleteForever(r)}>Yes, delete</button>{' '}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => deleteForever(r)}>Delete</button>
              )}
            </li>
          ))}
        </ul>
        {/* The built-in Omega1 specimen is hidden (Abel, 2026-11-03):
         * it shadowed the owner's own Omega1 in this list and split
         * Wrench's answers between the twin and the stored copy. The
         * stored copy is the only Omega1 here now; #omega1 adopts or
         * opens it (see the hash effect below). */}
        {/* The Omega1 sample stays one click away after the first
         * robot too (Abel, 2026-11-05): judges and testers who
         * brought their own robot can still try the sample. Hidden
         * once a copy exists, archived ones included. */}
        {activeRobots.length > 0 && !storedOmega1 && !archivedOmega1 && (
          <button type="button" className="btn btn-sm g-sample-add" onClick={adoptOmega1} title="Add the Omega1 sample robot from its records">+ Try the Omega1 sample</button>
        )}
        {activeRobots.length > 0 && <button type="button" className="btn btn-sm" onClick={() => { setAdding(true); setTwinOpen(false); }}>+ Add a robot</button>}
        <Link className="btn btn-sm" href="/import/">Import a repo</Link>
        <p className="faint g-small" style={{ marginTop: 14 }}>Tip: press <strong>Create</strong> in the chat to generate a robot, tests, or a modification.</p>
        {archivedRobots.length > 0 && (
          <details className="g-archived">
            <summary>Archived robots ({archivedRobots.length})</summary>
            <ul>
              {archivedRobots.map((archived) => (
                <li key={archived.id}>
                  <span className="g-robot-text">
                    <strong>{archived.name}</strong>
                    <span className="faint">{archived.versions.length} version{archived.versions.length === 1 ? '' : 's'} · archived {new Date(archived.archivedAt!).toLocaleDateString()}</span>
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => restoreRobot(archived)}>Restore</button>
                  {confirmDelete === archived.id ? (
                    <span className="g-remove-confirm" role="alert">
                      Delete {archived.name} and its {archived.versions.length} version{archived.versions.length === 1 ? '' : 's'} for good? This can&apos;t be undone.{' '}
                      <button type="button" className="btn btn-sm" onClick={() => deleteForever(archived)}>Yes, delete</button>{' '}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => deleteForever(archived)}>Delete forever</button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>

      <div className="garage-main">
        {saveError && <p className="g-error" role="alert">{saveError}</p>}
        {lifecycleNotice && <p className="g-notice" role="status">{lifecycleNotice}</p>}
        {(mainTab(barTab) === 'overview' || barDisabled) && <WrenchStart expanded={barDisabled} />}
        {tabBar}
        {!barDisabled && <div className="ws-taskbar">
          {mainTab(barTab) === 'bom' && <div className="ws-sections" role="group" aria-label="BOM sections">
            {BOM_SECTIONS.map((section) => <button type="button" className="btn btn-sm" key={section.id} aria-pressed={barTab === section.id} onClick={() => goTab(section.id)}>{section.label}</button>)}
          </div>}
          <button type="button" className="btn btn-sm ws-edit-specs" onClick={() => goTab('specs')}>{twinOpen ? 'View specs' : 'Specs'}</button>
          {!twinOpen && isOmegaRobot && <button type="button" className="btn btn-sm" onClick={() => { setOmegaTab('overview'); setTwinOpen(true); }}>View ProjectSim twin</button>}
        </div>}
        {!twinOpen && !adding && robot && draft && (() => {
          const focus = tabFocus(tab, {
            name: robot.name,
            hasRealsense: Boolean(robot.scans?.some((s) => s.kind === 'realsense')),
            hasScan: Boolean(robot.scan),
            versions: robot.versions.length,
            verdictLabel: wsVerdict.label,
            verdictCls: wsVerdict.cls,
          });
          const act = () => {
            const a = focus.action;
            if (a.kind === 'realsense') setRealsenseFor({ id: robot.id, name: robot.name });
            else if (a.kind === 'simRun') window.dispatchEvent(new CustomEvent(SIM_COMMAND_EVENT, { detail: { command: { action: 'run' }, handled: false, message: '' } }));
            else promptWrench({ mode: 'chat', text: a.text, send: true });
          };
          return (
            <div className="ws-focus" role="region" aria-label="What this tab is for">
              <p className="ws-focus-job">{focus.job}</p>
              <span className={'ws-focus-status ' + focus.tone}>{focus.status}</span>
              <button type="button" className="btn btn-primary btn-sm ws-focus-go" onClick={act}>{focus.action.label}</button>
            </div>
          );
        })()}
        {draftError && <p className="g-error" role="alert">Draft not saved: {draftError}</p>}
        {twinOpen && (omegaTab === 'specs'
          ? <SpecsDialog readOnly onClose={() => setOmegaTab(specsReturn.current.twin)}><Omega1Twin tab="specs" /></SpecsDialog>
          : <Omega1Twin tab={omegaTab} garageScans={storedOmega1 ? (storedOmega1.scans?.length ?? (storedOmega1.scan ? 1 : 0)) : null} onOpenGarage={openStoredOmega1} onAdopt={adoptOmega1} />)}
        {!twinOpen && (adding || activeRobots.length === 0) && <AddRobot onAdd={addRobot} firstRobot={activeRobots.length === 0} onOpenRobot={(id) => { setSelected(id); setTwinOpen(false); setAdding(false); }} />}

        {!twinOpen && !adding && robot && draft && (() => {
          const verdict = verdictOf(draftLines);
          /* A number still equal to what the photo draft guessed is ESTIMATED:
           * it gets an amber dot until the owner types a measured value. */
          const photoV = [...robot.versions].reverse().find((v) => v.source === 'photo')
            /* An imported or re-imported photo draft keeps its provenance only in the description. */
            ?? robot.versions.find((v) => String(v.spec?.description || '').startsWith('Photo draft'));
          const estimated = new Set<string>(photoV ? FIELD_GROUPS.flatMap((g) => g.fields)
            .filter((f) => f.kind === 'number' || f.kind === 'integer')
            .map((f) => f.path)
            .filter((path) => latest?.estimatedPaths ? latest.estimatedPaths.includes(path) : !photoV.estimatedPaths || photoV.estimatedPaths.includes(path))
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
                {latest?.planned && <span className="fbadge planned" title="The current version is a plan — not built yet, and its parts may not be owned.">Planned</span>}
                <span className="faint g-small">{unsaved.length ? (draftError ? 'Draft not saved' : 'Draft kept in this browser') : 'Saved'}</span>

              </div>
              <details className="ws-more-actions">
                <summary>Robot actions</summary>
                <div className="g-head-actions">
                <button type="button" className="btn btn-sm" onClick={saveCopy} title="Save a separate copy of this robot in your Garage — versions and provenance carried over; the original is unchanged">Save a copy</button>
                <button type="button" className="btn btn-sm" onClick={() => downloadJSON(`${(draft.name || 'robot').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, draft)}>Export</button>
                {robot.id === OMEGA1_ROBOT_ID && (confirmReset ? (
                  <span className="g-remove-confirm" role="alert">
                    Start Omega1 over? Its {robot.versions.length} version{robot.versions.length === 1 ? '' : 's'}, scans and photos are replaced by one fresh Baseline from its records. This can&apos;t be undone.{' '}
                    <button type="button" className="btn btn-sm" onClick={resetOmega1}>Yes, start over</button>{' '}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={resetOmega1} title="Replace this copy with a fresh one from Omega1's records">Start over from the records</button>
                ))}
                {confirmArchive === robot.id ? (
                  <span className="g-remove-confirm" role="alert">
                    Archive {draft.name || robot.name} and its {robot.versions.length} version{robot.versions.length === 1 ? '' : 's'}? You can restore it later.{' '}
                    <button type="button" className="btn btn-sm" onClick={archiveRobot}>Yes, archive</button>{' '}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmArchive(null)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={archiveRobot}>Archive</button>
                )}
              </div>
              </details>
            </div>



            {unsaved.length > 0 && (
              <div className="ws-savebar" role="region" aria-label="Unsaved changes">
                <span><strong>{unsaved.length} unsaved change{unsaved.length === 1 ? '' : 's'}</strong></span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => saveVersion(draftNote.some((n) => n.startsWith('Muse')) ? 'muse-fix' : draftNote.some((n) => n.startsWith('Fitted')) ? 'inventory' : 'edit')}>Save version</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(JSON.parse(JSON.stringify(latest!.spec))); setDraftNote([]); }}>Discard</button>
              </div>
            )}

            {tab === 'overview' && (
              <section className="ws-pane" aria-label="Overview">
                {(() => {
                  const missing = ['mass_kg', 'length_m', 'width_m', 'height_m'].filter((path) => !(Number(getPath(draft, path)) > 0)).length;
                  const connections = Array.isArray(draft.connections) && draft.connections.length > 0;
                  const next = latest?.planned ? { title: 'Refine your concept', text: 'Tell Wrench what to add, remove or change. Each revision stays in History.', action: 'Describe a change', tab: 'overview' as WorkTab, prompt: 'Make it wider' } : missing || estimated.size
                    ? { title: 'Add your measurements', text: 'Measured dimensions make the model and tests more useful.', action: 'Add measurements', tab: 'specs' as WorkTab, prompt: 'My robot weighs ' }
                    : !isWiring(draft.wiring) && !connections
                    ? { title: 'Map your connections', text: 'Record how power and signals reach each part.', action: 'Open wiring', tab: 'wiring' as WorkTab }
                    : { title: counts(draftLines).errors ? 'Review the issues' : 'Check your robot', text: 'Review engineering checks and explore a simulation.', action: 'Open Test', tab: 'checks' as WorkTab };
                  return <div className="ws-next"><div><span className="eyebrow">Next step</span><h3>{next.title}</h3><p>{next.text}</p></div><button type="button" className="btn btn-primary" onClick={() => { if ('prompt' in next) promptWrench({mode:'chat',text:next.prompt}); else setTab(next.tab); }}>{next.action}</button></div>;
                })()}
                {(() => {
                  const art = drawingFor(draft?.name, robot.name, robot.id);
                  const drawing = art ? (
                    <figure className="ws-drawing">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={art} alt={`Drawing of a ${draft?.name || robot.name}`} />
                      <figcaption className="faint g-small">RobotForge illustration of this model, not a photo of your build.</figcaption>
                    </figure>
                  ) : null;
                  return (
                    <OverviewMedia
                      key={`${robot.id}:${robot.scan?.addedAt ?? ''}:${robot.photoAddedAt ?? ''}:${robot.spin?.addedAt ?? ''}`}
                      robotId={robot.id}
                      spin={robot.spin}
                      concept={!!latest?.planned}
                      photo={robot.photo}
                      photoSet={robot.photoSet}
                      photoAddedAt={robot.photoAddedAt}
                      referencePhoto={(() => {
                        if (isOmegaRobot) return { ...OMEGA1_PHOTO, url: assetPath(OMEGA1_PHOTO.url) };
                        const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/demo$/, '');
                        const names = [robot.name, draft.name, robot.versions[0]?.spec?.name].map(normalize);
                        const match = dexRobots.find((r) => names.includes(normalize(r.name)) || names.includes(normalize(r.slug)));
                        if (match?.image_url) return { url: match.image_url.startsWith('assets/') ? assetPath(match.image_url) : match.image_url, caption: `${match.image_credit || 'Catalogue reference image'} · reference robot, not your build.` };
                        const repo = robotRepos(robot).find((r) => cardImagesOf(r).length);
                        const image = repo && cardImagesOf(repo)[0];
                        return image ? { url: image.url, caption: 'Repository reference image · appearance has not been verified against your build.', source: repo.provenance.repoUrl } : undefined;
                      })()}
                      onPhotoSave={(photo) => patchRobot(robot.id, (r) => { if (photo) return { ...r, photo }; const { photo: _removed, ...rest } = r; return rest; })}
                      onPhotosSave={(next) => patchRobot(robot.id, (r) => { if (next) return { ...r, photo: next.photo, photoSet: next.photoSet, photoAddedAt: next.photoAddedAt }; const { photo: _p, photoSet: _s, photoAddedAt: _a, ...rest } = r; return rest; })}
                      scan={robot.scan}
                      name={robot.name}
                      modelReady={isOmegaRobot || hasBody(draft)}
                      modelNote={isOmegaRobot
                        ? 'Omega1 digital twin · generated from a photo of the real rover, so its shape and size are estimates, not measurements. Drag to look around it, or use its Turn control for the full 360.'
                        : latest?.planned ? undefined
                        : 'Model built from this robot\u2019s recorded spec · approximate geometry, not a measured twin. Drag to look around it.'}
                      model={isOmegaRobot ? <TwinView subject={omega1Rover} explode /> : <OverviewTurntable key={robot.id} spec={draft as RobotSpec} name={robot.name} fallback={drawing} onNeedSpecs={() => setTab('specs')} />}
                      onSave={(next) => patchRobot(robot.id, (r) => {
                        if (next) return { ...r, spin: next };
                        const { spin: _gone, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
                        return rest;
                      })}
                      onScanSave={(next) => patchRobot(robot.id, (r) => {
                        if (next) return { ...r, scan: next };
                        const { scan: _gone, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
                        return rest;
                      })}
                      onApplyScanSize={applyScanSize}
                      onRealsenseScan={() => setRealsenseFor({ id: robot.id, name: robot.name })}
                    />
                  );
                })()}
                <div className="ws-tiles">
                  {tiles.map((t) => (
                    <div className="ws-tile" key={t.label}>
                      <span className="ws-tile-icon"><Icon d={t.icon} size={18} /></span>
                      <span className="ws-tile-label">{t.label}{t.paths.some((p) => estimated.has(p)) && <i className="est-dot" title={ESTIMATED_TIP} aria-label="estimated" />}</span>
                      <strong>{t.value}</strong>{t.unit && <span className="ws-tile-unit">{t.unit}</span>}
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode: 'chat', text: 'I want to modify this robot: '})}>Describe a change to Wrench</button>
                <WorkshopExplainer key={robot.id} robotId={robot.id} name={robot.name} spec={draft} estimatedPaths={latest?.estimatedPaths} />
                {(() => {
                  const notes = notesFor(allNotes, robot.id);
                  return (
                    <section className="ws-notes" aria-label={`What Wrench knows about ${robot.name}`}>
                      <h3>What Wrench knows about {robot.name}</h3>
                      {notes.length ? (
                        <ul>
                          {notes.map((n) => (
                            <li key={n.id}>
                              <span>{n.text}</span>
                              <span className="faint g-small"> · {n.source === 'you' ? 'you told Wrench' : n.source} · {n.addedAt.slice(0, 10)}</span>
                              <button type="button" className="btn btn-sm ws-note-del" onClick={() => removeRobotNote(n.id)} aria-label={`Delete the note: ${n.text}`}>Delete</button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="faint g-small">Nothing yet. Tell Wrench &ldquo;remember that &hellip;&rdquo;, or save a web-sourced answer to these notes. Wrench uses them, along with the spec and scans, whenever you ask about {robot.name}.</p>
                      )}
                    </section>
                  );
                })()}
                <details className="g-repos ws-disclosure"><summary>Source repositories ({robotRepos(robot).length})</summary>
                  <h3>Code repos{robotRepos(robot).length > 0 && <span className="faint"> · {robotRepos(robot).length}</span>}</h3>
                  {robotRepos(robot).length === 0 ? (
                    <p className="faint g-small">No repos yet. Add the robot&apos;s firmware, ROS packages or CAD repo and RobotForge reads its parts and model files.</p>
                  ) : (
                    <ul>
                      {robotRepos(robot).map((x) => {
                        const slug = `${x.provenance.owner}/${x.provenance.repo}`;
                        return (
                          <li key={x.provenance.repoUrl} className="g-repo-card">
                            {(() => {
                              const pics = cardImagesOf(x);
                              const hasImages = (x.images?.length ?? 0) > 0;
                              return (
                                <div className="g-repo-pics">
                                  {pics.length ? (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img className="g-repo-cover" src={pics[0].url} alt={pics[0].alt || `Image from ${slug}`} loading="lazy" referrerPolicy="no-referrer" />
                                      {pics.length > 1 && (
                                        <span className="g-repo-strip">
                                          {pics.slice(1, 4).map((p) => (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img key={p.url} src={p.url} alt={p.alt || ''} loading="lazy" referrerPolicy="no-referrer" />
                                          ))}
                                          {pics.length > 4 && <span className="faint">+{pics.length - 4}</span>}
                                        </span>
                                      )}
                                      <span className="g-repo-credit faint">Image via {slug} · {x.provenance.license.label}, not your build</span>
                                    </>
                                  ) : (
                                    <Link className="g-repo-nopic faint g-small" href={`/import/?robot=${encodeURIComponent(robot.id)}&src=${slug}#repo-images`}>
                                      {hasImages ? `Choose card pictures (${x.images.length} in the repo)` : 'No pictures in this repo'}
                                    </Link>
                                  )}
                                </div>
                              );
                            })()}
                            <a href={x.provenance.repoUrl} target="_blank" rel="noreferrer"><strong>{slug}</strong></a>
                            <span className="faint g-small"> @ {x.provenance.commitSha.slice(0, 7)} · {x.parts.length} part{x.parts.length === 1 ? '' : 's'}{x.model ? ` · ${x.model.format} model` : ''}</span>
                            <span className="g-repo-actions">
                              <Link className="btn btn-sm" href={`/import/?robot=${encodeURIComponent(robot.id)}&src=${slug}`}>Details</Link>
                              {cardImagesOf(x).length > 0 && <Link className="btn btn-sm" href={`/import/?robot=${encodeURIComponent(robot.id)}&src=${slug}#repo-images`}>Pictures</Link>}
                              {confirmDetach === x.provenance.repoUrl ? (
                                <span className="g-remove-confirm" role="alert">
                                  Remove {slug} from {robot.name}? <button type="button" className="btn btn-sm g-remove-yes" onClick={() => detach(x.provenance.repoUrl)}>Yes, remove</button>
                                  <button type="button" className="btn btn-sm" onClick={() => setConfirmDetach(null)}>Cancel</button>
                                </span>
                              ) : (
                                <button type="button" className="btn btn-sm" onClick={() => detach(x.provenance.repoUrl)} aria-label={`Remove ${slug}`}>Remove</button>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="g-repo-foot">
                    <Link className="btn btn-sm" href={`/import/?attach=${encodeURIComponent(robot.id)}`}>+ Add {robotRepos(robot).length ? 'more repos' : 'repos'}</Link>
                    {robotRepos(robot).length > 1 && (confirmDetach === ALL_REPOS ? (
                      <span className="g-remove-confirm" role="alert">
                        Remove all {robotRepos(robot).length} repos from {robot.name}? <button type="button" className="btn btn-sm g-remove-yes" onClick={() => detach(ALL_REPOS)}>Yes, remove all</button>
                        <button type="button" className="btn btn-sm" onClick={() => setConfirmDetach(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => detach(ALL_REPOS)}>Remove all</button>
                    ))}
                    <span className="faint g-small">Removing a repo keeps the robot, its specs and its versions.</span>
                  </p>
                </details>
                <p><Link className="btn btn-sm" href={'/inventory/?robot=' + encodeURIComponent(robot.id)}>Photos & parts for {robot.name}</Link> </p>
              </section>
            )}

            {draft && baseId && latest && baseId !== latest.id && <div className="card" role="alert">
              <strong>A newer saved robot version exists.</strong>
              <p>Your unsaved draft was preserved. It cannot overwrite the newer assembly or wiring. Export it before replacing it with the latest saved version.</p>
              <button type="button" className="btn btn-sm" onClick={() => downloadJSON('unsaved-robot-draft.json',draft)}>Export unsaved draft</button>{' '}
              <button type="button" className="btn btn-sm" onClick={() => {setDraft(JSON.parse(JSON.stringify(latest.spec)));setBaseId(latest.id);setLabel('');setNote('');setDraftNote([]);setSaveError('');}}>Replace draft with latest saved version</button>
            </div>}

            {tab === 'wiring' && (
              <section className="ws-pane" aria-label="Wiring">
                <div className="ws-sections" role="group" aria-label="Wiring workspace">
                  <button type="button" className="btn btn-sm" aria-pressed={!benchWires} onClick={() => setBenchWires(false)}>Connections</button>
                  <button type="button" className="btn btn-sm" aria-pressed={benchWires} onClick={() => setBenchWires(true)}>Plan in 3D</button>
                </div>
                {!benchWires && <>
                  <PlannedUpgrades spec={draft} />
                  {!isWiring(draft.wiring) && <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:`Connect "battery" to "controller" on "${robot.name}"`})}>Describe a connection to Wrench</button>}
                  {isWiring(draft.wiring) && <details className="ws-disclosure"><summary>Connection notes</summary><button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:`Connect "battery" to "controller" on "${robot.name}"`})}>Describe a connection to Wrench</button></details>}
                  {isWiring(draft.wiring) ? <WiringView compact wiring={draft.wiring} spec={draft as unknown as RobotSpec} onWiringChange={(wiring) => {
                    const fresh = readStore<GarageRobot[]>(GARAGE_KEY, []);
                    requireRobotVersion(fresh, robot.id, baseId);
                    const current = fresh.find(r => r.id === robot.id);
                    if (!current || current.versions.at(-1)?.id !== latest?.id) throw new Error('Robot changed in another view. Reload before saving wiring facts.');
                    const nextSpec = { ...draft, wiring };
                    const version: RobotVersion = { id: uid('v'), label: `Version ${current.versions.length + 1}`, note: 'Electrical facts entered in Wiring; values remain user-entered and unverified.', source: 'edit', createdAt: now(), spec: nextSpec };
                    const error = persist(fresh.map(r => r.id === robot.id ? { ...r, versions: [...r.versions, version] } : r));
                    if (error) throw new Error(error);
                    setDraft(JSON.parse(JSON.stringify(nextSpec)));
                    setBaseId(version.id);
                  }} /> : <p className="ws-empty">No wiring diagram yet. Record your connections above or plan them in 3D.</p>}
                  <details className="ws-disclosure"><summary>Photos and connection views</summary><WiringViews robot={robot} spec={draft} onNeedSpecs={() => setTab('specs')} /></details>
                  <details className="ws-disclosure"><summary>Generated wiring notes</summary><ForgeWiring spec={draft} /></details>
                </>}
              </section>
            )}

            {/* One bench instance for Build and the Wiring planner, so picking a
                planned cable in Build keeps its selection when it opens Wiring. */}
            {(tab === 'build' || (tab === 'wiring' && benchWires)) && (
              <AssemblyWorkspace key={robot.id} robotId={robot.id} view={tab === 'build' ? 'components' : 'wiring'}
                onView={(v) => { if (v === 'wiring') setBenchWires(true); setTab(v === 'components' ? 'build' : 'wiring'); }} />
            )}

            {tab === 'build' && <details className="ws-disclosure"><summary>Build instructions and placement</summary><ForgeBuild spec={draft} /><ForgePlacement spec={draft} /></details>}

            {tab === 'build' && (
              <details className="ws-disclosure"><summary>Take apart and assemble</summary><TakeApartPanel key={robot.id} robot={robot} spec={draft} onNeedSpecs={() => setTab('specs')} /></details>
            )}

            {tab === 'specs' && (
            <SpecsDialog onClose={() => setTab(specsReturn.current.stored)}>
            <section className="g-editor ws-pane" aria-label="Specs">
              <p>Tell Wrench what you measured or what you want to change. For example: “My robot weighs 2 kg” or “Make the wheels 100 mm”.</p>
              <button type="button" className="btn btn-primary" onClick={() => { setTab(specsReturn.current.stored); promptWrench({mode:'chat',text:'My robot weighs '}); }}>Update specs in Wrench</button>
              <div className="g-groups">{FIELD_GROUPS.map((g) => <details key={g.title} className="ws-disclosure" open={g === FIELD_GROUPS[0]}><summary>{g.title}</summary><dl>{g.fields.map((f) => { const value = getPath(draft,f.path); return <div className="ws-spec-row" key={f.path}><dt>{f.label}</dt><dd>{value == null ? 'Not recorded' : typeof value === 'number' ? num(value,f.scale ?? 1,3) : String(value)} {f.unit}</dd></div>; })}</dl></details>)}</div>

            </section>
            </SpecsDialog>
            )}

            {tab === 'simulate' && (
              <><SimulationWorkspace spec={draft} robot={robot} robotId={robot.id} versionId={(unsaved.length?'draft:':'')+(latest?.id||'new')} /><details className="ws-disclosure"><summary>Estimates and advanced simulation options</summary><SimulateTab spec={draft} checks={roverDraft} opts={rover} setOpts={setRover} /></details></>
            )}

            {tab === 'bom' && (
              <BomTab spec={draft} robotId={robot.id} robotName={draft.name || robot.name} inventory={inventory} />
            )}

            {tab === 'tools' && (
              <ToolsMaterialsTab spec={draft} robotName={draft.name || robot.name} />
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
              <SavedSimulationRuns robotId={robot.id} /><h3>Engineering checks</h3>
              <p className="g-small faint">Calculated from your specs; these are not physical test results.</p>
              <Findings lines={draftLines} />
              <details className="ws-disclosure"><summary>Compare with a saved version</summary>
            <ol className="ws-timeline" aria-label="Versions (pick one to compare with the draft)">
              {robot.versions.map((v, i) => (
                <li key={v.id}>
                  <button type="button" aria-pressed={v.id === base?.id} onClick={() => setBaseId(v.id)} title={`${v.label} · ${SOURCE_LABEL[v.source]} · ${new Date(v.createdAt).toLocaleDateString()}${v.note ? ' · ' + v.note : ''}`}>
                    <span className="ws-dot" aria-hidden="true" />v{i + 1} <span className="ws-vlabel">{v.label}</span>{v.planned && <span className="fbadge planned">PLANNED</span>}
                  </button>
                </li>
              ))}
            </ol>
                <h4>{base?.label}</h4><Findings lines={baseLines} />
                {diff.length === 0 ? <p className="faint">No spec changes.</p> : <div className="g-tablewrap"><table className="g-table"><thead><tr><th>Spec</th><th>Saved</th><th>Draft</th></tr></thead><tbody>{diff.map((d) => { const c = changeText(d.path, d.before, d.after); return <tr key={d.path}><td>{c.label}</td><td>{c.before} {c.unit}</td><td>{c.after} {c.unit}</td></tr>; })}</tbody></table></div>}
              </details>
              <details className="ws-disclosure"><summary>Design checks</summary><ForgeChecks spec={draft} /></details>
              <details className="ws-disclosure"><summary>Acceptance tests</summary><ForgeTestsSection spec={draft} onGenerate={generateTests} onModify={applyMod} /></details>

              {(fixable || looping || loop) && <div className="g-fix">
                <div className="g-fix-head">
                  <h4>Fix issues</h4>
                  <label className="g-check"><input type="checkbox" id="garage-warnings" checked={withWarnings} onChange={(e) => setWithWarnings(e.target.checked)} /> include warnings</label>
                </div>
                <p className="g-small muted" title="Muse Spark proposes field changes for the findings, the checks re-run, up to three rounds. The validator decides, and you decide whether to keep it.">Proposes fixes. The checks decide, then you do.</p>
                <button type="button" className="btn btn-primary" disabled={!fixable || looping} onClick={runLoop}>{fixable ? 'Suggest fixes' : 'Nothing to fix'}</button>
                {health !== undefined && !routeOn(health ?? null, 'fix') && fixable && (
                  <p className="faint g-small">Offline: uses textbook rules (<LiveOffReason h={health ?? null} route="fix" />).</p>
                )}
                {(looping || loop) && <LoopView res={loop} rounds={loopRounds} running={looping} live={lm.mode === 'live'} />}
                {loop && loop.rounds.length > 0 && !looping && (
                  <button type="button" className="btn" onClick={acceptLoop}>Use these changes in the draft</button>
                )}
              </div>}


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
