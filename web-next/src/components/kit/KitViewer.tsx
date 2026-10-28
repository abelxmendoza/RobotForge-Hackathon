'use client';
/* The standalone Parts Kit page — the React equivalent of kit.html:
 * header, the 3D stage (KitScene), the explode/spin/CAD/real/download
 * bar, part detail + live OpenSCAD panels, the 2D fallback stack,
 * and the full catalogue generated from the current parts data.
 * kit.html is a standalone page with its own stylesheet; here those
 * rules are carried in a <style> block scoped under .kitpage so they
 * cannot leak into the app shell (or vice versa).
 *
 * Below the kit.html content, the same Burger is shown in the
 * spec-driven take-apart panel (robot.js's TA panel, TakeApartViewer)
 * driven by its published spec file — the 2D/3D viewer the robot
 * pages use. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '../forge/model';
import type { RobotSpec } from '../forge/model';
import { parts as libParts } from '../forge/data';
import type { CatalogPart } from '../forge/data';
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
import type { GeneratedKey, SpecimenDoc, SpecimenPart } from './burger';
import KitScene from './KitScene';
import TakeApartViewer from './TakeApartViewer';

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
.kitpage .cls{margin:26px 0 6px;text-transform:capitalize}
.kitpage .layer{width:78%;margin:3px auto;text-align:center;background:#21252e;
  border:1px solid #2c313a;border-radius:10px;padding:9px;cursor:pointer;font-weight:600}
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
  const [fallback, setFallback] = useState(false);
  const readyRef = useRef(false);

  /* The vanilla 6-second watchdog: if the 3D module never starts,
   * show the flat kit stack. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (!readyRef.current) setFallback(true);
    }, 6000);
    return () => clearTimeout(t);
  }, []);

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

  const catalogue = useMemo(() => {
    const groups = new Map<string, CatalogPart[]>();
    libParts.forEach((p) => {
      const arr = groups.get(p.part_class) || [];
      arr.push(p);
      groups.set(p.part_class, arr);
    });
    return Array.from(groups.entries()).sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
  }, []);

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
            Burger dims — the robot the gate passed.
          </p>
        </header>

        <div id="stage">
          <KitScene
            explodeTarget={slider / 100}
            spin={spin}
            cad={cad}
            real={real}
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
            onExplodeCur={setExplodeCur}
          />
          <div className="hud">
            <b>Drag</b> orbit · <b>Pinch</b> zoom · <b>Tap</b>{' '}
            {real ? 'a real part to inspect it' : 'a part to inspect'}
          </div>
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
        {fallback && (
          <div id="fallback2d" style={{ display: 'block' }}>
            <p className="dim">
              The 3D viewer couldn't start (WebGL or CDN unavailable) — the
              kit, flat:
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

        <h2 style={{ marginTop: 36 }}>
          Full catalogue{' '}
          <span className="dim">
            — {libParts.length} real parts, datasheet-sourced
          </span>
        </h2>
        {catalogue.map(([cls, items]) => (
          <div key={cls}>
            <h3 className="cls">
              {cls.replace(/_/g, ' ')}{' '}
              <span className="dim">({items.length})</span>
            </h3>
            <table className="cat">
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{fmtSpecs(p)}</td>
                    <td className="dim">{p.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <SpecTakeApart />
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

/* The spec-driven take-apart for the same Burger, from its published
 * spec file — robot.js's viewer, as TakeApartViewer. */
function SpecTakeApart() {
  const [spec, setSpec] = useState<RobotSpec | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetchJSON<RobotSpec>('examples/turtlebot3-burger.json')
      .then((s) => {
        if (live) setSpec(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section style={{ marginTop: 36 }}>
      <h2>
        The same Burger, from its spec{' '}
        <span className="dim">
          — the take-apart viewer the robot pages use
        </span>
      </h2>
      {failed ? (
        <div className="state-box">
          The spec file could not be loaded, so there is nothing honest to
          draw. The viewer builds only from published spec files.
        </div>
      ) : spec ? (
        <TakeApartViewer spec={spec} />
      ) : null}
    </section>
  );
}
