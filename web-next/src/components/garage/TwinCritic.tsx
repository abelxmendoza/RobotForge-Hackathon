"use client";
/* Twin critic in the Workshop's Checks tab (lib/twinCritic.ts).
 *
 * Most robots: the schematic twin the Overview and take-apart views
 * draw (taBuildParts → taGeom3d), plus the parts placed in the
 * Assembly planner. Omega1: its ProjectSim model, read from the model
 * file's own header (a range request for the first bytes; the 10 MB
 * of mesh data is never needed for the boxes). */
import { useEffect, useMemo, useState } from "react";
import type { RobotSpec } from "@/components/forge/model";
import { taBuildParts, taClass, taGeom3d } from "@/components/kit/takeapart";
import { ASSEMBLY_KEY, currentAssembly, type Assemblies } from "@/lib/assembly";
import { componentById } from "@/lib/components";
import { readStore } from "@/lib/store";
import { omega1Rover } from "@/lib/omega1Twin";
import { assetPath } from "@/components/home/asset";
import {
  critiqueTwin, glbLinkBoxes, modelUnits, OMEGA1_MODEL,
  type CriticPlaced, type CriticVerdict, type TwinCritique, type CriticFinding,
} from "@/lib/twinCritic";

const CLS: Record<CriticVerdict, string> = { PASS: "pass", WARN: "marginal", FAIL: "fail", NOT_CHECKED: "norun" };
const WORD: Record<CriticVerdict, string> = { PASS: "Holds together", WARN: "Twin needs work", FAIL: "Can’t be built as drawn", NOT_CHECKED: "Not checked" };

async function readModelHead(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url, { headers: { Range: "bytes=0-262143" } });
  if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status);
  let buf = await r.arrayBuffer();
  const need = 20 + new DataView(buf).getUint32(12, true);
  if (buf.byteLength < need) {
    const all = await fetch(url);
    buf = await all.arrayBuffer();
  }
  return buf;
}

function placedFor(robotId: string): CriticPlaced[] {
  const asm = currentAssembly(readStore<Assemblies>(ASSEMBLY_KEY, {}), robotId);
  return asm.components.flatMap((c) => {
    const d = componentById(c.componentId);
    return d ? [{ id: c.id, name: d.name, sizeM: d.sizeM, positionM: c.positionM, yawDeg: c.yawDeg }] : [];
  });
}

export function useTwinCritique(robotId: string, spec: RobotSpec | null, omega: boolean): { result: TwinCritique | null; error: string } {
  const [placed, setPlaced] = useState<CriticPlaced[]>([]);
  const [omegaBoxes, setOmegaBoxes] = useState<ReturnType<typeof glbLinkBoxes> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setPlaced(placedFor(robotId)); }, [robotId, spec]);
  useEffect(() => {
    if (!omega) return;
    let live = true;
    readModelHead(assetPath(omega1Rover.model))
      .then((buf) => { if (live) setOmegaBoxes(glbLinkBoxes(buf)); })
      .catch((e) => { if (live) setError("Couldn’t read Omega1’s twin model: " + (e?.message ?? e)); });
    return () => { live = false; };
  }, [omega]);
  const key = JSON.stringify(spec ?? null);
  const result = useMemo(() => {
    if (!spec) return null;
    const cls = taClass(spec);
    if (omega) {
      if (!omegaBoxes) return null;
      const { units, explodeMaxM } = modelUnits(omegaBoxes, { fixed: ["chassis"], up: ["sensor_head"] });
      return critiqueTwin({ spec, cls, units, names: OMEGA1_MODEL.names, explodeMaxM, model: OMEGA1_MODEL });
    }
    try {
      const built = taBuildParts(spec);
      const units = taGeom3d(spec, built.parts, built.pos);
      const names = Object.fromEntries(built.parts.map((p) => [p.id, p.name]));
      return critiqueTwin({ spec, cls, units, names, placed, explodeMaxM: 0.06 });
    } catch {
      return critiqueTwin({ spec: {}, cls, units: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, omega, omegaBoxes, placed]);
  return { result, error };
}

function Row({ f }: { f: CriticFinding }) {
  return (
    <li className="tc-row">
      <span className={"verdict " + CLS[f.verdict]}>{f.verdict === "NOT_CHECKED" ? "NOT CHECKED" : f.verdict}</span>{" "}
      <strong>{f.title}</strong> <span className="tc-detail">{f.detail}</span>
      {f.parts.length > 0 && f.verdict !== "PASS" && (
        <span className="tc-parts">{f.parts.map((p) => <span key={p} className="tc-part">{p}</span>)}</span>
      )}
    </li>
  );
}

export default function TwinCritic({ robotId, spec, omega }: { robotId: string; spec: RobotSpec; omega: boolean }) {
  const { result, error } = useTwinCritique(robotId, spec, omega);
  const spec_ = result?.findings.filter((f) => f.group === "spec") ?? [];
  const twin = result?.findings.filter((f) => f.group === "twin") ?? [];
  return (
    <details className="ws-disclosure tc" data-verdict={result?.verdict ?? "loading"}>
      <summary>
        3D twin check{" "}
        {result && <span className={"verdict " + CLS[result.verdict]}>{WORD[result.verdict]}</span>}
      </summary>
      <p className="g-small faint">Does the 3D twin {omega ? "of Omega1" : "built from this spec"} hold together? Parts must not share space, nothing may float, and it must stand on the floor. {result?.basis}</p>
      {error && <p className="g-error">{error}</p>}
      {!result && !error && <p className="faint g-small">Reading the twin…</p>}
      {result && (
        <>
          <h4 className="tc-h">This robot’s numbers</h4>
          <ul className="forge-list">{spec_.map((f) => <Row key={f.id} f={f} />)}</ul>
          <h4 className="tc-h">RobotForge’s drawing of it</h4>
          <p className="faint g-small">A warning here is ours to fix in the twin, not yours to fix in the robot.</p>
          <ul className="forge-list">{twin.map((f) => <Row key={f.id} f={f} />)}</ul>
        </>
      )}
    </details>
  );
}
