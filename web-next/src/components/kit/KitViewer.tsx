'use client';
/* The standalone Parts Kit page — the React equivalent of kit.html:
 * header, the 3D stage (KitScene), the explode/spin/CAD/real/download
 * bar, part detail + live OpenSCAD panels, the 2D fallback stack,
 * and the full catalogue generated from the current parts data.
 * kit.html is a standalone page with its own stylesheet; here those
 * rules are carried in a <style> block scoped under .kitpage so they
 * cannot leak into the app shell (or vice versa).
 *
 * The parts catalogue and the spec-driven take-apart viewer used to
 * be repeated here; they now live once each, in PartsCatalogue (below
 * this viewer on /kit/) and on the robot pages. */
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { parts as libParts } from '../forge/data';
import type { CatalogPart } from '../forge/data';
import PartsPalette from './PartsPalette';
import WiringPanel from './WiringPanel';
import type { PlacedProp, WiringSceneView } from './KitScene';
import { parts as catalogParts, simReadyProps } from '@/lib/data';
import { useBuildList } from '@/lib/buildList';
import { useBuildWiring } from '@/lib/wiringStore';
import {
  addConnection,
  deviceBoxes,
  portAnchors,
  portsByEntry,
  removeConnection,
  resolveConnections,
} from '@/lib/buildWiring';
import type { Part } from '@/lib/types';
import {
  addToBuildList,
  buildPaletteItems,
  removeFromBuildList,
  setBuildQty,
  type PaletteItem,
} from '@/lib/palette';
import { uid } from '@/lib/store';
import {
  GENERATED_KEYS,
  PD_META,
  SCAD_MODULES,
  TIER_LABEL,
  assemblyScad,
  classLabel,
  fmtSpecs,
  partScad,
} from './burger';
import type { GeneratedKey, SimReadyManifest, SpecimenDoc, SpecimenPart } from './burger';

/* Code-split (mobile UX Phase 2, 2026-10-31): the Three.js scene is
 * its own chunk, downloaded only when the scene actually mounts —
 * on phones it doesn't mount at all until the reader taps Load. */
const KitScene = dynamic(() => import('./KitScene'), {
  ssr: false,
  loading: () => (
    <div className="kit-load">
      <p>Loading the 3D kit…</p>
    </div>
  ),
});

