"use client";

import { useMemo, useState } from "react";
import { parts, partsKits, physicsOf } from "@/lib/data";
import type { Part } from "@/lib/types";
import type { BomLine } from "@/lib/bom";
import { readStore, useStore, downloadJSON } from "@/lib/store";
import { isWiring, type Wiring } from "@/lib/wiring";
import {
  DEFAULT_PROFILE, MATERIAL_OPTIONS, PHASE_ORDER, PROFILE_KEY, TOOL_OPTIONS,
  bomLinePlanItems, generateBuildPlan, isBuildWiring, kitFileIndex,
  planToMarkdown, wiringFromBuildWiring,
  type BuildPlan, type CheckState, type ConstraintsProfile, type PlanStep,
  type SourcedPrice,
} from "@/lib/buildPlan";
import { BUILD_KEY } from "@/lib/buildList";
import type { BuildEntry } from "@/lib/palette";

/* Build plan + real-life constraints, inside the BOM wizard's
 * review step. The plan and every check are computed by the
 * deterministic engine in lib/buildPlan.ts from the wizard's
 * current lines and the visitor's constraints profile — no model
 * call, no Worker, demo-safe. The profile persists through the
 * store, so it gets a ".demo" twin in demo mode like every other
 * visitor-data store. */

const partsById = new Map<string, Part>(parts.map((p) => [p.id, p]));
const kitsByFile = kitFileIndex(partsKits);

const STATE_STYLE: Record<CheckState, { label: string; color: string }> = {
  blocked: { label: "BLOCKED", color: "#b3261e" },
  warn: { label: "WARNING", color: "#9a6a00" },
  not_checked: { label: "NOT CHECKED", color: "#5f6368" },
  pass: { label: "PASS", color: "#137333" },
};

function Badge({ state, title }: { state: CheckState; title?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span style={{
      border: `1px solid ${s.color}`, color: s.color, borderRadius: 999,
      padding: "0 8px", fontSize: "var(--fs-sm)", whiteSpace: "nowrap",
    }}>
      {title ? `${title}: ` : ""}{s.label}
    </span>
  );
}

