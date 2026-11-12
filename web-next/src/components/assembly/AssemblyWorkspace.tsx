"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { promptWrench } from '@/lib/wrenchPrompt';
import { assetPath } from '@/components/home/asset';
import {
  overlapPairs,
  recommendSmartPlacement,
  evaluatePlacementIntelligence,
  mountedCenterZ,
  normalizeYawDeg,
} from '@/lib/spatial';
import { COMPONENTS, componentById, type ComponentDefinition } from '@/lib/components';
import { PART_GROUPS, partGroup } from '@/lib/partTaxonomy';
import {
  ASSEMBLY_KEY,
  commitAssemblyVersion,
  effectiveAssemblies,
  currentAssembly,
  operationFor,
  previewAssembly,
  undoVersionedAssembly,
  type Assemblies,
  type AssemblyOperation,
  type ComponentInstance,
  type Pose,
} from '@/lib/assembly';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { activeRecords } from '@/lib/lifecycle';
import { downloadJSON, readStore, uid, useStore, writeStore } from '@/lib/store';
import type { RobotSpec } from '@/components/forge/model';
import { taBuildParts } from '@/components/kit/takeapart';
import { BENCH_EVENT, BENCH_PROGRESS_KEY, benchTransition, restoreBench, type BenchCommand, type BenchResult, type BenchState } from '@/lib/workshopBench';
import { WORKSHOP_REASSEMBLE_EVENT, type ReassembleResult } from '@/lib/workshopContext';
import { teardownSteps } from '@/lib/teardown';
import UnitySceneChoice from '@/components/unity/UnitySceneChoice';
import BenchLearning from './BenchLearning';
import BuildArtifacts from './BuildArtifacts';
import SavedUpgrade from './SavedUpgrade';

const Robot3D = dynamic(() => import('@/components/kit/Robot3D'), {
  ssr: false,
  loading: () => <p>Loading 3D assembly…</p>,
});

/* Isometric + top-down mounting/orientation blueprint SVG for any component */
function PartBlueprintSVG({ part, yawDeg = 0 }: { part: ComponentDefinition; yawDeg?: number }) {
  const [lMm, wMm, hMm] = part.sizeM.map((v) => Math.round(v * 1000));
  const maxSpan = Math.max(lMm, wMm, 40);
  const scale = 58 / maxSpan;
  const bw = Math.max(24, lMm * scale);
  const bh = Math.max(18, wMm * scale);
  const depth = Math.max(6, Math.min(20, hMm * scale * 0.45));
  const cx = 68;
  const cy = 50;
  const holes = part.mounting.holePatternMm;

  return (
    <svg
      viewBox="0 0 140 96"
      width="140"
      height="96"
      role="img"
      aria-label={`3D envelope, mounting hole pattern and +X orientation blueprint for ${part.name}`}
      style={{
        background: 'rgba(8, 19, 33, 0.85)',
        borderRadius: 8,
        border: '1px solid rgba(94, 234, 212, 0.22)',
        flexShrink: 0,
      }}
    >
      <g transform={`translate(${cx}, ${cy}) rotate(${-yawDeg})`}>
        {/* 3D extruded side/bottom shadow faces */}
        <polygon
          points={`${-bw / 2},${bh / 2} ${bw / 2},${bh / 2} ${bw / 2 + depth * 0.45},${bh / 2 + depth * 0.55} ${-bw / 2 + depth * 0.45},${bh / 2 + depth * 0.55}`}
          fill="#0f2942"
          stroke="#38bdf8"
          strokeWidth="0.8"
          opacity="0.85"
        />
        <polygon
          points={`${bw / 2},${-bh / 2} ${bw / 2},${bh / 2} ${bw / 2 + depth * 0.45},${bh / 2 + depth * 0.55} ${bw / 2 + depth * 0.45},${-bh / 2 + depth * 0.55}`}
          fill="#163a59"
          stroke="#38bdf8"
          strokeWidth="0.8"
          opacity="0.85"
        />
        {/* Top PCB / body face */}
        <rect
          x={-bw / 2}
          y={-bh / 2}
          width={bw}
          height={bh}
          rx={4}
          fill={
            part.category === 'power'
              ? '#1e293b'
              : part.category === 'sensor'
                ? '#0f172a'
                : part.category === 'safety'
                  ? '#451a03'
                  : '#0b3b2e'
          }
          stroke="#5eead4"
          strokeWidth="1.4"
        />
        {/* Mounting holes or straps */}
        {holes.length > 0 ? (
          holes.map(([hxMm, hyMm], i) => (
            <circle
              key={i}
              cx={hxMm * scale}
              cy={-hyMm * scale}
              r={2.3}
              fill="#081321"
              stroke="#fbbf24"
              strokeWidth="1.2"
            />
          ))
        ) : part.mounting.kind === 'velcro-strap' ? (
          <>
            <rect x={-bw * 0.28} y={-bh / 2 - 1.5} width={4} height={bh + 3} fill="#38bdf8" opacity="0.7" />
            <rect x={bw * 0.28 - 4} y={-bh / 2 - 1.5} width={4} height={bh + 3} fill="#38bdf8" opacity="0.7" />
          </>
        ) : null}
        {/* Terminals */}
        {part.terminals.map((t) => {
          const isPwr = t.kind === 'power';
          return (
            <circle
              key={t.id}
              cx={t.localOffsetRatio[0] * bw}
              cy={-t.localOffsetRatio[1] * bh}
              r={2.6}
              fill={isPwr ? '#f59e0b' : '#38bdf8'}
              stroke="#081321"
              strokeWidth="0.8"
            />
          );
        })}
        {/* Forward +X orientation vector */}
        <line x1={0} y1={0} x2={bw / 2 + 10} y2={0} stroke="#34d399" strokeWidth="1.8" />
        <polygon points={`${bw / 2 + 14},0 ${bw / 2 + 7},-3.5 ${bw / 2 + 7},3.5`} fill="#34d399" />
      </g>
      <text x="6" y="12" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
        {lMm}×{wMm}×{hMm}mm
      </text>
      <text x="6" y="90" fill="#34d399" fontSize="8" fontFamily="monospace">
        +X fwd · yaw {normalizeYawDeg(yawDeg)}°
      </text>
    </svg>
  );
}