const KIT_CSS = `
.kitpage{background:#14161a;color:#e8eaed;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;line-height:1.55}
.kitpage .wrap{max-width:1060px;margin:0 auto;padding:0 22px 80px}
.kitpage header{padding:34px 0 6px}
.kitpage .kicker{letter-spacing:.22em;font-size:12px;color:#f59e0b;text-transform:uppercase;font-weight:700}
.kitpage h1{font-size:36px;margin:10px 0}
.kitpage .sub{color:#9aa3ad;max-width:760px}
.kitpage a{color:#f59e0b} .kitpage .dim{color:#9aa3ad}
.kitpage #stage{position:relative;background:radial-gradient(1200px 500px at 50% 0%,#1e222b,#14161a);
  border:1px solid #2c313a;border-radius:16px;overflow:hidden;margin:22px 0 8px}
.kitpage #view3d{display:block;width:100%;height:520px;cursor:grab}
.kitpage #view3d:active{cursor:grabbing}
.kitpage .hud{position:absolute;top:12px;left:14px;font-size:12px;color:#9aa3ad;pointer-events:none}
.kitpage .hud b{color:#e8eaed}
.kitpage .bar3d{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:10px 0 18px}
.kitpage .bar3d label{font-size:13.5px;color:#9aa3ad}
.kitpage input[type=range]{flex:1;min-width:160px;accent-color:#f59e0b}
.kitpage button{background:#21252e;color:#e8eaed;border:1px solid #2c313a;
  border-radius:9px;padding:8px 14px;cursor:pointer;font-size:14px;font-weight:600}
.kitpage button.on{background:#f59e0b;color:#14161a;border-color:#f59e0b}
.kitpage button.primary{background:#f59e0b;color:#14161a;border-color:#f59e0b}
.kitpage button:disabled{opacity:.45;cursor:default}
.kitpage .cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}
@media(max-width:820px){.kitpage .cols{grid-template-columns:1fr}}
@media(max-width:720px){.kitpage button{min-height:40px}}
@media(max-width:560px){.kitpage #view3d{height:340px}.kitpage .wrap{padding:0 14px 64px}}
.kitpage .box{background:#1b1e24;border:1px solid #2c313a;border-radius:14px;padding:18px 20px}
.kitpage .box table,.kitpage .cat{border-collapse:collapse;font-size:13.5px;width:100%}
.kitpage .box td,.kitpage .cat td{border-bottom:1px solid #2c313a;padding:5px 10px 5px 0;vertical-align:top}
.kitpage .box td:first-child{color:#9aa3ad;white-space:nowrap}
.kitpage pre{background:#0e1013;border:1px solid #2c313a;border-radius:10px;padding:12px;
  overflow:auto;font-size:11.5px;line-height:1.5;max-height:300px}
.kitpage .kit-load{display:grid;place-items:center;align-content:center;gap:10px;
  height:520px;text-align:center;padding:24px;color:#9aa3ad}
.kitpage .kit-load p{max-width:420px;margin:0}
@media(max-width:560px){.kitpage .kit-load{height:340px}}
.kitpage .cls{margin:26px 0 6px;text-transform:capitalize}
.kitpage .layer{width:78%;margin:3px auto;text-align:center;background:#21252e;
  border:1px solid #2c313a;border-radius:10px;padding:9px;cursor:pointer;font-weight:600}
.kitpage .palette{position:absolute;top:0;right:0;bottom:0;width:min(470px,94%);z-index:6;
  background:rgba(17,19,23,.97);border-left:1px solid #2c313a;overflow-y:auto;padding:16px 16px 24px;text-align:left}
.kitpage .palette-head{display:flex;justify-content:space-between;align-items:center;font-size:17px}
.kitpage .palette-note{font-size:12.5px;color:#9aa3ad;line-height:1.5}
.kitpage .palette-search{width:100%;background:#0e1013;border:1px solid #2c313a;border-radius:9px;
  color:#e8eaed;padding:8px 10px;font-size:13.5px;margin:6px 0 2px}
.kitpage .palette-sec{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#f59e0b;margin:16px 0 8px}
.kitpage .palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}
.kitpage .pcard{background:#1b1e24;border:1px solid #2c313a;border-radius:12px;padding:9px;cursor:grab}
.kitpage .pcard:active{cursor:grabbing}
.kitpage .pcard h4{font-size:13px;margin:7px 0 3px;line-height:1.3}
.kitpage .pcard-spec{font-size:11.5px;color:#9aa3ad;margin:0 0 5px;line-height:1.4}
.kitpage .pcard-cap{font-size:10.5px;color:#9aa3ad;margin-top:4px}
.kitpage .pcard-badges{margin:0 0 4px}
.kitpage .pbadge{font-size:10.5px;font-weight:700;border:1px solid #2c313a;border-radius:20px;padding:1px 7px;color:#9aa3ad}
.kitpage .pbadge.real{color:#7fd08c;border-color:#24502c}
.kitpage .pbadge.sim_only{color:#c9a2ff;border-color:#4b3670}
.kitpage .pcard-src{font-size:11px;color:#9aa3ad;margin:0 0 7px}
.kitpage .pcard button{width:100%;font-size:12.5px;padding:6px 8px}
.kitpage .palette-thumb{aspect-ratio:10/7;background:#0e1013;border:1px solid #23262e;border-radius:9px;
  display:grid;place-items:center;overflow:hidden}
.kitpage .palette-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.kitpage .palette-thumb-note{font-size:11px;color:#9aa3ad;text-align:center;padding:8px;line-height:1.45}
.kitpage .palette-noimg{border-style:dashed}
.kitpage .buildlist{margin-top:18px;border-top:1px solid #2c313a;padding-top:4px}
.kitpage .buildrow{display:flex;gap:8px;align-items:center;background:#1b1e24;border:1px solid #2c313a;
  border-radius:10px;padding:7px 9px;margin-top:7px;font-size:13px}
.kitpage .buildrow-name{flex:1;line-height:1.35}
.kitpage .buildrow-qty{display:flex;gap:6px;align-items:center;font-weight:600}
.kitpage .buildrow-qty button,.kitpage .buildrow>button{padding:3px 9px;font-size:12.5px}
.kitpage .buildlist-foot{margin-top:10px;font-size:13px}
.kitpage .palette-bomlink{font-weight:700}
.kitpage .wire-badge{font-size:13px;color:#c8cdd4;line-height:1.55;max-width:760px}
.kitpage .wire-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px;margin:8px 0}
.kitpage .wire-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}
.kitpage .wire-note{background:#232830;border:1px solid #2c313a;border-radius:9px;padding:8px 11px;font-size:13.5px}
.kitpage .wire-device{font-size:13.5px;margin:5px 0;line-height:1.45}
.kitpage .wire-table{border-collapse:collapse;font-size:13.5px;width:100%;margin-top:12px}
.kitpage .wire-table th{text-align:left;color:#9aa3ad;font-weight:600;padding:5px 10px 5px 0;border-bottom:1px solid #2c313a}
.kitpage .wire-table td{border-bottom:1px solid #2c313a;padding:5px 10px 5px 0;vertical-align:top}
.kitpage .wire-table tr.sel td{background:#232830}
.kitpage .wire-table tbody tr{cursor:pointer}
.kitpage .wire-dot{display:inline-block;width:9px;height:9px;border-radius:50%}
.kitpage .wire-checks{margin-top:14px;border-top:1px solid #2c313a;padding-top:6px}
.kitpage .wire-checks h4{margin:8px 0 6px;font-size:14px}
.kitpage .wire-issue{font-size:13.5px;line-height:1.5}
`;