export default function BuildPlanPanel({ lines, title, kitSlug }: {
  lines: BomLine[];
  title: string;
  kitSlug?: string;
}) {
  const [profile, saveProfile] = useStore<ConstraintsProfile>(PROFILE_KEY, DEFAULT_PROFILE);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const items = useMemo(
    () => bomLinePlanItems(lines, partsById, kitsByFile),
    [lines],
  );
  const physics = kitSlug ? physicsOf(kitSlug) : undefined;
  const plan: BuildPlan = useMemo(() => {
    let wiring: Wiring | null = null;
    try {
      const saved = readStore<unknown>("rf.wiring.v1", null);
      if (isWiring(saved)) {
        wiring = saved;
      } else if (isBuildWiring(saved)) {
        /* The Kit wiring view's shape: adapt it so the power check
         * judges the wiring the visitor actually drew. */
        const entries = readStore<BuildEntry[]>(BUILD_KEY, []);
        wiring = wiringFromBuildWiring(saved, entries, partsById);
      }
    } catch { /* no saved wiring — the power check abstains in writing */ }
    return generateBuildPlan({
      title,
      items,
      profile,
      partsById,
      robotMassKg: physics?.catalog_mass_kg ?? null,
      robotMassLabel: physics?.catalog_mass_label,
      wiring,
    });
  }, [title, items, profile, physics]);

  const patch = (p: Partial<ConstraintsProfile>) => {
    const err = saveProfile({ ...profile, ...p });
    setSaveNote(err);
  };
  const toggleList = (key: "materialsOnHand" | "toolsOnHand", value: string) => {
    const cur = profile[key];
    patch({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Partial<ConstraintsProfile>);
  };
  const numOr = (v: string): number | null => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const downloadMd = () => {
    const blob = new Blob([planToMarkdown(plan)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robotforge-build-plan.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = plan.summary;
  const checkById = new Map(plan.checks.map((c) => [c.id, c]));
  const buyItems = items.filter((i) => i.role === "buy");

  return (
    <section className="section" style={{ marginTop: 24 }}>
      <h2>Build plan &amp; real-life constraints</h2>
      <p className="sub">
        A phased plan for this build, checked against your printer, materials,
        tools, budget and time. Every check reads only recorded catalogue/kit
        data and your constraints below — anything the data doesn&apos;t cover
        is marked <strong>NOT CHECKED</strong>, never passed silently. Estimates
        are labeled; the app invents no prices, dimensions or ratings.
      </p>

      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip">{s.steps} steps</span>
        <Badge state="blocked" title={`${s.blockers}`} />
        <Badge state="warn" title={`${s.warnings}`} />
        <Badge state="not_checked" title={`${s.notChecked}`} />
        <Badge state="pass" title={`${s.passes}`} />
        {s.notChecked > 0 ? (
          <span className="faint">
            {s.notChecked} check(s) could not be verified from recorded data — this plan is not “all clear”.
          </span>
        ) : null}
      </p>

      <details>
        <summary><strong>Your constraints</strong> — printer, materials, tools, budget, time
          <span className="faint"> (defaults shown until you set yours; saved in this browser)</span>
        </summary>
        <div className="card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label>Bed X (mm)<br />
              <input type="number" min={1} value={profile.bedXmm} style={{ width: 80 }}
                onChange={(e) => { const n = numOr(e.target.value); if (n) patch({ bedXmm: n }); }} />
            </label>
            <label>Bed Y (mm)<br />
              <input type="number" min={1} value={profile.bedYmm} style={{ width: 80 }}
                onChange={(e) => { const n = numOr(e.target.value); if (n) patch({ bedYmm: n }); }} />
            </label>
            <label>Bed Z (mm)<br />
              <input type="number" min={1} value={profile.bedZmm} style={{ width: 80 }}
                onChange={(e) => { const n = numOr(e.target.value); if (n) patch({ bedZmm: n }); }} />
            </label>
            <label>Nozzle (mm)<br />
              <input type="number" min={0.1} step={0.1} value={profile.nozzleMm} style={{ width: 80 }}
                onChange={(e) => { const n = numOr(e.target.value); if (n) patch({ nozzleMm: n }); }} />
            </label>
            <label>Bench space (mm)<br />
              <input type="number" min={1} value={profile.workspaceMm} style={{ width: 80 }}
                onChange={(e) => { const n = numOr(e.target.value); if (n) patch({ workspaceMm: n }); }} />
            </label>
            <label>Budget ceiling ($, optional)<br />
              <input type="number" min={0} value={profile.budgetCeiling ?? ""} style={{ width: 110 }}
                placeholder="no ceiling"
                onChange={(e) => patch({ budgetCeiling: numOr(e.target.value) })} />
            </label>
            <label>Time available (hours, optional)<br />
              <input type="number" min={0} value={profile.timeAvailableHours ?? ""} style={{ width: 110 }}
                placeholder="no limit"
                onChange={(e) => patch({ timeAvailableHours: numOr(e.target.value) })} />
            </label>
            <label>Build lives<br />
              <select value={profile.environment}
                onChange={(e) => patch({ environment: e.target.value as ConstraintsProfile["environment"] })}>
                <option value="indoor">Indoors</option>
                <option value="outdoor">Outdoors / heat / sun</option>
              </select>
            </label>
            <label>Experience<br />
              <select value={profile.experience}
                onChange={(e) => patch({ experience: e.target.value as ConstraintsProfile["experience"] })}>
                <option value="first">First build</option>
                <option value="some">Some builds</option>
                <option value="experienced">Experienced</option>
              </select>
            </label>
          </div>
          <p style={{ marginTop: 12 }}><strong>Materials on hand</strong><br />
            {MATERIAL_OPTIONS.map((m) => (
              <label key={m} style={{ marginRight: 14 }}>
                <input type="checkbox" checked={profile.materialsOnHand.includes(m)}
                  onChange={() => toggleList("materialsOnHand", m)} /> {m}
              </label>
            ))}
          </p>
          <p style={{ marginTop: 8 }}><strong>Tools on hand</strong><br />
            {TOOL_OPTIONS.map((t) => (
              <label key={t.id} style={{ marginRight: 14 }}>
                <input type="checkbox" checked={profile.toolsOnHand.includes(t.id)}
                  onChange={() => toggleList("toolsOnHand", t.id)} /> {t.label}
              </label>
            ))}
          </p>
          {buyItems.length ? (
            <div style={{ marginTop: 8 }}>
              <strong>Prices (optional)</strong>
              <span className="faint"> — your own price, or a sourced estimate recorded from a
                supplier page (supplier + link + when you fetched it). The app never invents
                one, and live price fetching is not wired up yet — a line with no record
                stays unpriced. Shipping, tax and stock are always unknowns, never folded in.</span>
              <div className="table-scroll" style={{ marginTop: 6 }}>
                <table className="data">
                  <thead>
                    <tr><th>Item</th><th>Your price</th><th>Sourced estimate</th><th>Supplier</th><th>Source link</th><th>Qty break</th><th>Source kind / trust</th></tr>
                  </thead>
                  <tbody>
                    {buyItems.map((i) => {
                      const sp = profile.sourcedPrices[i.key];
                      const setSourced = (p: Partial<SourcedPrice>) => {
                        const sourcedPrices = { ...profile.sourcedPrices };
                        const next = { ...(sourcedPrices[i.key] ?? { amount: NaN, supplier: "", url: "", fetchedAt: "" }), ...p };
                        if (!Number.isFinite(next.amount) && !next.supplier && !next.url) {
                          delete sourcedPrices[i.key];
                        } else {
                          next.fetchedAt = new Date().toISOString();
                          sourcedPrices[i.key] = next;
                        }
                        patch({ sourcedPrices });
                      };
                      return (
                        <tr key={i.key}>
                          <td>{i.name}
                            {sp && Number.isFinite(sp.amount) ? (
                              sp.sourceKind === "web_gathered" ? (
                                <><br /><span style={{
                                  border: "1px solid #b06000", color: "#b06000", borderRadius: 999,
                                  padding: "0 8px", fontSize: "var(--fs-sm)", whiteSpace: "nowrap",
                                }}>web-gathered estimate</span>
                                <br /><span className="faint">fetched {sp.fetchedAt} · {sp.verification ?? "web_gathered"}</span></>
                              ) : (
                                <><br /><span className="faint">ESTIMATE — fetched {sp.fetchedAt}</span></>
                              )
                            ) : (
                              <><br /><span className="faint">no sourced price recorded</span></>
                            )}
                          </td>
                          <td>
                            $<input type="number" min={0} step="0.01" style={{ width: 90 }}
                              value={profile.prices[i.key] ?? ""}
                              placeholder="—"
                              aria-label={`Your price for ${i.name}`}
                              onChange={(e) => {
                                const n = numOr(e.target.value);
                                const prices = { ...profile.prices };
                                if (n === null) delete prices[i.key]; else prices[i.key] = n;
                                patch({ prices });
                              }} />
                          </td>
                          <td>
                            $<input type="number" min={0} step="0.01" style={{ width: 90 }}
                              value={sp && Number.isFinite(sp.amount) ? sp.amount : ""}
                              placeholder="—"
                              aria-label={`Sourced estimate for ${i.name}`}
                              onChange={(e) => setSourced({ amount: numOr(e.target.value) ?? NaN })} />
                          </td>
                          <td>
                            <input type="text" style={{ width: 110 }} value={sp?.supplier ?? ""}
                              placeholder="e.g. Digi-Key"
                              aria-label={`Supplier for ${i.name}`}
                              onChange={(e) => setSourced({ supplier: e.target.value })} />
                          </td>
                          <td>
                            <input type="url" style={{ width: 150 }} value={sp?.url ?? ""}
                              placeholder="https://…"
                              aria-label={`Source link for ${i.name}`}
                              onChange={(e) => setSourced({ url: e.target.value })} />
                          </td>
                          <td>
                            <input type="text" style={{ width: 90 }} value={sp?.qtyBreak ?? ""}
                              placeholder="optional"
                              aria-label={`Quantity break for ${i.name}`}
                              onChange={(e) => setSourced({ qtyBreak: e.target.value })} />
                          </td>
                          <td>
                            <select value={sp?.sourceKind ?? "user_entered"}
                              aria-label={`Source kind for ${i.name}`}
                              onChange={(e) => setSourced({ sourceKind: e.target.value as SourcedPrice["sourceKind"] })}>
                              <option value="user_entered">I recorded it</option>
                              <option value="api">Supplier API</option>
                              <option value="web_gathered">Web-gathered by Muse</option>
                            </select>
                            {sp?.sourceKind === "web_gathered" ? (
                              <>
                                <br />
                                <select value={sp?.verification ?? "web_gathered"} style={{ marginTop: 4 }}
                                  aria-label={`Verification state for ${i.name}`}
                                  onChange={(e) => setSourced({ verification: e.target.value as SourcedPrice["verification"] })}>
                                  <option value="web_gathered">Web-gathered (unverified)</option>
                                  <option value="cross_checked">Cross-checked</option>
                                  <option value="confirmed">Confirmed</option>
                                </select>
                                <br />
                                <input type="text" style={{ width: 170, marginTop: 4 }} value={sp?.snippet ?? ""}
                                  placeholder="Quoted snippet it came from"
                                  aria-label={`Receipt snippet for ${i.name}`}
                                  onChange={(e) => setSourced({ snippet: e.target.value })} />
                              </>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {saveNote ? <p className="state-box">{saveNote}</p> : null}
        </div>
      </details>

      <h3 style={{ marginTop: 20 }}>Checks</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Check</th><th>State</th><th>What the recorded data says</th></tr></thead>
          <tbody>
            {plan.checks.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td><Badge state={c.state} /></td>
                <td>
                  {c.detail}
                  {c.fix ? <><br /><em>Fix: {c.fix}</em></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {PHASE_ORDER.map((phase) => {
        const phaseSteps = plan.steps.filter((st) => st.phase === phase);
        if (!phaseSteps.length) return null;
        return (
          <div key={phase} style={{ marginTop: 20 }}>
            <h3>{phase}</h3>
            {phaseSteps.map((st) => (
              <StepCard key={st.id} step={st} checkById={checkById} />
            ))}
          </div>
        );
      })}

      <p style={{ marginTop: 16 }}>
        <button type="button" className="primary" onClick={downloadMd}>
          Download plan (Markdown)
        </button>{" "}
        <button type="button" onClick={() => downloadJSON("robotforge-build-plan.json", plan)}>
          Download plan (JSON)
        </button>
      </p>
    </section>
  );
}

function StepCard({ step, checkById }: {
  step: PlanStep;
  checkById: Map<string, BuildPlan["checks"][number]>;
}) {
  const badges = step.checkIds
    .map((id) => checkById.get(id))
    .filter((c) => c && c.state !== "pass");
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: 0 }}>
        <strong>{step.title}</strong>
        {step.advanced ? <span className="chip">advanced step</span> : null}
        {badges.map((c) => (
          <Badge key={c!.id} state={c!.state} title={c!.title} />
        ))}
      </p>
      {step.items.length ? <p style={{ margin: "6px 0 0" }}>Parts: {step.items.join("; ")}</p> : null}
      {step.tools.length ? <p style={{ margin: "4px 0 0" }}>Tools: {step.tools.join(", ")}</p> : null}
      {step.materials.length ? <p style={{ margin: "4px 0 0" }}>Materials: {step.materials.join(", ")}</p> : null}
      {step.estMinutes ? (
        <p style={{ margin: "4px 0 0" }}>
          Time: ~{step.estMinutes.min}–{step.estMinutes.max} min
          <span className="faint"> ({step.timeLabel ?? "estimate"})</span>
        </p>
      ) : null}
      {step.note ? <p style={{ margin: "4px 0 0" }}>{step.note}</p> : null}
      <p style={{ margin: "4px 0 0" }}><em>Checkpoint:</em> {step.checkpoint}</p>
    </div>
  );
}