function PoseEditor({
  instance,
  onMove,
}: {
  instance: ComponentInstance;
  onMove: (p: Pose, yaw: number) => void;
}) {
  const [position, setPosition] = useState(
    instance.positionM.map((n) => String(Math.round(n * 100000) / 100)),
  );
  const [yaw, setYaw] = useState(String(instance.yawDeg));
  return (
    <fieldset className="g-group">
      <legend>Position and orientation</legend>
      <p className="faint">
        Component centre in robot coordinates: X forward, Y left, Z up. Metres internally; edit
        millimetres here.
      </p>
      {['X', 'Y', 'Z'].map((axis, i) => (
        <label className="g-field" key={axis}>
          <span>{axis} (mm)</span>
          <input
            type="number"
            step="1"
            value={position[i]}
            onChange={(e) => setPosition((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
          />
        </label>
      ))}
      <label className="g-field">
        <span>Yaw (degrees)</span>
        <input
          type="number"
          min="-360"
          max="360"
          value={yaw}
          onChange={(e) => setYaw(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() =>
          onMove(
            position.map((v) => (v.trim() ? Number(v) / 1000 : NaN)) as Pose,
            yaw.trim() ? Number(yaw) : NaN,
          )
        }
      >
        Preview move
      </button>
    </fieldset>
  );
}


const STATUS_BADGE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'pass',
  warn: 'marginal',
  fail: 'fail',
};

export default function AssemblyWorkspace({
  robotId,
  view,
  onView,
  draftSpec,
  draftIdentity,
}: {
  robotId: string;
  draftSpec?: Record<string, unknown>;
  draftIdentity?: string;
  view?: 'components' | 'wiring';
  onView?: (v: 'components' | 'wiring') => void;
}) {
  const [storedRobots] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const robots = useMemo(() => activeRecords(storedRobots), [storedRobots]);
  const [legacy, , ready] = useStore<Assemblies>(ASSEMBLY_KEY, {});
  const all = useMemo(() => effectiveAssemblies(storedRobots, legacy), [storedRobots, legacy]);
  /* The Workshop's Build and Wiring tabs pick the view; standalone, the
   * workbench keeps its own sub-tabs. */
  const [tabState, setTabState] = useState<'components' | 'wiring'>(view ?? 'components');
  const tab = view ?? tabState;
  const setTab = (t: 'components' | 'wiring') => {
    setTabState(t);
    onView?.(t);
  };
  const [componentId, setComponentId] = useState(COMPONENTS[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AssemblyOperation | null>(null);
  const [notice, setNotice] = useState('');
  const [failed3D, setFailed3D] = useState(false);
  const [quality, setQuality] = useState<'high' | 'balanced'>('high');
  useEffect(() => {
    // Start lightweight on phones/tablets; explicit quality choices remain available.
    if (window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) setQuality('balanced');
  }, []);
  const [animate, setAnimate] = useState(true);
  const [xray, setXray] = useState(false);
  const [explode, setExplode] = useState(0);
  const [dragMode, setDragMode] = useState(!view);
  const [snapDeck, setSnapDeck] = useState(true);
  const [ghostMount, setGhostMount] = useState(true);
  const [showSpecWiring, setShowSpecWiring] = useState(true);
  const [showFov, setShowFov] = useState(false);
  const [fovDeg, setFovDeg] = useState(60);
  const [fovRange, setFovRange] = useState(0.5);
  const [replay, setReplay] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [retry, setRetry] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /* Take-apart motion (Abel, 2026-11-01: "animate the robots in build,
   * use the take apart skill"): parts come off one at a time in the
   * bench order from lib/teardown.ts, or start apart and go back on. */
  const [tdOn, setTdOn] = useState(false);
  const [tdOff, setTdOff] = useState(0);
  const [tdDir, setTdDir] = useState<1 | -1>(1);
  const [tdPlaying, setTdPlaying] = useState(false);
  /* Slow idle turn until the person first touches the model. */
  const [spin, setSpin] = useState(false);
  const robot = robots.find((r) => r.id === robotId);
  const spec = draftSpec ?? robot?.versions.at(-1)?.spec;
  const saved = useMemo(() => currentAssembly(all, robotId), [all, robotId]);
  const { preview, previewError } = useMemo(() => {
    if (!proposal) return { preview: saved, previewError: '' };
    try {
      return { preview: previewAssembly(robots, all, proposal), previewError: '' };
    } catch (e) {
      return { preview: saved, previewError: (e as Error).message };
    }
  }, [robots, all, proposal, saved]);
  const overlaps = useMemo(() => overlapPairs(preview.components), [preview.components]);
  const collisionIds = useMemo(() => [...new Set(overlaps.flat())], [overlaps]);
  const previousVersion = (all[robotId] ?? []).at(-2);
  const instance = preview.components.find((c) => c.id === selected);
  const built = useMemo(() => {
    try {
      return spec ? taBuildParts(spec as RobotSpec) : null;
    } catch {
      return null;
    }
  }, [spec]);
  const td = useMemo(() => teardownSteps(built ? built.parts.map((p) => p.id) : []), [built]);
  useEffect(() => {
    if (!tdPlaying || view === 'wiring') return;
    const end = tdDir > 0 ? td.steps.length : 0;
    if (tdOff === end) {
      setTdPlaying(false);
      return;
    }
    const t = setTimeout(() => { if (!document.hidden) setTdOff((n) => Math.min(td.steps.length, Math.max(0, n + tdDir))); else setTdPlaying(false); }, 1500);
    const pauseHidden = () => {if(document.hidden) setTdPlaying(false);};
    document.addEventListener('visibilitychange',pauseHidden);
    return () => {clearTimeout(t);document.removeEventListener('visibilitychange',pauseHidden);};
  }, [tdPlaying, tdOff, tdDir, td.steps.length, view]);
  const benchIdentity = `${robotId}:${robot?.versions.at(-1)?.id ?? ''}:${draftIdentity ?? JSON.stringify(spec)}`;
  const hydratedBench = useRef('');
  const [workshopScene, setWorkshopScene] = useState(true);
  const [showModel, setShowModel] = useState(true);
  const [hiddenParts, setHiddenParts] = useState<string[]>([]);
  const [cameraReset, setCameraReset] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const records = readStore<Record<string, unknown>>(BENCH_PROGRESS_KEY, {});
    const state = restoreBench(records[robotId], benchIdentity, td.steps.length);
    setTdOn(state?.active ?? false); setTdOff(state?.off ?? 0); setTdDir(state?.direction ?? 1); setTdPlaying(false);
    hydratedBench.current = benchIdentity;
  }, [benchIdentity, robotId, ready, td.steps.length]);
  useEffect(() => {
    if (!ready || hydratedBench.current !== benchIdentity) return;
    // Defer so an identity-change restore renders before a save can run.
    const timer = setTimeout(() => {
      const records = readStore<Record<string, unknown>>(BENCH_PROGRESS_KEY, {});
      const error = writeStore(BENCH_PROGRESS_KEY, {...records, [robotId]: {identity: benchIdentity, state: {active: tdOn, off: tdOff, direction: tdDir}}});
      if (error) setNotice(error);
    }, 150);
    return () => clearTimeout(timer);
  }, [ready, benchIdentity, robotId, tdOn, tdOff, tdDir]);
  const benchState: BenchState = {active: tdOn, off: tdOff, direction: tdDir};
  const practicePartId = tdOn ? td.steps[tdDir < 0 ? tdOff - 1 : tdOff] : null;
  const practicePart = built?.parts.find(p => p.id === practicePartId);
  const selectedBuiltPart = built?.parts.find(p => p.id === selected);
  const benchCommand = (command: BenchCommand): string => {
    if (command === 'explain') return selectedBuiltPart ? `${selectedBuiltPart.name}: ${selectedBuiltPart.does} ${selectedBuiltPart.dims}` : 'Select a part on the robot or in the parts list first.';
    if (!td.steps.length) return 'This model has no removable part groups. Add a supported spec or use the recorded parts diagram.';
    if (command === 'hint') {
      if (practicePart) {setSelected(practicePart.id); return `${tdDir < 0 ? 'Place' : 'Remove'} ${practicePart.name}. ${practicePart.does} This is illustrative assembly practice; fastening details are not recorded.`;}
      return 'Start guided assembly to get a hint for the next part.';
    }
    const next = benchTransition(benchState, command, td.steps.length);
    setTdPlaying(false); setTdOn(next.active); setTdOff(next.off); setTdDir(next.direction);
    setExplode(0); setDragMode(false);
    const part = td.steps[next.direction < 0 ? next.off - 1 : next.off];
    if (part) setSelected(part);
    if (command === 'reset') return 'Reset the assembly practice. All model parts are back in place; the saved robot is unchanged.';
    if (!next.active) return 'Start guided assembly or teardown first.';
    return `${next.direction < 0 ? 'Assembly' : 'Teardown'}: ${next.direction < 0 ? td.steps.length - next.off : next.off} of ${td.steps.length} part groups complete. ${part ? 'Next: ' + (built?.parts.find(p => p.id === part)?.name ?? part) : 'Practice complete.'} Saved robot and engineering checks are unchanged.`;
  };
  useEffect(() => {
    if (view === 'wiring') return;
    const onCommand = (event: Event) => {
      const result = (event as CustomEvent<BenchResult>).detail;
      if (result.handled) return;
      result.handled = true; result.message = benchCommand(result.command); setNotice(result.message);
    };
    const onReset = (event: Event) => {
      const result = (event as CustomEvent<ReassembleResult>).detail;
      if (result.handled) return;
      result.handled = true; result.message = benchCommand('reset');
    };
    window.addEventListener(BENCH_EVENT, onCommand);
    window.addEventListener(WORKSHOP_REASSEMBLE_EVENT, onReset);
    return () => {window.removeEventListener(BENCH_EVENT, onCommand); window.removeEventListener(WORKSHOP_REASSEMBLE_EVENT, onReset);};
  });
  const definition = instance ? componentById(instance.componentId) : null;
  const activePartDef = componentById(componentId) ?? COMPONENTS[0];

  const intelligence = useMemo(() => {
    if (!spec) return null;
    return evaluatePlacementIntelligence(
      preview.components,
      {
        length_m: Number(spec.length_m ?? 0.24),
        width_m: Number(spec.width_m ?? 0.18),
        height_m: Number(spec.height_m ?? 0.14),
        ground_clearance_m: Number(spec.ground_clearance_m ?? 0.03),
        mass_kg: Number(spec.mass_kg ?? 1.5),
      },
      preview.connections,
    );
  }, [preview.components, preview.connections, spec]);

  const selectedDiag = useMemo(
    () => intelligence?.diagnostics.find((d) => d.instanceId === selected) ?? null,
    [intelligence, selected],
  );

  if (!ready || !spec) return <p>Loading saved robot assembly…</p>;

  const deckSpec = {
    length_m: Number(spec.length_m ?? 0.24),
    width_m: Number(spec.width_m ?? 0.18),
    height_m: Number(spec.height_m ?? 0.14),
    ground_clearance_m: Number(spec.ground_clearance_m ?? 0.03),
    mass_kg: Number(spec.mass_kg ?? 1.5),
  };

  const propose = (args: Parameters<typeof operationFor>[3]) => {
    try {
      const op = operationFor(robots, all, robotId, args);
      previewAssembly(robots, all, op);
      setProposal(op);
      setNotice('');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const apply = () => {
    if (!proposal) return;
    const op = proposal;
    setProposal(null);
    try {
      const freshRobots = readStore<GarageRobot[]>(GARAGE_KEY, []);
      const fresh = readStore<Assemblies>(ASSEMBLY_KEY, {});
      const next = commitAssemblyVersion(
        freshRobots,
        fresh,
        op,
        uid('assembly'),
        new Date().toISOString(),
      );
      const error = writeStore(GARAGE_KEY, next);
      if (error) throw new Error(error);
      if (op.kind === 'add') setSelected(op.instanceId);
      setNotice('Assembly saved as a new version.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const addSmart = (targetCompId = componentId) => {
    const rec = recommendSmartPlacement(targetCompId, saved.components, deckSpec);
    const id = uid('part');
    setSelected(id);
    propose({
      kind: 'add',
      instanceId: id,
      componentId: targetCompId,
      positionM: rec.positionM,
      yawDeg: rec.yawDeg,
    });
    setNotice(`Smart placement preview: ${rec.zoneLabel} (${rec.rationale.join(' · ')})`);
  };
  const addCenter = () => {
    const part = componentById(componentId)!;
    const id = uid('part');
    setSelected(id);
    propose({
      kind: 'add',
      instanceId: id,
      componentId,
      positionM: [0, 0, mountedCenterZ(deckSpec, part)],
      yawDeg: part.orientation.preferredYawDeg ?? 0,
    });
  };
  const partName = (id: string | null) => {
    const p = built?.parts.find((x) => x.id === id);
    return p ? (p.qty > 1 ? `${p.name} ×${p.qty}` : p.name) : (id ?? '');
  };
  const startTd = (dir: 1 | -1) => {
    setExplode(0);
    setDragMode(false);
    setTdOn(true);
    setTdDir(dir);
    setTdOff(dir > 0 ? 0 : td.steps.length);
    setTdPlaying(false);
  };
  const stopTd = () => {
    setTdPlaying(false);
    setTdOn(false);
    setTdOff(0);
  };
  const tdStatus = !tdOn
    ? ''
    : tdOff === 0
      ? `Assembled · ${td.steps.length} parts, then the ${partName(td.core).toLowerCase()}`
      : tdOff >= td.steps.length
        ? `All ${td.steps.length} parts off · the ${partName(td.core).toLowerCase()} is left on the bench`
        : `${tdOff} of ${td.steps.length} off · ${tdDir > 0 ? 'just removed' : 'next on'}: ${partName(td.steps[tdOff - 1])}`;
  const motionBar = td.steps.length > 0 ? (
    <section className="ws-guided" aria-label="Guided assembly">
      <div className="ws-guided-head"><div><span className="eyebrow">Assembly practice</span><h3>{tdOn ? (tdDir < 0 ? 'Build it, part by part' : 'Take it apart') : 'Your robot on the bench'}</h3></div><span className="fbadge local">CONCEPT MODEL</span></div>
      <p className="faint g-small">Illustrative part groups from this spec. Steps are a suggested visual order, not verified manufacturing instructions.</p>
      <div className="ta-controls">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNotice(benchCommand('assemble'))}>Build it step by step</button>
        <button type="button" className="btn btn-sm" onClick={() => setNotice(benchCommand('disassemble'))}>Take it apart</button>
        <button type="button" className="btn btn-sm" onClick={() => setNotice(benchCommand('reset'))}>Reassemble</button>
      </div>
      {tdOn && <div className="ws-guided-step" aria-live="polite">
        <progress max={td.steps.length} value={tdDir < 0 ? td.steps.length - tdOff : tdOff} aria-label="Assembly practice progress" />
        <strong>{practicePart ? `${tdDir < 0 ? 'Place' : 'Remove'} ${practicePart.name}` : 'Practice complete'}</strong>
        <p>{practicePart?.does ?? 'All steps in this visual sequence are complete.'}</p>
        <div className="ta-controls">
          <button type="button" className="btn btn-sm" disabled={tdDir < 0 ? tdOff === td.steps.length : tdOff === 0} onClick={() => setNotice(benchCommand('back'))}>Back</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!practicePart} onClick={() => setNotice(benchCommand('next'))}>Do this step</button>
          <button type="button" className="btn btn-sm" onClick={() => setNotice(benchCommand('hint'))}>Hint</button>
          <button type="button" className="btn btn-sm" disabled={!practicePart} onClick={() => setTdPlaying(v => !v)}>{tdPlaying ? 'Pause' : 'Auto-build'}</button>
        </div>
      </div>}
      <details className="ws-disclosure"><summary>Show or hide part groups</summary><div className="ws-part-picks" role="group" aria-label="Part visibility">{built?.parts.map(part => <button type="button" className="chip" key={part.id} aria-pressed={!hiddenParts.includes(part.id)} onClick={() => setHiddenParts(ids => ids.includes(part.id) ? ids.filter(id => id !== part.id) : [...ids,part.id])}>{hiddenParts.includes(part.id) ? 'Show' : 'Hide'} {part.name}</button>)}</div></details>
      <BenchLearning key={benchIdentity} parts={built?.parts ?? []} onSelect={setSelected} />
      <details className="ws-disclosure"><summary>Inspect parts · {built?.parts.length ?? 0} groups</summary><div className="ws-part-picks">{built?.parts.map(part => <button type="button" className="chip" key={part.id} aria-pressed={selected === part.id} onClick={() => setSelected(part.id)}>{part.name}</button>)}</div></details>
      {selectedBuiltPart && <aside className="ws-guided-part" aria-label="Selected part"><strong>{selectedBuiltPart.name}</strong><p>{selectedBuiltPart.does}</p><p className="faint g-small">{selectedBuiltPart.dims}</p><button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:'Explain this part',send:true})}>Ask Wrench about this part</button></aside>}
      <div className="ta-controls"><button type="button" className="btn btn-sm" aria-pressed={workshopScene} onClick={() => setWorkshopScene(v => !v)}>Workshop setting {workshopScene ? 'on' : 'off'}</button><button type="button" className="btn btn-sm" onClick={() => setCameraReset(n => n + 1)}>Reset camera</button><button type="button" className="btn btn-sm" onClick={() => setShowModel(v => !v)}>{showModel ? 'Use lightweight view' : 'Show 3D'}</button></div>
    </section>
  ) : null;

  const wiringOrParts =
    tab === 'components' ? (
      <details className="assembly-catalog ws-disclosure">
        <summary>Add a component</summary>
        <label className="g-field"><span>Component</span>
          <select value={componentId} onChange={(e) => setComponentId(e.target.value)}>
            {PART_GROUPS.map((g) => <optgroup key={g.id} label={g.label}>{COMPONENTS.filter((c) => partGroup(c.category, c.name) === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
        </label>
        <div className="ws-component-preview">
          <img src={assetPath(activePartDef.image)} alt={activePartDef.imageCaption} width={64} height={64} />
          <div><strong>{activePartDef.name}</strong><p className="faint g-small">Preview placement before adding it to your assembly.</p></div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => addSmart(componentId)}>Preview placement</button>
        </div>
        <details className="ws-disclosure"><summary>Dimensions and mounting</summary>
          <PartBlueprintSVG part={activePartDef} yawDeg={activePartDef.orientation.preferredYawDeg ?? 0} />
          <p>{activePartDef.mounting.fastener} · {Math.round(activePartDef.massKg * 1000)} g</p>
          <p className="faint g-small">{activePartDef.note}</p>
          <button type="button" className="btn btn-sm" onClick={addCenter}>Preview at centre</button>
        </details>
      </details>
    ) : (
      <>
        <h4>
          Planned connections{' '}
          <span
            className="verdict norun"
            title="Component-to-component planning edges. Pin assignments, wire gauge, protection, voltage ranges and current ratings are not yet entered or checked. They do not alter the core harness report."
          >
            NOT CHECKED
          </span>
        </h4>
        <p className="faint">
          Cables attach to each 3D part&apos;s rotated power/data terminals and update their 3D length
          as you move or rotate components on the deck.
        </p>
        {[
          ['From', from, setFrom],
          ['To', to, setTo],
        ].map(([label, value, setter]) => (
          <label className="g-field" key={String(label)}>
            <span>{String(label)}</span>
            <select
              value={String(value)}
              onChange={(e) => (setter as (s: string) => void)(e.target.value)}
            >
              <option value="">Select component</option>
              {saved.components.map((c) => {
                const def = componentById(c.componentId);
                return (
                  <option value={c.id} key={c.id}>
                    {def?.name} ({c.id}) · {def?.terminals.map((t) => t.label).join(' / ')}
                  </option>
                );
              })}
            </select>
          </label>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          disabled={!from || !to}
          onClick={() => propose({ kind: 'connect', instanceId: from, targetId: to })}
        >
          Preview connection
        </button>
        <ul className="assembly-wires">
          {saved.connections.map((c) => {
            const fromPart = saved.components.find((p) => p.id === c.from);
            const toPart = saved.components.find((p) => p.id === c.to);
            const fromDef = fromPart ? componentById(fromPart.componentId) : null;
            const toDef = toPart ? componentById(toPart.componentId) : null;
            const lenMm = intelligence?.cableLengthsMm[c.id];
            return (
              <li key={c.id}>
                <strong>{fromDef?.name ?? c.from}</strong> ({c.from}) →{' '}
                <strong>{toDef?.name ?? c.to}</strong> ({c.to}) ·{' '}
                {lenMm ? `~${lenMm} mm 3D route · ` : ''}
                NOT_CHECKED{' '}
                <button
                  type="button"
                  className="chip"
                  onClick={() => propose({ kind: 'disconnect', instanceId: c.id })}
                >
                  Remove connection
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );

  return (
    <section className="g-editor assembly-workbench" id="assembly" aria-label="Robot assembly">
      {!view && <h3>Assembly workbench</h3>}
      <details className="g-howto">
        <summary>How the bench works</summary>
        <p>
          This previews the current Workshop draft; added component placement uses the saved assembly. Added parts, placement and planned connections save
          separately from the CLI spec. These added parts are not yet included in mass, electrical
          or Gazebo checks. Your unsaved spec draft stays in the editor.
        </p>
        <p>
          Drag placement: move a part in XY on a 5 mm grid, release to preview, Cancel the preview
          to discard a move; Escape cancels an active drag. Deck snap uses the schematic plate
          surface plus each part&apos;s standoff height. Disable explode and finish playback before
          dragging.
        </p>
        <p>
          Orbit: drag · Zoom: scroll or pinch · Select: click a part or cable. Stylized component
          details are visual proxies, not manufacturer CAD. Cable arcs and pulses show planned
          connectivity, not electrical current or verified routing.
        </p>
      </details>
      <div className="g-tabs" aria-label="Workbench views">
        {!view && (
          <>
            <button
              type="button"
              className="chip"
              aria-pressed={tab === 'components'}
              onClick={() => setTab('components')}
            >
              Components & placement
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={tab === 'wiring'}
              onClick={() => setTab('wiring')}
            >
              Wiring ({saved.connections.length})
            </button>
          </>
        )}
        <button
          type="button"
          className="chip"
          onClick={() =>
            downloadJSON('robot-assembly.json', {
              format: 'robotforge-assembly-v1',
              robotId,
              spec,
              versions: all[robotId] ?? [],
            })
          }
        >
          Export assembly
        </button>
        <button
          type="button"
          className="chip"
          disabled={!saved.id}
          onClick={() => {
            try {
              const fresh = readStore<Assemblies>(ASSEMBLY_KEY, {});
              const next = undoVersionedAssembly(
                readStore<GarageRobot[]>(GARAGE_KEY, []),
                fresh,
                robotId,
                robot!.versions.at(-1)!.id,
                saved.id,
                uid('assembly'),
                new Date().toISOString(),
              );
              const error = writeStore(GARAGE_KEY, next);
              if (error) throw new Error(error);
              setProposal(null);
              setNotice('Previous assembly restored as a new version.');
            } catch (e) {
              setNotice((e as Error).message);
            }
          }}
        >
          Undo assembly change
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {proposal && (
        <div className="card assembly-preview" role="region" aria-label="Assembly operation preview">
          <strong>Preview: {previewError || preview.note}</strong>
          <p>
            Placement is illustrative. Only added-component envelope overlaps and heuristic deck/FOV
            zones are checked. Fastener fit, chassis interference, thermal and electrical validation
            are not performed.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={Boolean(previewError)}
            onClick={apply}
          >
            Apply assembly change
          </button>{' '}
          <button type="button" className="btn btn-sm" onClick={() => setProposal(null)}>
            Cancel
          </button>
        </div>
      )}
      <details className="assembly-tools">
        <summary>View and placement settings</summary>
        <div className="g-tabs assembly-controls" aria-label="3D workbench controls">
          <label className="g-field">
            <span>Graphics quality</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as 'high' | 'balanced')}
            >
              <option value="high">Studio · highest quality</option>
              <option value="balanced">Balanced · lighter GPU load</option>
            </select>
          </label>
          <button
            type="button"
            className="chip"
            aria-pressed={animate}
            onClick={() => setAnimate((v) => !v)}
          >
            Motion effects {animate ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={xray}
            onClick={() => setXray((v) => !v)}
          >
            X-ray {xray ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={dragMode}
            disabled={explode > 0 || replay < 1 || playing || tdOn}
            onClick={() => setDragMode((v) => !v)}
          >
            Drag placement {dragMode ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={snapDeck}
            onClick={() => setSnapDeck((v) => !v)}
          >
            Snap to deck {snapDeck ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={ghostMount}
            onClick={() => setGhostMount((v) => !v)}
          >
            3D standoffs & mounts {ghostMount ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={showSpecWiring}
            onClick={() => setShowSpecWiring((v) => !v)}
          >
            3D spec wiring harness {showSpecWiring ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={showFov}
            onClick={() => setShowFov((v) => !v)}
          >
            FOV sketch {showFov ? 'on' : 'off'}
          </button>
          <label className="g-field">
            <span>Explode assembly · {explode} mm</span>
            <input
              type="range"
              min="0"
              max="100"
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
            />
          </label>
        </div>
      </details>
      {overlaps.length > 0 && (
        <p role="status">
          Envelope overlaps: {overlaps.length} pair(s), highlighted red at saved/preview positions.
          This checks added component boxes only, including yaw; not the chassis, cables, mounting
          hardware or detailed CAD.
        </p>
      )}
      {ghostMount && (
        <details className="ws-disclosure"><summary>About the model</summary><p className="faint">
          3D standoffs & mounts show illustrative corner standoff posts, battery straps, and +X
          forward orientation arrows. Hole locations and fasteners are unverified; it is not
          printable CAD.
        </p></details>
      )}
      {showFov && (
        <fieldset className="g-group">
          <legend>Illustrative FOV on selected component · local +X forward</legend>
          <label className="g-field">
            <span>Full cone angle (degrees)</span>
            <input
              type="number"
              min="5"
              max="150"
              value={fovDeg}
              onChange={(e) => setFovDeg(Math.max(5, Math.min(150, Number(e.target.value) || 60)))}
            />
          </label>
          <label className="g-field">
            <span>Range (m)</span>
            <input
              type="number"
              min="0.05"
              max="5"
              step="0.05"
              value={fovRange}
              onChange={(e) =>
                setFovRange(Math.max(0.05, Math.min(5, Number(e.target.value) || 0.5)))
              }
            />
          </label>
          <p>Assumed visualization inputs, not a sensor datasheet or a 3D mesh obstruction test.</p>
        </fieldset>
      )}
      {previousVersion && (
        <fieldset className="g-group">
          <legend>Upgrade playback · previous assembly → latest preview</legend>
          <input
            aria-label="Upgrade playback progress"
            type="range"
            min="0"
            max="100"
            value={Math.round(replay * 100)}
            onChange={(e) => {
              setPlaying(false);
              setReplay(Number(e.target.value) / 100);
            }}
          />
          <button
            type="button"
            className="chip"
            onClick={() => {
              setReplay(0);
              setPlaying(true);
              setDragMode(false);
            }}
          >
            Play upgrade
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setPlaying(false);
              setReplay(1);
            }}
          >
            Latest pose
          </button>
          <p>
            Component-pose comparison only; cables show the latest planned connections. Scrubbing
            does not change saved versions. Motion respects reduced-motion preferences.
          </p>
        </fieldset>
      )}
      {view === 'wiring' && <button type="button" className="btn btn-sm" onClick={() => promptWrench({mode:'chat',text:`Connect "battery" to "controller" on "${robot?.name}"`})}>Plan a connection with Wrench</button>}
      {!failed3D && showModel ? (
        <div
          onPointerDownCapture={() => {
            if (spin) setSpin(false);
          }}
        >
          <UnitySceneChoice robotId={robotId} versionId={robot?.versions.at(-1)?.id ?? 'new'} spec={spec}><Robot3D
            key={retry}
            workshop={workshopScene && view !== 'wiring'}
            cameraReset={cameraReset}
            hiddenParts={hiddenParts}
            spec={spec as RobotSpec}
            explode={explode}
            selected={selectedWire ?? selected}
            onSelect={(id) => {
              const wire = preview.connections.find((c) => c.id === id);
              if (wire) {
                setSelectedWire(id);
                setTab('wiring');
                setFrom(wire.from);
                setTo(wire.to);
                setNotice('Selected planned connection · NOT_CHECKED');
              } else {
                setSelectedWire(null);
                setSelected(id);
                const inst = preview.components.find((c) => c.id === id);
                const def = inst ? componentById(inst.componentId) : null;
                if (def?.orientation.fovDeg) {
                  setFovDeg(def.orientation.fovDeg);
                  setFovRange(def.orientation.fovRangeM ?? 0.6);
                }
              }
            }}
            onFail={() => setFailed3D(true)}
            instances={preview.components}
            connections={preview.connections}
            animate={animate}
            xray={xray}
            quality={quality}
            collisionIds={collisionIds}
            dragMode={dragMode && explode === 0 && replay === 1 && !playing && !tdOn}
            snapDeck={snapDeck}
            ghostMount={ghostMount}
            showSpecWiring={showSpecWiring}
            fov={showFov ? { angleDeg: fovDeg, rangeM: fovRange } : undefined}
            comparison={previousVersion?.components}
            replay={replay}
            playing={playing}
            onPlaybackEnd={() => {
              setPlaying(false);
              setReplay(1);
            }}
            teardown={tdOn ? { removed: td.steps.slice(0, tdOff), isolate: null } : undefined}
            autoRotate={spin}
            onMove={(id, positionM) => {
              const current = preview.components.find((c) => c.id === id);
              if (current) {
                setSelected(id);
                propose({ kind: 'move', instanceId: id, positionM, yawDeg: current.yawDeg });
              }
            }}
          /></UnitySceneChoice>
        </div>
      ) : (
        <div className="card" role="status">
          <h4>{failed3D ? '3D unavailable' : 'Lightweight workbench'}</h4>
          <p>Use the part list, instructions, and practice controls below. Your robot record is unchanged.</p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setFailed3D(false); setShowModel(true);
              setRetry((v) => v + 1);
            }}
          >
            Retry 3D
          </button>
        </div>
      )}

      {view !== 'wiring' && motionBar}
      {spec.upgradePlan && <SavedUpgrade plan={spec.upgradePlan} artifacts={spec.upgradeArtifacts ?? []} versionId={robot!.versions.at(-1)!.id} wiring={spec.wiring} />}
      {tab === 'components' && (
        <details className="ws-disclosure"><summary>Upgrades and printable parts</summary>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => promptWrench({mode: 'chat', text: `Plan a Raspberry Pi 5 upgrade for "${robot!.name}"`})}>Plan a Raspberry Pi 5 upgrade</button>
        <label className="g-field"><span>Design a printable part for</span>
          <select value={(definition ?? activePartDef).id} onChange={e => { setSelected(null); setSelectedWire(null); setComponentId(e.target.value); }}>
            {PART_GROUPS.map(g => <optgroup key={g.id} label={g.label}>{COMPONENTS.filter(c => partGroup(c.category,c.name) === g.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
        </label>
        <BuildArtifacts
          key={robotId + ':' + (definition ?? activePartDef).id}
          robotId={robotId}
          robotVersionId={robot!.versions.at(-1)!.id}
          part={definition ?? activePartDef}
        />
        </details>
      )}

      {/* Placement, Orientation & Mounting Intelligence Summary */}
      {intelligence && preview.components.length > 0 && (
        <details className="ws-disclosure"><summary>Placement analysis</summary><div
          className="card"
          role="region"
          aria-label="Placement, orientation and mounting intelligence"
          style={{ marginTop: 12 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Placement, Orientation & Mounting Intelligence</h4>
            <span
              className={
                'verdict ' +
                (intelligence.com.status === 'balanced'
                  ? 'pass'
                  : intelligence.com.status === 'offset'
                    ? 'marginal'
                    : 'fail')
              }
            >
              CoM: {intelligence.com.status.toUpperCase()} · {intelligence.com.totalMassKg} kg total
            </span>
          </div>
          <p className="faint" style={{ margin: '6px 0 10px' }}>
            {intelligence.com.summary}
          </p>
          <div className="g-tablewrap">
            <table className="g-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Pose & Yaw</th>
                  <th>Deck & Clearance</th>
                  <th>Mounting Hardware</th>
                  <th>Orientation & FOV</th>
                  <th>Smart Fix</th>
                </tr>
              </thead>
              <tbody>
                {intelligence.diagnostics.map((d) => {
                  const inst = preview.components.find((c) => c.id === d.instanceId);
                  if (!inst) return null;
                  return (
                    <tr
                      key={d.instanceId}
                      onClick={() => {
                        setSelectedWire(null);
                        setSelected(d.instanceId);
                      }}
                      style={{
                        cursor: 'pointer',
                        background:
                          selected === d.instanceId ? 'rgba(45, 212, 191, 0.08)' : undefined,
                      }}
                    >
                      <td>
                        <strong>{d.componentName}</strong>
                        <div className="g-small faint">{d.instanceId}</div>
                      </td>
                      <td className="m">
                        {inst.positionM.map((v) => Math.round(v * 1000)).join(', ')} mm
                        <br />
                        <span className="faint">yaw {normalizeYawDeg(inst.yawDeg)}°</span>
                      </td>
                      <td>
                        <span className={'verdict ' + STATUS_BADGE[d.placementStatus]}>
                          {d.placementStatus.toUpperCase()}
                        </span>
                        <div className="g-small">{d.placementNotes.join(' ')}</div>
                      </td>
                      <td>
                        <span className={'verdict ' + STATUS_BADGE[d.mountingStatus]}>
                          {d.mountingStatus.toUpperCase()}
                        </span>
                        <div className="g-small">{d.mountingNotes.join(' ')}</div>
                      </td>
                      <td>
                        <span className={'verdict ' + STATUS_BADGE[d.orientationStatus]}>
                          {d.orientationStatus.toUpperCase()}
                        </span>
                        <div className="g-small">{d.orientationNotes.join(' ')}</div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const rec = recommendSmartPlacement(
                              inst.componentId,
                              preview.components,
                              deckSpec,
                              inst.id,
                            );
                            setSelected(inst.id);
                            propose({
                              kind: 'move',
                              instanceId: inst.id,
                              positionM: rec.positionM,
                              yawDeg: rec.yawDeg,
                            });
                            setNotice(
                              `Smart re-place preview for ${d.componentName}: ${rec.zoneLabel}`,
                            );
                          }}
                        >
                          Auto-orient & place
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div></details>
      )}

      {view !== 'wiring' && (view ? <button type="button" className="btn btn-primary btn-sm" onClick={() => promptWrench({mode:'chat',text:`Add a camera to "${robot?.name}"`})}>Add a component with Wrench</button> : wiringOrParts)}
      <h4>Components ({preview.components.length})</h4>
      {!preview.components.length && <p>No added components yet. Use “Add a component” to preview one.</p>}
      <ul className="assembly-parts">
        {preview.components.map((c) => {
          const def = componentById(c.componentId);
          return (
            <li key={c.id}>
              <button
                type="button"
                className="chip"
                aria-pressed={selected === c.id}
                onClick={() => {
                  setSelectedWire(null);
                  setSelected(c.id);
                }}
              >
                {def?.name}
              </button>{' '}
              {selected === c.id && <span className="faint">
                {c.positionM.map((v) => Math.round(v * 1000)).join(', ')} mm · yaw{' '}
                {normalizeYawDeg(c.yawDeg)}° · {def?.mounting.fastener}
              </span>}
            </li>
          );
        })}
      </ul>
      {!view && instance && definition && (
        <div className="card">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <img
              src={assetPath(definition.image)}
              alt={definition.imageCaption}
              width={84}
              height={84}
              style={{
                width: 84,
                height: 84,
                objectFit: 'cover',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.28)',
              }}
            />
            <PartBlueprintSVG part={definition} yawDeg={instance.yawDeg} />
            <div style={{ flex: '1 1 240px' }}>
              <h4 style={{ margin: '0 0 4px' }}>{definition.name}</h4>
              <p className="faint" style={{ fontSize: 12, margin: '0 0 6px' }}>
                {definition.imageCaption}
              </p>
              <p style={{ margin: '0 0 6px' }}>{definition.note}</p>
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>Envelope:</strong> {definition.sizeM.map((v) => Math.round(v * 1000)).join(' × ')} mm ·{' '}
                <strong>Mass:</strong> {Math.round(definition.massKg * 1000)} g ·{' '}
                {definition.geometry === 'published-envelope'
                  ? 'Published envelope; simplified geometry'
                  : 'ESTIMATED illustrative dimensions'}
              </p>
            </div>
          </div>

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
              margin: '12px 0',
              padding: 10,
              background: 'rgba(15, 23, 42, 0.5)',
              borderRadius: 8,
            }}
          >
            <div>
              <dt className="faint" style={{ fontSize: 11 }}>
                Mounting hardware & pattern
              </dt>
              <dd style={{ margin: '2px 0 0', fontSize: 13 }}>
                <strong>{definition.mounting.fastener}</strong> ({definition.mounting.kind})
                {definition.mounting.holePatternMm.length > 0
                  ? ` · ${definition.mounting.holePatternMm.length} holes (${Math.abs(definition.mounting.holePatternMm[0][0]) * 2} × ${Math.abs(definition.mounting.holePatternMm[0][1]) * 2} mm spacing)`
                  : ''}
                {definition.mounting.standoffHeightMm > 0
                  ? ` · ${definition.mounting.standoffHeightMm} mm standoff`
                  : ''}
                <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {definition.mounting.notes}
                </div>
              </dd>
            </div>
            <div>
              <dt className="faint" style={{ fontSize: 11 }}>
                Orientation & clearance rules
              </dt>
              <dd style={{ margin: '2px 0 0', fontSize: 13 }}>
                <strong>{definition.orientation.forwardAxisLabel}</strong>
                {definition.orientation.keepoutFrontMm
                  ? ` · ${definition.orientation.keepoutFrontMm} mm front port keep-out`
                  : ''}
                {definition.orientation.thermalClearanceTopMm
                  ? ` · ${definition.orientation.thermalClearanceTopMm} mm top airflow clearance`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="faint" style={{ fontSize: 11 }}>
                Terminals & connectors
              </dt>
              <dd style={{ margin: '2px 0 0', fontSize: 13 }}>
                {definition.terminals.map((t) => `${t.label} (${t.kind})`).join(' · ')}
              </dd>
            </div>
          </dl>

          {selectedDiag && (
            <p style={{ fontSize: 13 }}>
              <strong>Live diagnostics:</strong>{' '}
              <span className={'verdict ' + STATUS_BADGE[selectedDiag.placementStatus]}>
                Fit: {selectedDiag.placementStatus.toUpperCase()}
              </span>{' '}
              <span className={'verdict ' + STATUS_BADGE[selectedDiag.mountingStatus]}>
                Mount: {selectedDiag.mountingStatus.toUpperCase()}
              </span>{' '}
              <span className={'verdict ' + STATUS_BADGE[selectedDiag.orientationStatus]}>
                Orient: {selectedDiag.orientationStatus.toUpperCase()}
              </span>
            </p>
          )}

          {definition.source && (
            <p>
              <a href={definition.source} target="_blank" rel="noreferrer">
                Manufacturer dimension source
              </a>
            </p>
          )}
          <p>Still needed: {definition.missing.join('; ')}.</p>

          <PoseEditor
            key={instance.id + '-' + saved.id + '-' + instance.positionM.join(',') + '-' + instance.yawDeg}
            instance={instance}
            onMove={(positionM, yawDeg) =>
              propose({ kind: 'move', instanceId: instance.id, positionM, yawDeg })
            }
          />

          <h4>Quick orientation presets (local +X axis)</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {[
              ['0° (+X Front)', 0],
              ['90° (+Y Left)', 90],
              ['180° (-X Rear)', 180],
              ['-90° (-Y Right)', -90],
              ['+45°', 45],
              ['-45°', -45],
            ].map(([label, yawVal]) => (
              <button
                key={String(label)}
                type="button"
                className="chip"
                aria-pressed={normalizeYawDeg(instance.yawDeg) === Number(yawVal)}
                onClick={() =>
                  propose({
                    kind: 'move',
                    instanceId: instance.id,
                    positionM: instance.positionM,
                    yawDeg: Number(yawVal),
                  })
                }
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() =>
                propose({
                  kind: 'move',
                  instanceId: instance.id,
                  positionM: instance.positionM,
                  yawDeg: normalizeYawDeg(instance.yawDeg + 90),
                })
              }
            >
              Rotate +90° CCW
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                propose({
                  kind: 'move',
                  instanceId: instance.id,
                  positionM: instance.positionM,
                  yawDeg: normalizeYawDeg(instance.yawDeg - 90),
                })
              }
            >
              Rotate -90° CW
            </button>
          </div>

          <h4>Intelligent mounting & placement zones</h4>
          <p className="faint">
            Smart placement picks the highest-scoring collision-free deck pose and orientation for{' '}
            {definition.name}; or choose a preset deck zone below.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                const rec = recommendSmartPlacement(
                  instance.componentId,
                  preview.components,
                  deckSpec,
                  instance.id,
                );
                propose({
                  kind: 'move',
                  instanceId: instance.id,
                  positionM: rec.positionM,
                  yawDeg: rec.yawDeg,
                });
                setNotice(`Smart placement preview: ${rec.zoneLabel} (${rec.rationale.join(' · ')})`);
              }}
            >
              Smart place & orient ({definition.mounting.preferredZone})
            </button>
            {['Centre', 'Forward', 'Rear'].map((label, i) => (
              <button
                type="button"
                className="chip"
                key={label}
                onClick={() =>
                  propose({
                    kind: 'move',
                    instanceId: instance.id,
                    positionM: [
                      i === 0 ? 0 : (i === 1 ? 1 : -1) * Number(spec.length_m) * 0.25,
                      0,
                      mountedCenterZ(deckSpec, definition),
                    ],
                    yawDeg: definition.orientation.preferredYawDeg ?? 0,
                  })
                }
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() =>
                propose({
                  kind: 'move',
                  instanceId: instance.id,
                  positionM: [0, Number(spec.width_m) * 0.22, mountedCenterZ(deckSpec, definition)],
                  yawDeg: definition.orientation.preferredYawDeg ?? 0,
                })
              }
            >
              Left rail
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                propose({
                  kind: 'move',
                  instanceId: instance.id,
                  positionM: [0, -Number(spec.width_m) * 0.22, mountedCenterZ(deckSpec, definition)],
                  yawDeg: definition.orientation.preferredYawDeg ?? 0,
                })
              }
            >
              Right rail
            </button>
          </div>
          <p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => propose({ kind: 'remove', instanceId: instance.id })}
            >
              Preview removal (includes attached connections)
            </button>
          </p>
        </div>
      )}
      <p className="faint">
        Assembly history: {(all[robotId] ?? []).length} saved versions. Export includes every
        assembly version.
      </p>
    </section>
  );
}