function downloadText(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function partByName(name: string): CatalogPart | undefined {
  return libParts.find((p) => p.name === name);
}

type Detail =
  | { kind: 'default' }
  | { kind: 'generated'; key: GeneratedKey; withDownload: boolean }
  | { kind: 'specimenList' }
  | { kind: 'specimenPart'; id: string }
  | { kind: 'specimenError' };

export default function KitViewer() {
  const [slider, setSlider] = useState(0);
  const [explodeCur, setExplodeCur] = useState(0);
  const [spin, setSpin] = useState(false);
  const [cad, setCad] = useState(false);
  const [real, setReal] = useState(false);
  const [selectedKey, setSelectedKey] = useState<GeneratedKey | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: 'default' });
  const [specimenDoc, setSpecimenDoc] = useState<SpecimenDoc | null>(null);
  const [selectedSpecimen, setSelectedSpecimen] = useState<string | null>(null);
  const [propsOn, setPropsOn] = useState(false);
  const [propsDoc, setPropsDoc] = useState<SimReadyManifest | null>(null);
  const [propsError, setPropsError] = useState(false);
  const [fallback, setFallback] = useState(false);
  const readyRef = useRef(false);

  /* The Parts palette + the shared build list (lib/buildList.ts —
   * the same list the chat adds to and the BOM wizard starts
   * from). Bench-prop entries with a position are the scene's
   * placed props; catalogue entries live in the list only. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const [buildEntries, saveBuild] = useBuildList();
  const paletteItems = useMemo(
    () => buildPaletteItems(catalogParts, simReadyProps),
    [],
  );
  const paletteByKey = useMemo(
    () => new Map(paletteItems.map((i) => [i.key, i])),
    [paletteItems],
  );
  const placedProps: PlacedProp[] = useMemo(
    () =>
      buildEntries.flatMap((e) => {
        if (e.kind !== 'bench-prop' || !e.pos) return [];
        const prop = simReadyProps.find((p) => p.id === e.refId);
        return prop
          ? [
              {
                uid: e.uid,
                file: prop.file,
                pos: e.pos,
                yaw: prop.rotation_y_rad,
              },
            ]
          : [];
      }),
    [buildEntries],
  );
  const addPaletteItem = (item: PaletteItem, explicitPos?: [number, number]) => {
    saveBuild(
      addToBuildList(buildEntries, item, 1, 'palette', () => uid('build'), explicitPos),
    );
  };

  /* Wiring (lib/buildWiring.ts): the build list's schematic
   * connections, stored under rf.wiring.v1 (lib/wiringStore.ts —
   * demo visitors get the ".demo" twin). The scene view-model is
   * computed from the RESOLVED connections, so a cable whose part
   * leaves the build list retires everywhere at once. Ports come
   * only from recorded catalogue data; devices without ports get
   * no block and the panel says why. */
  const [wiringOn, setWiringOn] = useState(false);
  const [pendingPort, setPendingPort] = useState<string | null>(null);
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  const [wireNote, setWireNote] = useState<string | null>(null);
  const [buildWiring, saveWiring] = useBuildWiring();
  const partsById = useMemo(
    () => new Map<string, Part>(catalogParts.map((p) => [p.id, p])),
    [],
  );
  const resolvedWiring = useMemo(
    () => ({
      connections: resolveConnections(buildEntries, buildWiring, partsById),
    }),
    [buildEntries, buildWiring, partsById],
  );
  const wiringView: WiringSceneView | null = useMemo(() => {
    if (!wiringOn) return null;
    const byUid = portsByEntry(buildEntries, partsById);
    const boxes = deviceBoxes(buildEntries, partsById);
    const anchorOf = new Map<string, [number, number, number]>();
    const devices = boxes.map((box) => {
      const ports = byUid.get(box.entryUid) ?? [];
      const anchors = portAnchors(box, ports);
      for (const p of ports) {
        const a = anchors.get(p.id);
        if (a) anchorOf.set(`${box.entryUid}:${p.id}`, a);
      }
      const entry = buildEntries.find((e) => e.uid === box.entryUid);
      const item = entry
        ? paletteByKey.get(`${entry.kind}:${entry.refId}`)
        : undefined;
      return {
        uid: box.entryUid,
        name:
          (item?.name ?? entry?.refId ?? box.entryUid) +
          (entry && entry.kind === 'catalog-part' && entry.qty > 1
            ? ` ×${entry.qty}`
            : ''),
        center: box.center,
        size: box.size,
        ports: ports.flatMap((p) => {
          const a = anchors.get(p.id);
          return a
            ? [{ key: `${box.entryUid}:${p.id}`, type: p.type, anchor: a }]
            : [];
        }),
      };
    });
    const conns = resolvedWiring.connections.flatMap((c, i) => {
      const a = anchorOf.get(`${c.fromEntry}:${c.fromPort}`);
      const b = anchorOf.get(`${c.toEntry}:${c.toPort}`);
      return a && b ? [{ id: c.id, type: c.type, a, b, lane: i % 4 }] : [];
    });
    return {
      devices,
      conns,
      pendingPort,
      selectedConn,
    };
  }, [
    wiringOn,
    buildEntries,
    partsById,
    resolvedWiring,
    pendingPort,
    selectedConn,
    paletteByKey,
  ]);

  const portLabelOf = (key: string): string => {
    const [entryUid, portId] = key.split(/:(.*)/).filter(Boolean);
    const byUid = portsByEntry(buildEntries, partsById);
    const entry = buildEntries.find((e) => e.uid === entryUid);
    const item = entry
      ? paletteByKey.get(`${entry.kind}:${entry.refId}`)
      : undefined;
    const port = byUid.get(entryUid)?.find((p) => p.id === portId);
    return `${item?.name ?? entryUid} — ${port?.label ?? portId}`;
  };

  const handlePortClick = (key: string) => {
    if (!pendingPort) {
      setPendingPort(key);
      setWireNote(null);
      return;
    }
    if (pendingPort === key) {
      setPendingPort(null);
      return;
    }
    const [aEntry, aPort] = pendingPort.split(/:(.*)/).filter(Boolean);
    const [bEntry, bPort] = key.split(/:(.*)/).filter(Boolean);
    const result = addConnection(
      buildEntries,
      resolvedWiring,
      partsById,
      aEntry,
      aPort,
      bEntry,
      bPort,
      () => uid('wire'),
    );
    setPendingPort(null);
    if (result.ok) {
      saveWiring(result.wiring);
      setWireNote(
        `Wired ${portLabelOf(pendingPort)} ↔ ${portLabelOf(key)}.`,
      );
    } else {
      setWireNote(`Not wired: ${result.error}.`);
    }
  };

  const handleWireClick = (id: string | null) => {
    setSelectedConn(id);
    if (id === null) setPendingPort(null);
  };

  const deleteConnection = (id: string) => {
    saveWiring(removeConnection(resolvedWiring, id));
    if (selectedConn === id) setSelectedConn(null);
    setWireNote('Cable removed.');
  };
  const handleCanvasDrop = (itemKey: string, pos: [number, number]) => {
    const item = paletteByKey.get(itemKey);
    if (!item) return;
    if (item.hasModel) {
      addPaletteItem(item, pos);
      setDropNote(
        `${item.name} placed in the scene where you dropped it, and added to your build list.`,
      );
    } else {
      addPaletteItem(item);
      setDropNote(
        `${item.name} added to your build list — it has no 3D model, so nothing was placed in the scene.`,
      );
    }
  };

  /* Mobile UX Phase 2 (2026-10-31): on phone-width screens the 3D
   * scene waits for a tap — mounting Three.js + WebGL up front made
   * /kit the heaviest page on mobile while most readers only need
   * the catalogue below. Larger screens mount it as before. */
  const [sceneOn, setSceneOn] = useState(false);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 700px)').matches) setSceneOn(true);
  }, []);
  const loadScene = () => {
    readyRef.current = false;
    setFallback(false);
    setSceneOn(true);
  };

  /* The vanilla 6-second watchdog: if the 3D module never starts,
   * show the flat kit stack. Runs only once the scene is mounted. */
  useEffect(() => {
    if (!sceneOn) return;
    const t = setTimeout(() => {
      if (!readyRef.current) setFallback(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [sceneOn]);

  const specimenById = (id: string): SpecimenPart | undefined =>
    specimenDoc?.parts.find((p) => p.id === id);

  const toggleReal = () => {
    const next = !real;
    setReal(next);
    if (next && specimenDoc) setDetail({ kind: 'specimenList' });
  };

  const selectSpecimen = (id: string) => {
    setSelectedSpecimen(id);
    setDetail({ kind: 'specimenPart', id });
  };

  const scadText = selectedKey
    ? `// ${selectedKey} — RobotForge kit module (mm)\n` + SCAD_MODULES[selectedKey]
    : assemblyScad(explodeCur);


  return (
    <div className="kitpage">
      <style>{KIT_CSS}</style>
      <div className="wrap">
        <header>
          <div className="kicker">RobotForge · Take-Apart Kit</div>
          <h1>The Parts Kit, in 3D</h1>
          <p className="sub">
            A forged robot is a kit of parts, not a monolith. Drag to orbit,
            pinch or scroll to zoom, tap any part to inspect it — then pull the
            explode slider and watch it come apart. Flip on <b>CAD mode</b>{' '}
            and the same model becomes parametric OpenSCAD you can download,
            open in OpenSCAD or FreeCAD, edit, and print. Geometry: TurtleBot3
            Burger dims — the robot the gate passed. Open the{' '}
            <b>Parts palette</b> to drag bench props onto the stage and
            build a parts list — or ask the assistant in chat to add
            parts to your build. Flip on <b>Wiring</b> to cable that
            build list together — a schematic diagram from the parts'
            recorded interfaces, checked as you go.
          </p>
        </header>

        <div id="stage">
          {!sceneOn && (
            <div className="kit-load">
              <p>
                On a small screen the 3D kit loads only when you ask —
                it keeps this page fast. The parts catalogue below works
                without it, and the flat kit is right under the viewer.
              </p>
              <button type="button" className="primary" onClick={loadScene}>
                Load the 3D kit
              </button>
            </div>
          )}
          {sceneOn && (
          <KitScene
            explodeTarget={slider / 100}
            spin={spin}
            cad={cad}
            real={real}
            propsOn={propsOn}
            placedProps={placedProps}
            wiring={wiringView}
            onCanvasDrop={handleCanvasDrop}
            onPortClick={handlePortClick}
            onWireClick={handleWireClick}
            selectedSpecimen={selectedSpecimen}
            onReady={() => {
              readyRef.current = true;
            }}
            onFail={() => {
              if (!readyRef.current) setFallback(true);
            }}
            onSelectGenerated={(key) => {
              setSelectedKey(key as GeneratedKey);
              setDetail({
                kind: 'generated',
                key: key as GeneratedKey,
                withDownload: true,
              });
            }}
            onSelectSpecimen={selectSpecimen}
            onSpecimenLoaded={(doc) => {
              setSpecimenDoc(doc);
              setDetail({ kind: 'specimenList' });
            }}
            onSpecimenError={() => setDetail({ kind: 'specimenError' })}
            onPropsLoaded={(doc) => {
              setPropsDoc(doc);
              setPropsError(false);
            }}
            onPropsError={() => setPropsError(true)}
            onExplodeCur={setExplodeCur}
          />
          )}
          {sceneOn && (
            <div className="hud">
              <b>Drag</b> orbit · <b>Pinch</b> zoom · <b>Tap</b>{' '}
              {real ? 'a real part to inspect it' : 'a part to inspect'}
            </div>
          )}
          {paletteOpen && (
            <PartsPalette
              entries={buildEntries}
              onAdd={(item) => addPaletteItem(item)}
              onRemove={(id) => saveBuild(removeFromBuildList(buildEntries, id))}
              onQty={(id, qty) => saveBuild(setBuildQty(buildEntries, id, qty))}
              onClear={() => saveBuild([])}
              onClose={() => setPaletteOpen(false)}
            />
          )}
        </div>
        <div className="bar3d">
          <label htmlFor="explode">Explode</label>
          <input
            type="range"
            id="explode"
            min={0}
            max={100}
            value={slider}
            onChange={(e) => setSlider(Number(e.target.value))}
          />
          <button
            id="spinBtn"
            className={spin ? 'on' : undefined}
            onClick={() => setSpin(!spin)}
          >
            ⟳ Auto-rotate
          </button>
          <button
            id="cadBtn"
            className={cad ? 'on' : undefined}
            disabled={real}
            onClick={() => setCad(!cad)}
          >
            ⌗ CAD mode
          </button>
          <button
            id="realBtn"
            className={real ? 'on' : undefined}
            onClick={toggleReal}
          >
            ⬢ Real model — ROBOTIS
          </button>
          <button
            id="propsBtn"
            className={propsOn ? 'on' : undefined}
            onClick={() => setPropsOn(!propsOn)}
          >
            ▦ Bench props — NVIDIA SimReady
          </button>
          <button
            id="paletteBtn"
            className={paletteOpen ? 'on' : undefined}
            onClick={() => setPaletteOpen(!paletteOpen)}
          >
            ▤ Parts palette
          </button>
          <button
            id="wiringBtn"
            className={wiringOn ? 'on' : undefined}
            onClick={() => {
              setWiringOn(!wiringOn);
              setPendingPort(null);
              setSelectedConn(null);
              setWireNote(null);
            }}
          >
            ⚡ Wiring
          </button>
          <button
            id="dlBtn"
            className="primary"
            disabled={real}
            onClick={() =>
              downloadText(
                'robotforge-burger-assembly.scad',
                assemblyScad(explodeCur),
              )
            }
          >
            ⭳ Download .scad
          </button>
        </div>
        {dropNote && (
          <div className="box" style={{ marginTop: 14 }}>
            <b>Palette:</b> {dropNote}{' '}
            <button onClick={() => setDropNote(null)}>Dismiss</button>
          </div>
        )}
        {wiringOn && (
          <WiringPanel
            entries={buildEntries}
            items={paletteItems}
            partsById={partsById}
            wiring={resolvedWiring}
            pendingLabel={pendingPort ? portLabelOf(pendingPort) : null}
            selectedConn={selectedConn}
            note={wireNote}
            sceneActive={sceneOn && !fallback}
            onSelectConn={setSelectedConn}
            onDeleteConn={deleteConnection}
            onCancelPending={() => setPendingPort(null)}
          />
        )}
        {real && (
          <div className="box" style={{ marginTop: 14 }}>
            {specimenDoc ? (
              <>
                <b>Real model.</b> Official ROBOTIS meshes (Apache-2.0), pinned
                at commit <code>{specimenDoc.source.commit.slice(0, 7)}</code>{' '}
                — loaded from source, not re-hosted.{' '}
                {specimenDoc.honesty.join(' ')}
              </>
            ) : null}
          </div>
        )}
        {propsOn && (
          <div className="box" style={{ marginTop: 14 }}>
            {propsError ? (
              <>
                <b>Bench props unavailable.</b> The SimReady prop manifest
                or models could not be loaded. The kit itself is unaffected.
              </>
            ) : propsDoc ? (
              <>
                <b>Bench props — external assets.</b> Models by NVIDIA, from
                the{' '}
                <a href={propsDoc.dataset_url} target="_blank" rel="noreferrer">
                  {propsDoc.dataset}
                </a>{' '}
                dataset on Hugging Face, licensed{' '}
                <b>{propsDoc.license}</b>. Converted to glTF by RobotForge
                (decimation + texture resize —{' '}
                {(propsDoc.props.reduce((s, p) => s + p.optimized_bytes, 0) / 1e6).toFixed(1)}{' '}
                MB total on the web).{' '}
                {propsDoc.honesty.join(' ')}
                <table style={{ marginTop: 10 }}>
                  <tbody>
                    {propsDoc.props.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          {p.attribution}{' '}
                          <span className="dim">
                            ({p.size_m.map((v) => v.toFixed(2)).join(' × ')} m
                            native · {(p.optimized_bytes / 1000).toFixed(0)} KB)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <span className="dim">Loading bench props…</span>
            )}
          </div>
        )}
        {(fallback || !sceneOn) && (
          <div id="fallback2d" style={{ display: 'block' }}>
            <p className="dim">
              {fallback
                ? "The 3D viewer couldn't start (WebGL or CDN unavailable) — the kit, flat:"
                : 'The kit, flat — tap a layer to inspect it:'}
            </p>
            <div id="stack2d">
              {GENERATED_KEYS.map((k) => (
                <div
                  className="layer"
                  key={k}
                  onClick={() =>
                    setDetail({ kind: 'generated', key: k, withDownload: false })
                  }
                >
                  {k}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="cols">
          <section className="box" id="pdetail">
            <DetailBody
              detail={detail}
              specimenById={specimenById}
              specimenDoc={specimenDoc}
              onSelectSpecimen={selectSpecimen}
              onSpecimenList={() => setDetail({ kind: 'specimenList' })}
            />
          </section>
          <section className="box">
            <h3 style={{ marginTop: 0 }}>CAD — OpenSCAD</h3>
            <p className="dim" style={{ fontSize: 13.5 }}>
              Generated live from the same parameters as the 3D model, explode
              included. Select a part to get its module alone, or download the
              whole assembly.
            </p>
            <pre id="scadCode">{scadText}</pre>
          </section>
        </div>

      </div>
    </div>
  );
}

function DetailBody({
  detail,
  specimenById,
  specimenDoc,
  onSelectSpecimen,
  onSpecimenList,
}: {
  detail: Detail;
  specimenById: (id: string) => SpecimenPart | undefined;
  specimenDoc: SpecimenDoc | null;
  onSelectSpecimen: (id: string) => void;
  onSpecimenList: () => void;
}) {
  if (detail.kind === 'generated') {
    const meta = PD_META[detail.key];
    const part = partByName(meta.partName);
    if (!part) return <p className="dim">Catalogue part not found.</p>;
    return (
      <>
        <h3>{meta.title}</h3>
        <p>{meta.blurb}</p>
        <table>
          <tbody>
            <tr>
              <td>Catalogue part</td>
              <td>{part.name}</td>
            </tr>
            <tr>
              <td>Class</td>
              <td>{classLabel(part)}</td>
            </tr>
            <tr>
              <td>Specs</td>
              <td>{fmtSpecs(part)}</td>
            </tr>
            <tr>
              <td>Source</td>
              <td>{part.source}</td>
            </tr>
          </tbody>
        </table>
        {detail.withDownload && (
          <p style={{ marginTop: 10 }}>
            <button
              className="primary"
              onClick={() =>
                downloadText(
                  `robotforge-${detail.key}.scad`,
                  partScad(detail.key),
                )
              }
            >
              ⭳ Download this part (.scad)
            </button>
          </p>
        )}
      </>
    );
  }
  if (detail.kind === 'specimenList' && specimenDoc) {
    return (
      <>
        <h3>The real Burger, part by part</h3>
        <p>
          Decomposed from ROBOTIS’s official URDF, at the poses the model
          itself specifies. Click a part here or in 3D.
        </p>
        {specimenDoc.parts.map((p) => (
          <div
            className="layer"
            key={p.id}
            onClick={() => onSelectSpecimen(p.id)}
          >
            {p.name} <span className="dim">· {p.tier.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </>
    );
  }
  if (detail.kind === 'specimenPart') {
    const p = specimenById(detail.id);
    if (!p) return <p className="dim">Specimen part not found.</p>;
    return (
      <>
        <h3>{p.name}</h3>
        <p>{p.role}</p>
        <table>
          <tbody>
            <tr>
              <td>Tier</td>
              <td>{TIER_LABEL[p.tier]}</td>
            </tr>
            {p.mass_kg ? (
              <tr>
                <td>Mass (from the URDF)</td>
                <td>{p.mass_kg.toFixed(3)} kg</td>
              </tr>
            ) : null}
            {p.mesh_file ? (
              <tr>
                <td>Mesh file</td>
                <td>{p.mesh_file}</td>
              </tr>
            ) : null}
            {p.collision_box_m ? (
              <tr>
                <td>Collision box (m)</td>
                <td>{p.collision_box_m.join(' × ')}</td>
              </tr>
            ) : null}
            <tr>
              <td>Source</td>
              <td>ROBOTIS-GIT/turtlebot3 · Apache-2.0</td>
            </tr>
            {(p.related_catalog_parts || []).map((r, i) => (
              <tr key={i}>
                <td>Related catalogue part</td>
                <td>
                  {r.part} — {r.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 10 }}>
          <button onClick={onSpecimenList}>← All specimen parts</button>
        </p>
      </>
    );
  }
  if (detail.kind === 'specimenError') {
    return (
      <>
        <h3>Real model unavailable</h3>
        <p>
          The specimen data or the official meshes could not be loaded (a
          network connection is needed). The generated kit is still here —
          toggle Real model off to go back.
        </p>
      </>
    );
  }
  return (
    <p className="dim">
      Click a part in 3D to inspect the real catalogue part behind it.
    </p>
  );
}

