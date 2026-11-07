"use client";
/* The /explain/ page: pick a robot, get its step-through explainer.
 *
 * ?robot=<id> resolves, in order: a robot in this browser's Workshop
 * (its latest version, with that version's estimate marks), Omega1's
 * documented seed when Omega1 is not in the Workshop yet, then a
 * Robodex robot by slug (its recorded spec file). Nothing is saved. */
import { useEffect, useMemo, useState } from "react";
import RobotExplainer from "./RobotExplainer";
import { buildExplainer } from "@/lib/robotExplainer";
import { GARAGE_KEY, type GarageRobot, type Spec } from "@/lib/garage";
import { readStore } from "@/lib/store";
import { activeRecords } from "@/lib/lifecycle";
import { OMEGA1_ROBOT_ID, omega1SeedSpec } from "@/lib/omega1Garage";
import { robots as dexRobots, robotSlug } from "@/lib/data";
import { assetPath } from "@/components/home/asset";

interface Picked { id: string; name: string; spec: Spec; estimatedPaths?: string[]; from: "workshop" | "seed" | "robodex" }

function readId(): string {
  try { return new URLSearchParams(window.location.search).get("robot") || OMEGA1_ROBOT_ID; } catch { return OMEGA1_ROBOT_ID; }
}

export default function ExplainPage() {
  const [id, setId] = useState<string | null>(null);
  const [mine, setMine] = useState<GarageRobot[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setMine(activeRecords(readStore<GarageRobot[]>(GARAGE_KEY, [])));
    setId(readId());
  }, []);

  useEffect(() => {
    if (!id) return;
    setError("");
    const own = mine.find((r) => r.id === id);
    const latest = own?.versions.at(-1);
    if (own && latest) {
      setPicked({ id, name: own.name, spec: latest.spec, estimatedPaths: latest.estimatedPaths, from: "workshop" });
      return;
    }
    if (id === OMEGA1_ROBOT_ID) {
      setPicked({ id, name: "Omega1", spec: omega1SeedSpec(), from: "seed" });
      return;
    }
    const dex = dexRobots.find((r) => robotSlug(r) === id);
    if (!dex?.spec_file) { setPicked(null); setError("That robot isn’t in your Workshop or the Robodex."); return; }
    let live = true;
    fetch(assetPath(dex.spec_file))
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((spec: Spec) => { if (live) setPicked({ id, name: dex.name, spec, from: "robodex" }); })
      .catch(() => { if (live) setError(`Couldn’t load ${dex.name}’s recorded spec.`); });
    return () => { live = false; };
  }, [id, mine]);

  const explainer = useMemo(() => (picked ? buildExplainer(picked.spec, { name: picked.name, estimatedPaths: picked.estimatedPaths }) : null), [picked]);

  const choose = (next: string) => {
    setId(next);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("robot", next);
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  };

  const options = [
    ...mine.map((r) => ({ id: r.id, label: r.name + " · your Workshop" })),
    ...(mine.some((r) => r.id === OMEGA1_ROBOT_ID) ? [] : [{ id: OMEGA1_ROBOT_ID, label: "Omega1 · RobotForge’s own robot" }]),
    ...dexRobots.filter((r) => r.spec_file).map((r) => ({ id: robotSlug(r), label: r.name + " · Robodex" })),
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>How does {picked?.name ?? "it"} work?</h1>
          <p className="lede">Press each step and watch the part doing the work. Every part, wire and number comes from this robot&rsquo;s own record.</p>
        </div>
        <label className="rx-pick">
          <span className="faint">Robot</span>
          <select value={id ?? ""} onChange={(e) => choose(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {picked?.from === "seed" && <p className="faint rx-note">Omega1 isn&rsquo;t in your Workshop, so this uses its documented record from its own code repo. Add it to your Workshop to explain your own copy.</p>}
      {picked?.from === "robodex" && <p className="faint rx-note">Robodex record. Bring it into your Workshop to change it and see the explainer follow.</p>}
      {error && <p className="ws-empty">{error}</p>}
      {explainer && <RobotExplainer key={picked!.id} explainer={explainer} />}
    </>
  );
}
