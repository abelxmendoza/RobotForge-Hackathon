'use client';
/* The Forge conversation — the React equivalent of assets/js/forge.js.
 *
 * Describe a robot in words, or attach a photo, a parts list, a
 * spec file, or a .ply scan. A photo is first asked what it is: a
 * robot photo (drafted from appearance, every dimension ESTIMATED)
 * or a spec sheet / blueprint (TRANSCRIBED — printed values only,
 * never inferred from drawing scale; the draft is badged
 * DOCUMENT-READ). A scan is parsed and measured entirely in the
 * browser (bounding box; badged MEASURED (scan)).
 * Every stage of every run wears exactly one badge:
 *
 *   LIVE     — a real model call through the live endpoint
 *              (live-config; empty = no live steps).
 *   LOCAL    — real computation in the visitor's browser: the spec
 *              checks and the take-apart viewer.
 *   RECORDED — a replayed recorded run, labeled with its date.
 *
 * A stage never wears a badge it didn't earn: the motion gate runs
 * in Gazebo on the forge's machine, so in-browser runs show it as a
 * plain note — never a simulated verdict. Uploaded files are read
 * in the browser and sent NOWHERE unless a live step runs.
 *
 * The thread itself is component state (the vanilla thread is an
 * imperative DOM log); the Redux forge slice tracks the current
 * run's stage position (step) and input kind (tab), per the store
 * contract. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useForgeAssistant } from '@/components/chat/ChatDock';
import PartPhotoIntake from '@/components/inventory/PartPhotoIntake';
import { useDispatch } from 'react-redux';
import { setStep, setTab } from '@/store/forgeSlice';
import { BADGE_LABEL, downloadJSON } from './model';
import type {
  Badge,
  DocDraft,
  ListImportResult,
  LiveHealth,
  PartialSpec,
  PhotoDraft,
  RobotSpec,
} from './model';
import { CodeBlock, DocSpecTable, Findings, RawJSON, SpecTable } from './shared';
import { forgeValidateSpec } from './validate';
import type { ValidateResult } from './validate';
import { measureCloud, parsePly } from './scan';
import type { Measure, ParsedPly } from './scan';
import { LiveOffReason, liveBase, liveHealth, postJSON, routeOn } from './live';
import { LiveProgress, ModeBanner, offReason } from '@/components/shell/LiveStatus';
import type { LiveMode } from '@/components/shell/LiveStatus';
import { assetPath } from '../home/asset';
import { RUNS, STEP_NAMES } from './samples';
import type { SampleRun } from './samples';
import { ForgeViewer } from './ForgeViewer';
import GroupingCard from './GroupingCard';

const ScanView = dynamic(() => import('./ScanView'), { ssr: false });

type AttachKind = 'photo' | 'doc' | 'spec' | 'scan';

interface Entry {
  id: number;
  kind: 'user' | 'note' | 'stage';
  node?: ReactNode;
  badge?: Badge;
  badgeNote?: string;
  title?: string;
  body?: ReactNode;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function FileChip({ label, file }: { label: string; file: File }) {
  const kb = Math.max(1, Math.round(file.size / 1024));
  return (
    <>
      <span className="faint">{label}:</span> {file.name}{' '}
      <span className="faint">({kb} KB)</span>
    </>
  );
}

function WorkingBody({ what }: { what: string }) {
  return (
    <>
      <p className="intro">{what}</p>
      <LiveProgress
        what="Muse Spark is working on it"
        next="Engineering checks run in your browser"
      />
    </>
  );
}

function PhotoModeAsk({
  onPick,
}: {
  onPick: (mode: 'robot' | 'document' | 'part') => void;
}) {
  const [picked, setPicked] = useState(false);
  const pick = (m: 'robot' | 'document' | 'part') => {
    if (picked) return;
    setPicked(true);
    onPick(m);
  };
  return (
    <>
      <p>
        <strong>What is this a photo of?</strong>
      </p>
      <p className="intro">
        A <strong>robot photo</strong> is drafted from appearance — every
        dimension an estimate. A <strong>spec sheet or blueprint</strong> is
        transcribed — only the printed values, never inferred from drawing
        scale.
      </p>
      <p>
        <button
          className="btn btn-sm"
          type="button"
          disabled={picked}
          onClick={() => pick('robot')}
        >
          Robot photo
        </button>{' '}
        <button
          className="btn btn-sm"
          type="button"
          disabled={picked}
          onClick={() => pick('document')}
        >
          Spec sheet or blueprint
        </button>{' '}
        <button className="btn btn-sm" type="button" disabled={picked} onClick={()=>pick('part')}>Part → save to inventory</button>
      </p>
    </>
  );
}

function ScanStageBody({
  parsed,
  measure,
  onSeed,
}: {
  parsed: ParsedPly;
  measure: Extract<Measure, { ok: true }>;
  onSeed: () => void;
}) {
  const [noteText, setNoteText] = useState('Drawing the points…');
  const [showView, setShowView] = useState(true);
  const e = measure.extentsM;
  const fmt = (v: number) => v.toFixed(3) + ' m (' + Math.round(v * 1000) + ' mm)';
  return (
    <>
      <p className="intro">
        <strong>{parsed.count.toLocaleString('en-US')} points</strong> (
        {parsed.format} PLY). Method:{' '}
        <strong>bounding box of the uploaded point cloud</strong> — the extents
        below are the cloud’s axis-aligned size, axes as stored in the file (x
        → length, y → width, z → height).
      </p>
      {measure.unitNote ? (
        <div className="callout">
          <span>Unit note: {measure.unitNote}.</span>
        </div>
      ) : null}
      <table className="kv">
        <tbody>
          <tr>
            <th>Length (x)</th>
            <td>{fmt(e[0])}</td>
          </tr>
          <tr>
            <th>Width (y)</th>
            <td>{fmt(e[1])}</td>
          </tr>
          <tr>
            <th>Height (z)</th>
            <td>{fmt(e[2])}</td>
          </tr>
        </tbody>
      </table>
      {showView && (
        <div>
          <ScanView
            parsed={parsed}
            measure={measure}
            onReady={(info) =>
              setNoteText(
                'Point cloud preview — drag to orbit, pinch or scroll to zoom' +
                  (info.shown < info.total
                    ? ' (drawing ' +
                      info.shown.toLocaleString('en-US') +
                      ' of ' +
                      info.total.toLocaleString('en-US') +
                      ' points)'
                    : '') +
                  '. Drawn from your file, in this browser.',
              )
            }
            onFail={() => {
              setShowView(false);
              setNoteText(
                'The 3D preview isn’t available in this browser — the measurements above don’t depend on it.',
              );
            }}
          />
        </div>
      )}
      <p className="faint scan-view-note">{noteText}</p>
      <div className="callout warn">
        <span>
          A scan gives <strong>shape and size only</strong> — mass, motors and
          voltage can’t come from a scan, so those fields stay empty until a
          document or a description provides them.
        </span>
      </div>
      <p>
        <button className="btn btn-sm" type="button" onClick={onSeed}>
          Seed a draft spec with these dimensions
        </button>
      </p>
    </>
  );
}

const SCAN_GUIDANCE: ReactNode = (
  <p>
    <strong>Making a .ply:</strong> with an Intel RealSense, open RealSense
    Viewer, record, and export a PLY point cloud. On a phone, Scaniverse and
    Polycam export .ply; on a computer, Meshroom builds one from a photo set by
    photogrammetry. However you made it:{' '}
    <strong>depth scans arrive measured; photos arrive estimated</strong> —
    which is why the forge treats them differently.
  </p>
);

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function downscale(dataUrl: string, maxDim: number): Promise<string> {
  /* A photo data URL can be megabytes; the live endpoint caps
   * request bodies, and a vision model doesn't need 24 MP. */
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function ForgeThread() {
  const dispatch = useDispatch();
  const assistant = useForgeAssistant();
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;
  const assistantEntryIds = useRef(new Map<number,number>());
  const [inputMode,setInputMode]=useState<'chat'|'design'>('chat');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState('Checking what this deployment can do…');
  const [mode, setMode] = useState<{ mode: LiveMode; why: string }>({
    mode: 'checking',
    why: '',
  });
  const liveFailed = useCallback((e: unknown) => {
    setMode({ mode: 'recorded', why: 'the last live call failed (' + errMsg(e) + ')' });
  }, []);
  const liveWorked = useCallback(() => setMode({ mode: 'live', why: '' }), []);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<{ kind: AttachKind; file: File } | null>(
    null,
  );
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const stepRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const runCacheRef = useRef(new Map<string, unknown>());
  const elRefs = useRef(new Map<number, HTMLElement>());
  const photoResolveRef = useRef<((m: 'robot' | 'document' | 'part') => void) | null>(
    null,
  );
  const fileRefs = {
    photo: useRef<HTMLInputElement>(null),
    camera: useRef<HTMLInputElement>(null),
    doc: useRef<HTMLInputElement>(null),
    spec: useRef<HTMLInputElement>(null),
    scan: useRef<HTMLInputElement>(null),
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ---------------- thread primitives ---------------- */
  const push = useCallback((e: Omit<Entry, 'id'>): number => {
    const id = ++idRef.current;
    setEntries((prev) => [...prev, { ...e, id }]);
    return id;
  }, []);
  const pushUser = useCallback(
    (node: ReactNode) => push({ kind: 'user', node }),
    [push],
  );
  const pushNote = useCallback(
    (node: ReactNode) => push({ kind: 'note', node }),
    [push],
  );
  useEffect(()=>{
    for(const message of assistant.messages){
      if(message.who==='user')continue;
      const node=<div className="main-assistant-reply">
        {message.html&&<div dangerouslySetInnerHTML={{__html:message.html}}/>}
        {message.text&&<p style={{whiteSpace:'pre-wrap'}}>{message.text}</p>}
        {message.hits&&<div className="g-tabs">{message.hits.map((hit,i)=><button type="button" className="chip" key={i} onClick={()=>assistantRef.current.onHitClick(hit)}>{hit.label}</button>)}</div>}
      </div>;
      const entryId=assistantEntryIds.current.get(message.id);
      if(entryId===undefined)assistantEntryIds.current.set(message.id,pushNote(node));
      else setEntries(current=>current.map(e=>e.id===entryId?{...e,node}:e));
    }
  },[assistant.messages,pushNote]);
  const pushStage = useCallback(
    (
      badge: Badge,
      badgeNote: string | undefined,
      title: string,
      body: ReactNode,
    ): number => {
      stepRef.current += 1;
      dispatch(setStep(stepRef.current));
      return push({ kind: 'stage', badge, badgeNote, title, body });
    },
    [push, dispatch],
  );
  const setStageBody = useCallback((id: number, body: ReactNode) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, body } : e)),
    );
  }, []);
  const beginRun = useCallback(
    (tab: string) => {
      stepRef.current = 0;
      dispatch(setTab(tab));
    },
    [dispatch],
  );
  const sampleOffer = useCallback(
    (id: string, label: string) => {
      pushNote(
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => {
            if (!busyRef.current) void playSampleRef.current(id);
          }}
        >
          {label}
        </button>,
      );
    },
    [pushNote],
  );

  useEffect(() => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const el = elRefs.current.get(last.id);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [entries]);

  /* ---------------- shared stages ---------------- */
  const specStage = useCallback(
    (spec: RobotSpec, badge: Badge, badgeNote: string, title: string) =>
      pushStage(badge, badgeNote, title, (
        <>
          <div className="card" style={{ padding: '4px 20px' }}>
            <SpecTable spec={spec} />
          </div>
          <RawJSON obj={spec} label="Spec JSON" />
        </>
      )),
    [pushStage],
  );
  const checksStage = useCallback(
    (spec: RobotSpec): ValidateResult => {
      const res = forgeValidateSpec(spec);
      pushStage('local', 'computed in your browser just now', 'Checks', (
        <>
          <p className="intro">
            These are <strong>browser checks (subset of the full validator)</strong>:
            required fields and types, battery vs motor voltage, ground
            clearance vs wheel radius, wheel/body coherence. The full validator
            — and everything downstream — is the CLI:{' '}
            <code>robotforge validate</code>.
          </p>
          <Findings lines={res.lines} />
        </>
      ));
      return res;
    },
    [pushStage],
  );
  const gateNote = useCallback(() => {
    pushNote(
      <>
        <strong>Twin &amp; gate:</strong> the motion gate runs in Gazebo on the
        forge’s machine — it cannot run in your browser, and no verdict is
        simulated here. For a comparable recorded run, see{' '}
        <a href="../evidence/#run-r5-rover">
          the indoor rover’s gate report on the Evidence page
        </a>{' '}
        (recorded Oct 26, 2026), or run it yourself:
        <CodeBlock text="robotforge run-gate your-spec.json" />
      </>,
    );
  }, [pushNote]);
  const outputsStage = useCallback(
    (spec: RobotSpec, filename: string) => {
      pushStage('local', 'assembled in your browser', 'Take the outputs with you', (
        <ul className="outputs">
          <li>
            <strong>The spec itself</strong>
            <span>
              Download the JSON, then run the full pipeline on your own
              machine.
            </span>
            <p>
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => downloadJSON(spec, filename)}
              >
                Download {filename}
              </button>
            </p>
          </li>
          <li>
            <strong>Robot model (URDF)</strong>
            <span>For ROS and any simulator that reads URDF.</span>
            <CodeBlock text={'robotforge urdf ' + filename} />
          </li>
          <li>
            <strong>Take-apart parts kit</strong>
            <span>One OpenSCAD file per printable part, plus an assembly.</span>
            <CodeBlock text={'robotforge cad ' + filename} />
          </li>
          <li>
            <strong>Gate report</strong>
            <span>Needs Gazebo Sim on your machine.</span>
            <CodeBlock text={'robotforge run-gate ' + filename} />
          </li>
        </ul>
      ));
    },
    [pushStage],
  );
  const viewerStage = useCallback(
    (spec: RobotSpec) => {
      pushStage(
        'local',
        'drawn in your browser from the spec',
        'Take-apart viewer',
        <ForgeViewer spec={spec} />,
      );
    },
    [pushStage],
  );
  const specPipeline = useCallback(
    (spec: RobotSpec, filename: string): ValidateResult => {
      const res = checksStage(spec);
      if (!res.schemaErrors) viewerStage(spec);
      gateNote();
      outputsStage(spec, filename);
      return res;
    },
    [checksStage, viewerStage, gateNote, outputsStage],
  );

  /* ---------------- recorded sample replay ---------------- */
  const playSample = useCallback(
    async (id: string) => {
      const run = RUNS.find((r) => r.id === id);
      if (!run) return;
      beginRun(run.tab);
      pushUser(
        <>
          <span className="faint">Sample run:</span> {run.tab} — {run.meta}
        </>,
      );
      let data: unknown;
      if (runCacheRef.current.has(id)) {
        data = runCacheRef.current.get(id);
      } else {
        try {
          data = await run.load();
        } catch {
          pushNote(
            'The recorded files for this run couldn’t be loaded from this site, so there is nothing real to show. Nothing is simulated in their place.',
          );
          return;
        }
        runCacheRef.current.set(id, data);
      }
      const names = run.names || STEP_NAMES;
      const dateLabel = run.meta.split('·')[0].trim();
      run.steps(data as never).forEach((st, i) => {
        pushStage('recorded', dateLabel, names[i] + ' — ' + st.h, (
          <>
            <p className="intro">{st.intro}</p>
            {st.body}
          </>
        ));
      });
    },
    [beginRun, pushUser, pushNote, pushStage],
  );
  const playSampleRef = useRef(playSample);
  playSampleRef.current = playSample;

  /* ---------------- input flows: text + spec ---------------- */
  const runText = useCallback(
    async (value: string) => {
      beginRun('Words');
      pushUser(value);
      const h = await liveHealth();
      if (routeOn(h, 'describe')) {
        const cardId = pushStage(
          'live',
          'real call through the live endpoint',
          'Describe — drafting your spec',
          <WorkingBody what="Your description is with the model." />,
        );
        timersRef.current.set(cardId, performance.now());
        try {
          const body = await postJSON<{ spec: RobotSpec }>('/describe', {
            description: value,
          });
          liveWorked();
          const secs = Math.round(
            (performance.now() - (timersRef.current.get(cardId) || 0)) / 1000,
          );
          setStageBody(
            cardId,
            <>
              <p className="intro">
                The model drafted this spec in {secs} s. It fills a strict
                engineering schema; everything downstream is deterministic.
              </p>
              <div className="card" style={{ padding: '4px 20px' }}>
                <SpecTable spec={body.spec} />
              </div>
              <RawJSON obj={body.spec} label="Spec JSON as returned" />
            </>,
          );
          specPipeline(body.spec, 'described-robot.json');
        } catch (e) {
          liveFailed(e);
          setStageBody(
            cardId,
            <>
              <div className="callout bad">
                <span>
                  <strong>The live call failed:</strong> {errMsg(e)}
                </span>
              </div>
              <p className="intro">
                Nothing was recorded. The recorded Words run still shows the
                shape of a run:
              </p>
            </>,
          );
          sampleOffer('words', 'Play the recorded Words run');
        }
        return;
      }
      pushNote(
        <>
          <strong>Live describe didn’t run:</strong>{' '}
          <LiveOffReason h={h} route="describe" />. Your text wasn’t sent
          anywhere. Here is the recorded Words run instead — it replays its own
          recorded description, not yours:
        </>,
      );
      await playSample('words');
    },
    [beginRun, pushUser, pushStage, setStageBody, specPipeline, sampleOffer, pushNote, playSample],
  );

  const runSpec = useCallback(
    async (file: File) => {
      beginRun('Spec file');
      pushUser(<FileChip label="Spec file" file={file} />);
      let text: string;
      try {
        text = await file.text();
      } catch {
        pushNote('That file couldn’t be read in the browser. Nothing was uploaded.');
        return;
      }
      let spec: RobotSpec;
      try {
        spec = JSON.parse(text) as RobotSpec;
      } catch (e) {
        pushStage('local', 'parsed in your browser', 'Spec file', (
          <>
            <div className="callout bad">
              <span>
                <strong>Not valid JSON:</strong> {errMsg(e)}
              </span>
            </div>
            <p className="intro">
              The file was read only in your browser and sent nowhere.
            </p>
          </>
        ));
        return;
      }
      const res = forgeValidateSpec(spec);
      if (res.schemaErrors) {
        pushStage(
          'local',
          'parsed in your browser',
          'Spec file — ' +
            (spec && (spec as { name?: string }).name
              ? String((spec as { name?: string }).name)
              : 'unnamed'),
          <>
            <p className="intro">
              Parsed in your browser. It doesn’t carry the fields a RobotForge
              spec needs, so there is nothing honest to draw yet:
            </p>
            <Findings lines={res.lines} />
            <RawJSON obj={spec} label="What was in the file" />
          </>,
        );
        return;
      }
      specStage(spec, 'local', 'parsed in your browser', 'Spec — ' + spec.name);
      specPipeline(spec, 'uploaded-spec.json');
    },
    [beginRun, pushUser, pushNote, pushStage, specStage, specPipeline],
  );

  /* ---------------- input flows: photo + document ---------------- */
  const choosePhotoMode = useCallback((): Promise<'robot' | 'document' | 'part'> => {
    return new Promise((resolve) => {
      photoResolveRef.current = resolve;
      pushNote(
        <PhotoModeAsk
          onPick={(m) => {
            const r = photoResolveRef.current;
            photoResolveRef.current = null;
            if (r) r(m);
          }}
        />,
      );
    });
  }, [pushNote]);

  const renderDocDraft = useCallback(
    (cardId: number, draft: DocDraft, secs: number) => {
      const spec = (draft.spec || {}) as PartialSpec;
      const full = spec as RobotSpec;
      const complete = !forgeValidateSpec(full).schemaErrors;
      setStageBody(
        cardId,
        <>
          <span className="docd">
            Document draft — values transcribed from the document; verify
            against the source
          </span>
          <p className="intro" style={{ marginTop: 10 }}>
            Transcribed in {secs} s. Identity, as printed:{' '}
            <strong>{draft.identity_guess || 'unknown document'}</strong>.
          </p>
          {draft.values && draft.values.length ? (
            <>
              <div className="eyebrow">
                Transcribed values (as printed → spec field)
              </div>
              <ul className="items rows">
                {draft.values.map((v, i) => (
                  <li key={i}>
                    <span className="title">
                      {v.label}: <strong>{v.printed}</strong>
                    </span>
                    <span className="faint">→ {v.field}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="intro">The model reported no transcribed values.</p>
          )}
          {draft.dropped && draft.dropped.length ? (
            <div className="callout warn">
              <span>
                <strong>Dropped as unbacked:</strong> {draft.dropped.join(', ')}{' '}
                — numbers the model put in the spec with no printed value behind
                them were removed.
              </span>
            </div>
          ) : null}
          <div className="card" style={{ padding: '4px 20px' }}>
            {complete ? (
              <SpecTable spec={full} />
            ) : (
              <DocSpecTable spec={spec} />
            )}
          </div>
          <RawJSON obj={spec} label="Draft spec JSON as transcribed" />
        </>,
      );
      if (complete) {
        specPipeline(full, 'document-draft.json');
        return;
      }
      const missing = [
        'name',
        'drivetrain',
        'length_m',
        'width_m',
        'height_m',
        'mass_kg',
        'ground_clearance_m',
        'wheel',
        'motor',
        'battery',
      ].filter((k) => !(k in spec));
      pushNote(
        <>
          <strong>Partial draft:</strong> the document didn’t print everything
          a complete spec needs (missing: {missing.join(', ')}). The absent
          fields were left absent — document mode never fills a value in — so
          the checks and viewer wait until the draft is complete.
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => downloadJSON(spec, 'document-draft-partial.json')}
          >
            Download the partial draft JSON
          </button>
        </>,
      );
    },
    [setStageBody, specPipeline, pushNote],
  );

  const runPhotoDocument = useCallback(
    async (noteText: string, dataUrl: string) => {
      const h = await liveHealth();
      if (!routeOn(h, 'photo')) {
        pushNote(
          <>
            <strong>Your document was not read:</strong> document transcription
            needs the live endpoint, and <LiveOffReason h={h} route="photo" />.
            The image above exists only in this thread, in your browser — it
            was sent nowhere. The recorded document run shows what a
            transcription produces:
          </>,
        );
        sampleOffer('document', 'Play the recorded document run');
        return;
      }
      const cardId = pushStage(
        'live',
        'real call through the live endpoint',
        'Document draft — transcribing the printed values',
        <WorkingBody what="Your document photo (downscaled in your browser first) is with the vision model, which transcribes printed values only." />,
      );
      timersRef.current.set(cardId, performance.now());
      try {
        const small = await downscale(dataUrl, 1024);
        const body = await postJSON<{ draft: DocDraft }>('/photo', {
          image_data_url: small,
          mode: 'document',
          note: noteText || undefined,
        });
        liveWorked();
        const secs = Math.round(
          (performance.now() - (timersRef.current.get(cardId) || 0)) / 1000,
        );
        renderDocDraft(cardId, body.draft, secs);
      } catch (e) {
          liveFailed(e);
        setStageBody(
          cardId,
          <>
            <div className="callout bad">
              <span>
                <strong>The live document call failed:</strong> {errMsg(e)}
              </span>
            </div>
            <p className="intro">
              Your image was not stored anywhere. The recorded document run
              still shows the shape of a transcription:
            </p>
          </>,
        );
        sampleOffer('document', 'Play the recorded document run');
      }
    },
    [pushNote, sampleOffer, pushStage, setStageBody, renderDocDraft],
  );

  const runPhoto = useCallback(
    async (file: File, noteText: string) => {
      beginRun('Photo');
      let dataUrl: string;
      try {
        dataUrl = await readAsDataURL(file);
      } catch {
        pushNote('That photo couldn’t be read in the browser. Nothing was uploaded.');
        return;
      }
      const url = URL.createObjectURL(file);
      pushUser(
        <>
          <figure className="photo-in">
            <img src={url} alt="Your attached photo" />
          </figure>
          {noteText ? <p>{noteText}</p> : null}
        </>,
      );
      const mode = await choosePhotoMode();
      if(mode==='part'){pushNote(<PartPhotoIntake file={file}/>);return;}
      if (mode === 'document') {
        await runPhotoDocument(noteText, dataUrl);
        return;
      }
      const h = await liveHealth();
      if (!routeOn(h, 'photo')) {
        pushNote(
          <>
            <strong>Your photo was not processed:</strong> photo drafting needs
            the live endpoint, and <LiveOffReason h={h} route="photo" />. The
            photo above exists only in this thread, in your browser — it was
            sent nowhere. The recorded photo run shows what a photo draft looks
            like (the TurtleBot example, a SAMPLE):
          </>,
        );
        sampleOffer('photo', 'Play the recorded photo run (SAMPLE)');
        return;
      }
      const cardId = pushStage(
        'live',
        'real call through the live endpoint',
        'Photo draft — the vision model reads your photo',
        <WorkingBody what="Your photo (downscaled in your browser first) is with the vision model." />,
      );
      timersRef.current.set(cardId, performance.now());
      try {
        const small = await downscale(dataUrl, 1024);
        const body = await postJSON<{ draft: PhotoDraft }>('/photo', {
          image_data_url: small,
          note: noteText || undefined,
        });
        liveWorked();
        const secs = Math.round(
          (performance.now() - (timersRef.current.get(cardId) || 0)) / 1000,
        );
        const draft = body.draft;
        setStageBody(
          cardId,
          <>
            <span className="est">
              Estimated, not measured — every dimension in a photo draft is an
              estimate
            </span>
            <p className="intro" style={{ marginTop: 10 }}>
              Drafted in {secs} s. Identity guess:{' '}
              <strong>{draft.identity_guess}</strong>.
            </p>
            {draft.visible_parts && draft.visible_parts.length ? (
              <>
                <div className="eyebrow">Parts the model could see</div>
                <ul className="items rows">
                  {draft.visible_parts.map((p, i) => (
                    <li key={i}>
                      <strong>{p.kind}</strong> ×{p.count}
                      {p.position ? ' — ' + p.position : ''}
                      {p.notes ? (
                        <span className="faint"> {p.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="card" style={{ padding: '4px 20px' }}>
              <SpecTable spec={draft.spec} />
            </div>
            <GroupingCard draft={draft} />
            <RawJSON obj={draft.spec} label="Draft spec JSON" />
          </>,
        );
        specPipeline(draft.spec, 'photo-draft.json');
      } catch (e) {
          liveFailed(e);
        setStageBody(
          cardId,
          <>
            <div className="callout bad">
              <span>
                <strong>The live photo call failed:</strong> {errMsg(e)}
              </span>
            </div>
            <p className="intro">
              Your photo was not stored anywhere. The recorded photo run still
              shows the shape of a draft:
            </p>
          </>,
        );
        sampleOffer('photo', 'Play the recorded photo run (SAMPLE)');
      }
    },
    [beginRun, pushUser, pushNote, choosePhotoMode, runPhotoDocument, pushStage, setStageBody, specPipeline, sampleOffer],
  );

  /* ---------------- input flow: parts list ---------------- */
  const runDoc = useCallback(
    async (file: File, noteText: string) => {
      beginRun('Parts list');
      let text: string;
      try {
        text = await file.text();
      } catch {
        pushNote('That file couldn’t be read in the browser. Nothing was uploaded.');
        return;
      }
      pushUser(
        <>
          <FileChip label="Parts list" file={file} />
          <pre className="paste">{text.slice(0, 1500)}</pre>
          {noteText ? <p>{noteText}</p> : null}
        </>,
      );
      const h = await liveHealth();
      if (!routeOn(h, 'list')) {
        pushNote(
          <>
            <strong>Your list was not imported:</strong> list import runs on
            the live model, and <LiveOffReason h={h} route="list" />. Your list
            stayed in your browser. The recorded list run shows what an import
            produces:
          </>,
        );
        sampleOffer('list', 'Play the recorded parts-list run');
        return;
      }
      const cardId = pushStage(
        'live',
        'real call through the live endpoint',
        'Parts list — importing with the live model',
        <WorkingBody what="Your list is with the model, which matches its lines against the site’s parts catalogue." />,
      );
      timersRef.current.set(cardId, performance.now());
      try {
        const body = await postJSON<{
          import: ListImportResult;
          draft_note?: string;
        }>('/list', { text });
        liveWorked();
        const secs = Math.round(
          (performance.now() - (timersRef.current.get(cardId) || 0)) / 1000,
        );
        const imp = body.import;
        setStageBody(
          cardId,
          <>
            <p className="intro">
              Imported in {secs} s. <strong>Model-generated import</strong> —
              the deterministic importer remains the CLI’s (
              <code>robotforge import-list</code>); a line with no catalogue
              match says so rather than being dropped.
            </p>
            <ul className="items">
              {imp.items.map((it, i) => (
                <li key={i}>
                  <span
                    className={
                      'slotname' + (it.matched_part_id ? '' : ' none')
                    }
                  >
                    {it.matched_part_id || 'no catalogue match'}
                  </span>
                  <span className="qty">×{it.qty}</span>
                  <span className="title">{it.title}</span>
                </li>
              ))}
            </ul>
            {imp.missing.length ? (
              <div className="card">
                <div className="eyebrow">Still missing</div>
                <ul className="outputs" style={{ marginTop: 12 }}>
                  {imp.missing.map((m, i) => (
                    <li key={i}>
                      <strong>{m}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {imp.wiring.length ? (
              <div className="card">
                <div className="eyebrow">Suggested wiring</div>
                <ul className="wires" style={{ marginTop: 12 }}>
                  {imp.wiring.map((c, i) => (
                    <li key={i}>
                      <b>{c.from}</b>
                      <span className="via">→ {c.via} →</span>
                      <b>{c.to}</b>
                      <p>{c.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {body.draft_note ? (
              <div className="callout warn">
                <span>{body.draft_note}</span>
              </div>
            ) : null}
          </>,
        );
        if (imp.draft_spec) {
          pushNote(
            'The import also drafted a spec from those parts — it goes through the same browser checks and viewer as an uploaded spec:',
          );
          specStage(
            imp.draft_spec,
            'live',
            'drafted by the live model',
            'Draft spec — ' + imp.draft_spec.name,
          );
          specPipeline(imp.draft_spec, 'list-draft.json');
        }
      } catch (e) {
          liveFailed(e);
        setStageBody(
          cardId,
          <>
            <div className="callout bad">
              <span>
                <strong>The live import failed:</strong> {errMsg(e)}
              </span>
            </div>
            <p className="intro">
              The recorded list run still shows what an import produces:
            </p>
          </>,
        );
        sampleOffer('list', 'Play the recorded parts-list run');
      }
    },
    [beginRun, pushUser, pushNote, pushStage, setStageBody, sampleOffer, specStage, specPipeline],
  );

  /* ---------------- input flow: scan (.ply), entirely LOCAL ------- */
  const seedFromScan = useCallback(
    (measure: Extract<Measure, { ok: true }>, fileName: string) => {
      const e = measure.extentsM;
      const r4 = (v: number) => Math.round(v * 10000) / 10000;
      const spec: PartialSpec = {
        name: 'scan-draft',
        description:
          'Seeded from a point-cloud scan (' +
          fileName +
          '): geometry MEASURED from the scan bounding box, file axes as stored (x → length, y → width, z → height). Everything else is still to fill in — a scan cannot measure mass, motors or voltage.',
        length_m: r4(e[0]),
        width_m: r4(e[1]),
        height_m: r4(e[2]),
      };
      pushStage('local', 'seeded in your browser from the scan', 'Draft spec — seeded from the scan', (
        <>
          <p className="intro">
            Geometry only, prefilled from the measurement above (provenance:
            scan). Still needed before the browser checks can run:{' '}
            <strong>
              drivetrain, mass_kg, ground_clearance_m, wheel, motor, battery
            </strong>
            . This partial spec has <strong>not</strong> been run through the
            checks as if it were complete.
          </p>
          <div className="card" style={{ padding: '4px 20px' }}>
            <DocSpecTable spec={spec} />
          </div>
          <RawJSON obj={spec} label="Seeded draft JSON" />
          <p>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => downloadJSON(spec, 'scan-draft.json')}
            >
              Download the seeded draft
            </button>
          </p>
        </>
      ));
    },
    [pushStage],
  );

  const runScan = useCallback(
    async (file: File) => {
      beginRun('Scan (.ply)');
      pushUser(<FileChip label="Scan (.ply)" file={file} />);
      pushNote(SCAN_GUIDANCE);
      let buf: ArrayBuffer;
      try {
        buf = await file.arrayBuffer();
      } catch {
        pushNote('That file couldn’t be read in the browser. Nothing was uploaded.');
        return;
      }
      /* The vanilla flow waits for the lazily-loaded scan module;
       * here the parser is bundled with this component, so it is
       * always available. */
      let parsed: ParsedPly;
      let measure: Measure;
      try {
        parsed = parsePly(buf);
        measure = measureCloud(parsed.positions);
      } catch (e) {
        pushStage('local', 'parsed in your browser', 'Scan — not readable', (
          <>
            <div className="callout bad">
              <span>
                <strong>{errMsg(e)}</strong>
              </span>
            </div>
            <p className="intro">
              The file was read only in your browser and sent nowhere.
            </p>
          </>
        ));
        return;
      }
      if (!measure.ok) {
        const raw = measure.rawExtents || [0, 0, 0];
        pushStage('local', 'measured in your browser', 'Scan — implausible size', (
          <p className="intro">
            <strong>
              {(measure.count || 0).toLocaleString('en-US')} points
            </strong>{' '}
            were read, but no size is reported: {measure.reason}. The raw
            extents are{' '}
            {raw
              .map((v) => String(Math.round(v * 1000) / 1000))
              .join(' × ')}{' '}
            in the file’s own units — shown as-is, not rescaled into a
            plausible-looking answer.
          </p>
        ));
        return;
      }
      const okMeasure = measure;
      const okParsed = parsed;
      pushStage('local', 'measured in your browser just now', 'Scan — MEASURED (scan)', (
        <ScanStageBody
          parsed={okParsed}
          measure={okMeasure}
          onSeed={() => seedFromScan(okMeasure, file.name)}
        />
      ));
    },
    [beginRun, pushUser, pushNote, pushStage, seedFromScan],
  );

  /* Sample scan: fetch the bundled SAMPLE .ply and run it through
   * runScan — the exact parse / measure / seed path a visitor's own
   * file takes (same FileChip, same guidance note, same stages). The
   * cloud is synthetic (generated by tools/make_sample_scan.py), and
   * it is labelled SAMPLE here and in the file's own name so nobody
   * mistakes it for a real capture. */
  const runSampleScan = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await fetch(assetPath('sample-scan.ply'));
      if (!r.ok) throw new Error('sample scan fetch -> ' + r.status);
      const blob = await r.blob();
      const file = new File([blob], 'sample-scan.ply', {
        type: 'application/octet-stream',
      });
      await runScan(file);
    } catch {
      pushNote(
        'The sample scan couldn’t be loaded in this browser. Attaching your own .ply still works.',
      );
    } finally {
      busyRef.current = false;
    }
  }, [pushNote, runScan]);

  /* ---------------- composer + init ---------------- */
  const attachLabel = (kind: AttachKind) =>
    kind === 'photo'
      ? 'Photo'
      : kind === 'doc'
        ? 'Parts list'
        : kind === 'scan'
          ? 'Scan (.ply)'
          : 'Spec file';

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busyRef.current) return;
    const value = text.trim();
    const a = attach;
    if (!a && !value) return;
    busyRef.current = true;
    try {
      if (a && a.kind === 'spec') await runSpec(a.file);
      else if (a && a.kind === 'photo') await runPhoto(a.file, value);
      else if (a && a.kind === 'doc') await runDoc(a.file, value);
      else if (a && a.kind === 'scan') await runScan(a.file);
      else if(inputMode==='design')await runText(value);
      else{pushUser(<p>{value}</p>);assistant.ask(value);}
    } finally {
      busyRef.current = false;
      setAttach(null);
      setText('');
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    pushNote(
      <p>
        <strong>One workspace for your robot.</strong> Ask questions, manage inventory, or edit a saved robot here. Switch to Design a robot to generate a new spec. Part photos save to inventory. Photo identification and parts-list imports need
        the live endpoint; spec files, scans and the recorded samples below
        always work.
      </p>,
    );
    (async () => {
      if (!liveBase) {
        setMode({ mode: 'recorded', why: offReason(null, 'describe') });
        setStatus(
          'Nothing you attach leaves your browser. Spec uploads are checked and drawn right here, and scans are measured right here.',
        );
        return;
      }
      const h: LiveHealth | null = await liveHealth();
      if (!h || !h.ok || h.mode === 'off' || (h.budget && h.budget.exhausted)) {
        setMode({ mode: 'recorded', why: offReason(h, 'describe') });
        setStatus(
          'Local spec checks and the recorded samples still work, and a live step will say plainly if it can’t run.',
        );
        return;
      }
      const bits: string[] = [];
      bits.push('describe ' + (routeOn(h, 'describe') ? 'live' : 'off'));
      bits.push('parts list ' + (routeOn(h, 'list') ? 'live' : 'off'));
      bits.push(
        'photo + document ' +
          (routeOn(h, 'photo') ? 'live' : 'not configured'),
      );
      if (routeOn(h, 'describe') || routeOn(h, 'list') || routeOn(h, 'photo')) {
        setMode({ mode: 'live', why: '' });
      } else {
        setMode({ mode: 'recorded', why: offReason(h, 'describe') });
      }
      setStatus(
        'Routes: ' +
          bits.join(' · ') +
          '. Spec checks always run in your browser, and the recorded samples below always work.',
      );
    })();
    /* Old step-walk deep links (#words, #photo, #list, #document)
     * play the matching recorded sample. */
    const hm = /^#(words|photo|list|document)/.exec(window.location.hash);
    if (hm) void playSampleRef.current(hm[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ModeBanner mode={mode.mode} reason={mode.why}>
        {mode.mode === 'checking' ? null : status}
      </ModeBanner>
      <div className="forge-thread" aria-live="polite">
        {entries.map((e) => {
          if (e.kind === 'stage') {
            return (
              <article
                className="fstage"
                key={e.id}
                ref={(el) => {
                  if (el) elRefs.current.set(e.id, el);
                  else elRefs.current.delete(e.id);
                }}
              >
                <header className="fstage-head">
                  <span className={'fbadge ' + e.badge}>
                    {BADGE_LABEL[e.badge as Badge]}
                  </span>
                  {e.badgeNote ? (
                    <span className="fbadge-note">{e.badgeNote}</span>
                  ) : null}
                  <h3>{e.title}</h3>
                </header>
                <div className="fstage-body">{e.body}</div>
              </article>
            );
          }
          return (
            <div
              className={'fmsg ' + e.kind}
              key={e.id}
              ref={(el) => {
                if (el) elRefs.current.set(e.id, el);
                else elRefs.current.delete(e.id);
              }}
            >
              {e.node}
            </div>
          );
        })}
      </div>
      <div className="forge-samples">
        <span className="faint">Recorded sample runs:</span>{' '}
        <button
          className="btn btn-sm"
          type="button"
          data-sample="words"
          onClick={() => {
            if (!busyRef.current) void playSample('words');
          }}
        >
          Words — indoor rover
        </button>{' '}
        <button
          className="btn btn-sm"
          type="button"
          data-sample="photo"
          onClick={() => {
            if (!busyRef.current) void playSample('photo');
          }}
        >
          Photo — TurtleBot (SAMPLE)
        </button>{' '}
        <button
          className="btn btn-sm"
          type="button"
          data-sample="list"
          onClick={() => {
            if (!busyRef.current) void playSample('list');
          }}
        >
          Parts list — quadcopter
        </button>{' '}
        <button
          className="btn btn-sm"
          type="button"
          data-sample="document"
          onClick={() => {
            if (!busyRef.current) void playSample('document');
          }}
        >
          Document — TurtleBot3 spec sheet
        </button>
      </div>
      {assistant.actions}
      <div className="main-chat-suggestions g-tabs" aria-label="Workspace suggestions">{['List my robots','List my inventory','Operations'].map(q=><button className="chip" type="button" key={q} onClick={()=>{pushUser(<p>{q}</p>);assistant.ask(q);}}>{q}</button>)}</div>
      <form className="forge-composer main-chat-composer" onSubmit={onSubmit}>
        <div className="g-tabs" aria-label="Message mode"><button type="button" className="chip" aria-pressed={inputMode==='chat'} onClick={()=>setInputMode('chat')}>Ask & manage</button><button type="button" className="chip" aria-pressed={inputMode==='design'} onClick={()=>setInputMode('design')}>Design a robot</button></div>
        <div className="attach-row" hidden={!attach}>
          <span className="attach-chip">
            {attach ? (
              <span>
                {attachLabel(attach.kind)}: {attach.file.name}
              </span>
            ) : null}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => setAttach(null)}
          >
            Remove
          </button>
        </div>
        <label
          className="faint"
          htmlFor="forge-input"
          style={{ fontSize: 'var(--fs-xs)' }}
        >
          Message your robot workspace
        </label>
        <textarea
          id="forge-input"
          ref={inputRef}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          placeholder="Describe a robot in plain words… or attach a photo, a parts list, a spec file, or a .ply scan below."
        />
        <div className="composer-row">
          <div className="attach-btns">
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Attach:
            </span>{' '}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => fileRefs.photo.current?.click()}
            >
              Photo
            </button>{' '}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => fileRefs.camera.current?.click()}
            >
              Take photo
            </button>{' '}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => fileRefs.doc.current?.click()}
            >
              Parts list
            </button>{' '}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => fileRefs.spec.current?.click()}
            >
              Spec JSON
            </button>{' '}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => fileRefs.scan.current?.click()}
            >
              Scan (.ply)
            </button>{' '}
            <button
              className="btn btn-sm"
              type="button"
              data-sample="scan"
              onClick={() => void runSampleScan()}
            >
              Try a sample scan (SAMPLE)
            </button>
          </div>
          <button className="btn btn-primary" type="submit">
            Send
          </button>
        </div>
        <p className="faint composer-note">
          Files stay in your browser unless you run a live step. In local and
          recorded mode nothing is uploaded, ever.
        </p>
        <input
          type="file"
          ref={fileRefs.photo}
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) setAttach({ kind: 'photo', file: f });
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={fileRefs.camera}
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) setAttach({ kind: 'photo', file: f });
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={fileRefs.doc}
          accept=".txt,.md,.csv,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) setAttach({ kind: 'doc', file: f });
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={fileRefs.spec}
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) setAttach({ kind: 'spec', file: f });
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={fileRefs.scan}
          accept=".ply"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) setAttach({ kind: 'scan', file: f });
            e.target.value = '';
          }}
        />
      </form>
    </>
  );
}
