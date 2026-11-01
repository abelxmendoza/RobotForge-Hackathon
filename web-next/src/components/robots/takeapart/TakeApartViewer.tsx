"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { RobotSpec as ForgeSpec } from "@/components/forge/model";

const Robot3D = dynamic(() => import("@/components/kit/Robot3D"), { ssr: false });
import { assetPath } from "@/components/home/asset";
import { teardownSteps } from "@/lib/teardown";
import {
  TA_SPOTS, elecBad, elecConnLabel, elecDepths, elecNodeMap, elecNodeStatus,
  elecStage, elecVolts, taBuildParts, taClass, taIsEstimated,
  type RobotSpec, type TaPart, type Wiring,
} from "./spec";
import { renderSide, renderTop, type TaViewState } from "./render";
import { stageRecordOf } from "@/lib/data";
import { robotCapability } from "@/lib/stageAnimation";
import { useStageAnimation } from "@/lib/useStageAnimation";
import { StageControlsRow } from "@/components/kit/StageControls";
import type { RobotLife } from "@/components/kit/Robot3D";

/* The take-apart viewer (robot.js initTakeApart + TA_PANEL + the
   taSelect family), as a React component. The spec file is fetched
   exactly like the vanilla page fetches it; if it cannot be loaded
   the viewer says so instead of drawing something invented. The 3D
   pane belongs to the kit component — here it carries the vanilla
   note and the fallback line, with the route to the 3D kit. */

type Detail =
  | { kind: "none" }
  | { kind: "part"; id: string }
  | { kind: "node"; id: string };

const WIRE_INFO_DEFAULT =
  "Hover or click a connection to read it; click a component chip for its requirement and status.";

function elecFacts(w: Wiring, nodeId: string) {
  const nodes = elecNodeMap(w);
  const st = elecNodeStatus(w, nodeId);
  const feed = st.feeds.map((c, ci) => (
    <span key={`feed${ci}`}>
      {nodes[c.from] ? nodes[c.from].label : c.from} ·{" "}
      {c.volts != null ? elecVolts(c.volts) : (c.label || "no fixed voltage")}
    </span>
  ));
  const feedJoined: ReactNode = feed.length
    ? feed.flatMap((f, i) => (i === 0 ? [f] : [<br key={`b${i}`} />, f]))
    : "";
  let status: ReactNode;
  if (st.state === "bad") {
    status = (
      <span className="elec-bad">
        Over-voltage — a recorded feed exceeds this part&apos;s rated maximum.
      </span>
    );
  } else if (st.state === "ok") {
    status = <span className="elec-ok">Within rating on the recorded values.</span>;
  } else {
    status = <span className="elec-unchecked">Not checked — {st.reason}.</span>;
  }
  return { feed: feedJoined, hasFeed: feed.length > 0, status };
}

