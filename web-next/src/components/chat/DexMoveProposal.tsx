"use client";
/* Preview card for a Robodex recategorization (Wrench chat:
 * 'move "Spot" to sighted'). Same preview -> Apply shape as the
 * other chat operations: nothing is written until Apply. A move
 * to My robots brings the robot into the Workshop through the
 * existing save-to-Garage construction (lib/saveRobot); every
 * other move only rewrites the filing override
 * (lib/dexOverrides). A blocked plan (no recorded spec to bring
 * in) renders the honest reason and no Apply button. */
import { useRef } from "react";
import { GARAGE_KEY, type GarageRobot, type Spec } from "@/lib/garage";
import { readStore, uid, writeStore } from "@/lib/store";
import { buildDexEntry } from "@/lib/saveRobot";
import { loadDexOverrides, saveDexOverrides } from "@/lib/dexOverrides";
import { applyDexMove, type DexMovePlan } from "@/lib/dexCategorize";
import { assetPath } from "@/components/home/asset";

export default function DexMoveProposal({ plan, onDone, onCancel }: {
  plan: DexMovePlan;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const consumed = useRef(false);
  const apply = async () => {
    if (consumed.current) return;
    consumed.current = true;
    try {
      if (plan.bringIn) {
        const garage = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const already = garage.some(
          (r) => r.name.toLowerCase() === plan.entity.name.toLowerCase(),
        );
        if (!already) {
          const nowIso = new Date().toISOString();
          let entry: GarageRobot;
          if (plan.entity.kind === "catalog" && plan.entity.specFile) {
            const r = await fetch(assetPath(plan.entity.specFile));
            if (!r.ok) throw new Error("HTTP " + r.status);
            const spec = (await r.json()) as Spec;
            entry = buildDexEntry(
              { name: plan.entity.name, slug: plan.entity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), specFile: plan.entity.specFile },
              spec, nowIso, { robot: uid("robot"), version: uid("v") },
            );
          } else if (plan.entity.draftSpec) {
            entry = {
              id: uid("robot"),
              name: plan.entity.name,
              createdAt: nowIso,
              versions: [{
                id: uid("v"),
                label: "Baseline",
                note: `Started from the Robodex sighting of ${plan.entity.name} — its recorded photo-draft spec, unchanged. Photo-estimated: sizes came from a photograph, not measurements.`,
                source: "photo",
                createdAt: nowIso,
                spec: JSON.parse(JSON.stringify(plan.entity.draftSpec)) as Spec,
              }],
            };
          } else {
            throw new Error("No recorded spec to bring in.");
          }
          const err = writeStore(GARAGE_KEY, [...garage, entry]);
          if (err) throw new Error(err);
        }
      }
      const err = saveDexOverrides(applyDexMove(loadDexOverrides(), plan));
      if (err) throw new Error(err);
      onDone("Robodex filing saved: " + plan.summary);
    } catch (e) {
      onDone((e as Error).message);
    }
  };
  return (
    <div className="fc-msg bot" role="region" aria-label="Robodex filing preview">
      <strong>{plan.dest === null ? "Reset categorization" : "Move in the Robodex"}</strong>
      <p>{plan.summary}</p>
      {plan.blocked ? (
        <>
          <p>{plan.blocked}</p>
          <button type="button" className="btn btn-sm" onClick={onCancel}>OK</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
            Apply filing change
          </button>{" "}
          <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
        </>
      )}
    </div>
  );
}