export default function TakeApartViewer({ specFile }: { specFile: string }) {
  const [spec, setSpec] = useState<RobotSpec | null>(null);
  const [failed, setFailed] = useState(false);
  const [threeFailed, setThreeFailed] = useState(false);
  const [explode, setExplode] = useState(0);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [elec, setElec] = useState(false);
  const [power, setPower] = useState(false);
  const [elecStageNow, setElecStageNow] = useState(0);
  const [detail, setDetail] = useState<Detail>({ kind: "none" });
  const [selected, setSelected] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selWire, setSelWire] = useState<number | null>(null);
  const [wireInfo, setWireInfo] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /* Step-by-step teardown (3D only): how many parts are off, autoplay, isolate. */
  const [tdOn, setTdOn] = useState(false);
  const [tdDone, setTdDone] = useState(0);
  const [tdPlaying, setTdPlaying] = useState(false);
  const [tdIsolate, setTdIsolate] = useState(false);

  /* Living Build Stage (Layer 0 of the digital-twin path): in 3D
   * mode this robot animates only what recorded data licenses —
   * the capability map comes from its pinned URDF joints and spec
   * sensors (lib/stageAnimation). The Electrical overlay is this
   * page's wiring mode: while it is on, stage motion pauses, the
   * same coexistence rule the kit stage follows. Robots with no
   * stage record (a visitor's own spec) simply get no life. */
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useStageAnimation(stageRef);
  const stageCapability = useMemo(() => {
    const rec = spec ? stageRecordOf(spec.name) : undefined;
    return rec ? robotCapability(rec) : null;
  }, [spec]);
  const robotLife: RobotLife | undefined = useMemo(() => {
    if (!stageCapability) return undefined;
    const travel = stageCapability.tracks.find((t) => t.kind === "travel");
    return {
      playing: stage.playingNow(elec) && mode === "3d" && !tdOn,
      speed: stage.controls.speed,
      sensors: stage.controls.sensors,
      hover: stageCapability.tracks.some((t) => t.kind === "hover"),
      lidarSweep: stageCapability.overlays.some(
        (o) => o.kind === "lidar_2d" && o.drawable,
      ),
      gripperTravelM: travel?.joints?.[0]?.amplitude ?? null,
    };
  }, [stageCapability, stage, elec, mode, tdOn]);

  useEffect(() => {
    let live = true;
    fetch(assetPath(specFile), { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: unknown) => {
        if (live) setSpec(j as RobotSpec);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [specFile]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
  }, []);

  const built = useMemo(() => (spec ? taBuildParts(spec) : null), [spec]);
  const cls = spec ? taClass(spec) : "ground";
  const wiring = spec?.wiring;
  const td = useMemo(() => teardownSteps(built ? built.parts.map((p) => p.id) : []), [built]);

  /* Play: one part off every 1.8 s until only the core is left. */
  useEffect(() => {
    if (!tdPlaying || mode !== "3d") return;
    if (tdDone >= td.steps.length) { setTdPlaying(false); return; }
    const id = setTimeout(() => {
      const next = tdDone + 1;
      setTdDone(next);
      const part = td.steps[next - 1];
      setSelected(part);
      setDetail({ kind: "part", id: part });
    }, tdDone === 0 ? 400 : 1800);
    return () => clearTimeout(id);
  }, [tdPlaying, tdDone, td.steps, mode]);

  if (failed) {
    return (
      <div className="state-box">
        The spec file could not be loaded, so there is nothing honest to draw.
        The viewer builds only from published spec files.
      </div>
    );
  }
  if (!spec || !built) {
    return (
      <div className="state-box">
        Loading <code>{specFile}</code>&hellip;
      </div>
    );
  }

  const parts = built.parts;

  const wireInfoFor = (i: number) => {
    if (!wiring || !wiring.connections[i]) return;
    setWireInfo(
      elecConnLabel(wiring, i) +
        (elecBad(wiring).has(i)
          ? " — over-voltage: above the target's recorded rated maximum."
          : ""),
    );
  };

  const view: TaViewState = {
    spec,
    parts,
    pos: built.pos,
    explodeMm: explode,
    elec,
    power,
    elecStage: elecStageNow,
    selected,
    selNode,
    selWire,
    onSelectPart: (id) => {
      setSelected(id);
      setSelNode(null);
      setSelWire(null);
      setDetail({ kind: "part", id });
    },
    onSelectNode: (id) => {
      setSelNode(id);
      setSelWire(null);
      setSelected(null);
      setDetail({ kind: "node", id });
    },
    onSelectWire: (i) => {
      setSelWire(i);
      setSelNode(null);
      wireInfoFor(i);
    },
    onWireHover: (i) => wireInfoFor(i),
  };

  const setPowerTo = (on: boolean) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPower(on);
    if (!on || !wiring) {
      setElecStageNow(0);
      return;
    }
    /* light the wiring in supply order: battery first, then whatever
       it feeds, then whatever that feeds */
    const depth = elecDepths(wiring);
    const stages = [...new Set(
      wiring.connections
        .map((c, i) => elecStage(wiring, depth, i))
        .filter(Number.isFinite),
    )].sort((a, b) => a - b);
    setElecStageNow(0);
    stages.forEach((s, k) => {
      timers.current.push(setTimeout(() => setElecStageNow(s), 80 + k * 190));
    });
  };

  const toggleElec = () => {
    const on = !elec;
    setElec(on);
    if (on) {
      setWireInfo(WIRE_INFO_DEFAULT);
    } else {
      setPowerTo(false);
      setSelWire(null);
    }
  };

  const detailBody = (): ReactNode => {
    if (detail.kind === "node" && wiring) {
      const node = elecNodeMap(wiring)[detail.id];
      if (node) {
        const f = elecFacts(wiring, node.id);
        const conns = wiring.connections
          .map((c, i) => (c.from === node.id || c.to === node.id ? elecConnLabel(wiring, i) : null))
          .filter(Boolean);
        return (
          <>
            <span className="qty">Electrical component</span>
            <h3>{node.label}</h3>
            <dl>
              <dt>Electrical requirement</dt>
              <dd className="m">{node.req_label}</dd>
              <dt>Supplied by</dt>
              <dd>{f.hasFeed ? f.feed : "— (it is a source)"}</dd>
              <dt>Status</dt>
              <dd>{f.status}</dd>
              <dt>Connections</dt>
              <dd>
                {conns.flatMap((c, i) => (i === 0 ? [c] : [<br key={i} />, c]))}
              </dd>
            </dl>
            <p className="faint" style={{ marginTop: 14, fontSize: "var(--fs-xs)" }}>
              Requirements and voltages are the recorded ones — the spec&apos;s
              own fields and the parts catalog&apos;s datasheet specs.
              &ldquo;Not specified&rdquo; means the data names none.
            </p>
          </>
        );
      }
    }
    if (detail.kind === "part") {
      const p: TaPart | undefined = parts.find((x) => x.id === detail.id);
      if (p) {
        const spot = TA_SPOTS.includes(p.id) ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="spot"
              src={assetPath(`assets/img/parts/${p.id}.jpg`)}
              alt={`AI illustration of the ${p.name}`}
              loading="lazy"
            />
            <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              AI illustration (muse-image-1.0). The printable part itself
              comes from <code>robotforge cad</code>.
            </p>
          </>
        ) : null;
        const qtyLine = p.file
          ? `Qty ${p.qty} · ${p.file}`
          : `Qty ${p.qty} · schematic part — the real robot's layout, not a kit file`;
        const elecSection = (() => {
          if (!wiring) return null;
          const node = wiring.nodes.find((n) => n.kit === p.id);
          if (!node) {
            return (
              <>
                <dt>Electrical</dt>
                <dd>No electrical requirement — a mechanical part.</dd>
              </>
            );
          }
          const f = elecFacts(wiring, node.id);
          return (
            <>
              <dt>Electrical</dt>
              <dd>
                Needs: {node.req_label}
                <br />
                Supplied by: {f.hasFeed ? f.feed : "nothing recorded"}
                <br />
                Status: {f.status}
              </dd>
            </>
          );
        })();
        return (
          <>
            <span className="qty">{qtyLine}</span>
            <h3>{p.name}</h3>
            {spot}
            <dl>
              <dt>What it is</dt>
              <dd>{p.does}</dd>
              <dt>Key dimensions</dt>
              <dd className="m">{p.dims}</dd>
              <dt>Beginner tweak</dt>
              <dd>{p.tweak}</dd>
              <dt>{p.file ? "Print note" : "Note"}</dt>
              <dd>{p.print}</dd>
              {elecSection}
            </dl>
            {p.file ? (
              <p className="faint" style={{ marginTop: 14, fontSize: "var(--fs-xs)" }}>
                This part is one file in the take-apart kit. Open{" "}
                <code>{p.file}</code> in OpenSCAD (or FreeCAD) to edit just
                this part — the assembly picks up your change.
              </p>
            ) : (
              <p className="faint" style={{ marginTop: 14, fontSize: "var(--fs-xs)" }}>
                A schematic part derived from the spec — this class has no
                printable kit yet, so there is no file to open. The
                dimensions above are the spec&apos;s own numbers.
              </p>
            )}
          </>
        );
      }
    }
    return cls === "ground" ? (
      <>
        <h3>Pick a part</h3>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
          Click any part in either view to see what it is, its key dimensions
          from the spec, one beginner tweak, and a print suggestion.
        </p>
      </>
    ) : (
      <>
        <h3>Pick a part</h3>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
          Click any part in either view to see what it is and its key
          dimensions from the spec.
        </p>
      </>
    );
  };

  const tdGo = (n: number) => {
    const k = Math.max(0, Math.min(td.steps.length, n));
    setTdDone(k);
    setTdIsolate(false);
    const part = k > 0 ? td.steps[k - 1] : td.core;
    if (part) {
      setSelected(part);
      setDetail({ kind: "part", id: part });
    }
  };
  const tdName = (id: string | null) => {
    const p = parts.find((x) => x.id === id);
    return p ? (p.qty > 1 ? `${p.name} ×${p.qty}` : p.name) : id ?? "";
  };
  const tdCurrent = tdDone > 0 ? td.steps[tdDone - 1] : null;
  const tdLabel = !tdOn
    ? ""
    : tdDone === 0
      ? `Assembled · ${td.steps.length} parts come off before the ${tdName(td.core).toLowerCase()} is left`
      : tdDone >= td.steps.length
        ? `Stripped down: only the ${tdName(td.core).toLowerCase()} is left`
        : `Step ${tdDone} of ${td.steps.length}: ${tdName(tdCurrent)} off`;
  const tdFocus = tdIsolate ? (tdCurrent ?? td.core) : null;

  const ground = cls === "ground";
  return (
    <>
      <div id="ta-est">
        {taIsEstimated(spec) ? (
          <span className="est">Estimated — drafted from a photo, not measured</span>
        ) : null}
      </div>
      <div className="ta-controls">
        <label htmlFor="ta-explode">Explode</label>
        <input
          type="range"
          id="ta-explode"
          min={0}
          max={60}
          value={explode}
          step={1}
          onChange={(e) => setExplode(Number(e.target.value))}
        />
        <output id="ta-explode-val" htmlFor="ta-explode">{explode} mm</output>
      </div>
      {wiring ? (
        <div className="ta-controls" id="ta-elec-controls">
          <button
            className="btn btn-sm ta-toggle" id="ta-elec" type="button"
            aria-pressed={elec} onClick={toggleElec}
          >
            Electrical
          </button>
          <button
            className="btn btn-sm ta-toggle" id="ta-power" type="button"
            aria-pressed={power} disabled={!elec} onClick={() => setPowerTo(!power)}
          >
            {power ? "Power off" : "Power on"}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            Amber is power, blue is data, grey is unpowered — red is a
            recorded over-voltage. Power lights the wiring in supply order,
            battery first.
          </span>
        </div>
      ) : null}
      <p id="ta-wire-info" className="ta-wire-info" hidden={!elec}>
        {wireInfo ?? ""}
      </p>
      <p id="ta-elec-note" className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }} hidden={!elec}>
        {wiring?.note ?? ""}
      </p>
      <div className="ta-controls" id="ta-view-controls">
        <div className="tabs" role="tablist" aria-label="Take-apart view">
          <button
            className="tab" type="button" id="ta-view-2d" role="tab"
            aria-selected={mode === "2d"} onClick={() => { setTdPlaying(false); setMode("2d"); }}
          >
            2D views
          </button>
          <button
            className="tab" type="button" id="ta-view-3d" role="tab"
            aria-selected={mode === "3d"} onClick={() => setMode("3d")}
          >
            3D
          </button>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>
          Same kit, same explode slider, same click-a-part panel.
        </span>
      </div>
      <p id="ta-3d-note" className="callout" style={{ marginBottom: 12 }} hidden={mode !== "3d"}>
        <span>
          The 3D view is a schematic of the same kit. The electrical overlay
          and the dimension lines are <strong>2D-only</strong> for now &mdash;
          switch back to 2D views for those.
        </span>
      </p>
      {mode === "3d" && td.steps.length > 0 ? (
        <div className="ta-controls ta-teardown" id="ta-teardown">
          {!tdOn ? (
            <button className="btn btn-sm btn-primary" type="button" onClick={() => { setTdOn(true); setExplode(0); tdGo(0); setTdPlaying(true); }}>
              Take it apart, step by step
            </button>
          ) : (
            <>
              <button className="btn btn-sm" type="button" onClick={() => { setTdPlaying(false); tdGo(tdDone - 1); }} disabled={tdDone === 0}>&larr; Put back</button>
              <button className="btn btn-sm btn-primary" type="button" onClick={() => { setTdPlaying(false); tdGo(tdDone + 1); }} disabled={tdDone >= td.steps.length}>Next part &rarr;</button>
              <button className="btn btn-sm" type="button" onClick={() => { if (tdDone >= td.steps.length) tdGo(0); setTdPlaying(!tdPlaying); }}>
                {tdPlaying ? "Pause" : tdDone >= td.steps.length ? "Replay" : "Play"}
              </button>
              <button className="btn btn-sm ta-toggle" type="button" aria-pressed={tdIsolate} onClick={() => { setTdPlaying(false); setTdIsolate(!tdIsolate); }}>
                Show only this part
              </button>
              <button className="btn btn-sm" type="button" onClick={() => { setTdPlaying(false); setTdOn(false); setTdDone(0); setTdIsolate(false); }}>Reassemble</button>
              <span className="ta-teardown-label" role="status">{tdLabel}</span>
            </>
          )}
        </div>
      ) : null}
      <div className="ta-stage">
        <div>
          <div id="ta-2d" hidden={mode === "3d"}>
            <div className="ta-view">
              <div id="ta-side">{renderSide(view, cls)}</div>
              <p className="cap">
                {ground
                  ? "Side view. Rear is left, front is right; ground is z = 0 and axles sit at wheel-radius height."
                  : "Side view. Front is to the right; z = 0 is the ground (the table, for a fixed arm)."}
              </p>
            </div>
            <div className="ta-view">
              <div id="ta-top">{renderTop(view, cls)}</div>
              <p className="cap">
                {ground ? (
                  <>Top view. Explode moves the wheels outward, like the kit&apos;s <code>explode_mm</code>.</>
                ) : (
                  "Top view. The explode slider separates the same parts, the same way, as the 3D view."
                )}
              </p>
            </div>
          </div>
          <div className="ta-view" id="ta-3dwrap" ref={stageRef} hidden={mode !== "3d"}>
            <div id="ta-3d">
              {mode === "3d" && spec && !threeFailed ? (
                <Robot3D
                  spec={spec as unknown as ForgeSpec}
                  explode={explode}
                  selected={selected}
                  life={robotLife}
                  teardown={tdOn ? { removed: td.steps.slice(0, tdDone), isolate: tdFocus } : undefined}
                  onSelect={(id) => {
                    setSelected(id);
                    setSelNode(null);
                    setSelWire(null);
                    setDetail({ kind: "part", id });
                  }}
                  onFail={() => setThreeFailed(true)}
                />
              ) : null}
            </div>
            <p className="cap">
              3D take-apart. Drag to orbit, pinch or scroll to zoom, tap
              a part &mdash; the panel beside it is the same one the flat views use.
            </p>
            {mode === "3d" && stageCapability ? (
              <>
                <StageControlsRow
                  controls={stage.controls}
                  reducedMotion={stage.reducedMotion}
                  showFlow={false}
                  onChange={(patch) =>
                    stage.setControls((c) => ({ ...c, ...patch }))
                  }
                />
                <p className="cap">
                  {stageCapability.tracks.filter((t) => t.kind !== "sway").length > 0 ? (
                    <>
                      Animates:{" "}
                      {stageCapability.tracks
                        .filter((t) => t.kind !== "sway")
                        .map((t) => `${t.kind} (${t.target})`)
                        .join(" · ")}
                      .{" "}
                    </>
                  ) : (
                    <>This robot does not animate on the stage. </>
                  )}
                  {stageCapability.tracks
                    .filter((t) => t.kind === "sway")
                    .map((t) => (
                      <span key={t.kind + t.target}>
                        Sway range derived and limit-checked from the recorded{" "}
                        {t.target} limits, but not rendered in this schematic
                        viewer — user-driven joint rendering is the Layer 1
                        kinematic twin.{" "}
                      </span>
                    ))}
                  {stageCapability.abstentions.map((a) => (
                    <span key={a.subject}>
                      No motion — {a.subject}: {a.reason}{" "}
                    </span>
                  ))}
                  {stageCapability.overlays
                    .filter((o) => o.kind === "lidar_2d" && o.drawable)
                    .map((o) => (
                      <span key={o.kind}>
                        The sweep wedge shows the recorded scan direction at
                        stage scale; recorded lidar range is {o.rangeM} m, not
                        plotted to scale.{" "}
                      </span>
                    ))}
                  Electrical flow for this robot lives in the 2D Electrical
                  view above; the 3D flow stage is on the kit page.
                </p>
              </>
            ) : null}
            {threeFailed ? (
              <p className="state-box" id="ta-3d-fallback">
                3D unavailable here &mdash; the 2D take-apart still works.{" "}
                <Link href="/kit/">Open the 3D kit &rarr;</Link>
              </p>
            ) : null}
          </div>
        </div>
        <aside className="card ta-detail" id="ta-detail">
          {detailBody()}
        </aside>
      </div>
      <p className="faint" id="ta-foot" style={{ fontSize: "var(--fs-xs)", marginTop: 12 }}>
        {ground
          ? <>A layout viewer built from the spec&apos;s numbers, not a CAD render. <code>robotforge cad</code> writes the printable files, one OpenSCAD file per part.</>
          : "A schematic layout viewer built from the spec's numbers, not a CAD render. Printable kits (robotforge cad) cover ground robots today; this class is drawn from its published spec instead."}
      </p>
    </>
  );
}
