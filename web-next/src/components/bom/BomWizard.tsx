"use client";

import { useEffect, useMemo, useState } from "react";
import { parts, partsKits, partTemplates, simReadyProps } from "@/lib/data";
import type { Part, SimReadyPropEntry } from "@/lib/types";
import { useStore } from "@/lib/store";
import { BUILD_KEY } from "@/lib/buildList";
import { buildListToBomLines, type BuildEntry } from "@/lib/palette";
import {
  catalogBomLine, kitBomLines, localMatchParts, mergeBomLines,
  suggestPartsLive, suggestionsFromImport, templateBomLines,
  bomToCsv, bomToText, type BomLine, type LocalSuggestion, type Suggestion,
} from "@/lib/bom";
import { liveHealth, postJSON, routeOn } from "@/components/forge/live";
import SourcingLinks from "@/components/robots/SourcingLinks";

/* The BOM wizard: three steps over the site's real parts data.
 * Start from a robot's take-apart kit, a catalogue build template,
 * the shared build list (Parts palette + chat adds) or empty,
 * configure what the data supports (template optionals,
 * quantities, catalogue picks, one AI suggestion step), then review
 * and export. The AI step is badged honestly: LIVE when the live
 * endpoint's model answered, LOCAL when the deterministic in-browser
 * matcher did — including when the endpoint was tried and failed. */

type Start =
  | { kind: "kit"; slug: string }
  | { kind: "template"; name: string }
  | { kind: "build" }
  | { kind: "blank" };

interface AiOutcome {
  mode: "live" | "local";
  note: string;
  suggested: (Suggestion & { matchedOn?: string[] })[];
  unmatched: string[];
  missing: string[];
}

const partsById = new Map<string, Part>(parts.map((p) => [p.id, p]));
const propsById = new Map<string, SimReadyPropEntry>(
  simReadyProps.map((p) => [p.id, p]),
);

export default function BomWizard() {
  const kitSlugs = useMemo(
    () => Object.entries(partsKits).filter(([, e]) => e.kit).map(([slug]) => slug),
    [],
  );
  const [step, setStep] = useState(1);
  const [start, setStart] = useState<Start>({ kind: "blank" });
  const [optionals, setOptionals] = useState<string[]>([]);
  const [extra, setExtra] = useState<BomLine[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>({});
  const [addPick, setAddPick] = useState<string>(parts[0]?.id ?? "");
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<AiOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  /* The shared build list (Parts palette + chat): a fourth start.
   * It is read live, so parts added on the Kit page while this
   * wizard is open arrive here too. */
  const [buildEntries] = useStore<BuildEntry[]>(BUILD_KEY, []);

  // Deep links: /bom/?kit=<slug> or /bom/?template=<name> pre-pick
  // the starting point (the robot pages' parts-kit sections link in);
  // /bom/?start=build starts from the shared build list.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const kit = q.get("kit");
    const tpl = q.get("template");
    if (kit && partsKits[kit]?.kit) {
      setStart({ kind: "kit", slug: kit });
      setStep(2);
    } else if (tpl && partTemplates.some((t) => t.name === tpl)) {
      setStart({ kind: "template", name: tpl });
      setStep(2);
    } else if (q.get("start") === "build") {
      setStart({ kind: "build" });
      setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseLines = useMemo<BomLine[]>(() => {
    if (start.kind === "kit") {
      const entry = partsKits[start.slug];
      return entry ? kitBomLines(entry) : [];
    }
    if (start.kind === "template") {
      const tpl = partTemplates.find((t) => t.name === start.name);
      return tpl ? templateBomLines(tpl, partsById, optionals) : [];
    }
    if (start.kind === "build") {
      return buildListToBomLines(buildEntries, partsById, propsById);
    }
    return [];
  }, [start, optionals, buildEntries]);

  const lines = useMemo(() => {
    const merged = mergeBomLines([...baseLines, ...extra]);
    return merged
      .filter((l) => !removed.has(l.key))
      .map((l) => ({ ...l, qty: qtyEdit[l.key] ?? l.qty }));
  }, [baseLines, extra, removed, qtyEdit]);

  const title = useMemo(() => {
    if (start.kind === "kit") return partsKits[start.slug]?.robot ?? "kit";
    if (start.kind === "template") return partTemplates.find((t) => t.name === start.name)?.label ?? "build";
    if (start.kind === "build") return "your build list";
    return "custom build";
  }, [start]);

  const pickStart = (s: Start) => {
    setStart(s);
    setOptionals([]);
    setExtra([]);
    setRemoved(new Set());
    setQtyEdit({});
    setAi(null);
  };

  const runAi = async () => {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAi(null);
    const localFallback = (note: string): AiOutcome => ({
      mode: "local",
      note,
      suggested: localMatchParts(text, parts),
      unmatched: [],
      missing: [],
    });
    try {
      const h = await liveHealth();
      if (!routeOn(h, "list")) {
        setAi(localFallback("The live endpoint is not answering, so this match ran locally in your browser against the catalogue — no model was involved."));
      } else {
        try {
          const imp = await suggestPartsLive(text, (p, b) => postJSON(p, b));
          const s = suggestionsFromImport(imp, partsById);
          setAi({
            mode: "live",
            note: "Matched by the live model (Muse Spark through the live endpoint) against the site's parts catalogue, then validated in your browser against the catalogue itself — a part the catalogue does not have cannot come back as a match.",
            suggested: s.suggested,
            unmatched: s.unmatched,
            missing: s.missing,
          });
        } catch {
          setAi(localFallback("The live model call failed, so this match ran locally in your browser against the catalogue instead — no model output is in it."));
        }
      }
    } finally {
      setAiBusy(false);
    }
  };

  const addSuggestion = (s: Suggestion & { matchedOn?: string[] }, mode: "live" | "local") => {
    const part = partsById.get(s.partId);
    if (!part) return;
    const line = catalogBomLine(part, s.qty, mode === "live" ? "live model match" : "local match");
    setExtra((prev) => [...prev, line]);
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(line.key);
      return next;
    });
  };

  const downloadCsv = () => {
    const blob = new Blob([bomToCsv(lines)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robotforge-bom.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(bomToText(lines, title));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const tpl = start.kind === "template" ? partTemplates.find((t) => t.name === start.name) : undefined;

  return (
    <div>
      <nav className="jump" aria-label="Wizard steps">
        {["1 · Start", "2 · Configure", "3 · Review & export"].map((label, i) => (
          <button
            key={label}
            type="button"
            className="chip"
            aria-current={step === i + 1 ? "step" : undefined}
            onClick={() => setStep(i + 1)}
          >
            {label}
          </button>
        ))}
      </nav>

      {step === 1 ? (
        <section className="section">
          <h2>Start from real parts data</h2>
          <p className="sub">
            A bill of materials is only as honest as its source. Start from a
            robot&apos;s generated take-apart kit, from one of the parts
            catalogue&apos;s build templates, or from nothing and describe
            the build — every line keeps the label of where it came from.
          </p>
          <div className="card">
            <h3 style={{ fontSize: "var(--fs-md)" }}>A robot&apos;s parts kit</h3>
            {kitSlugs.map((slug) => (
              <p key={slug} style={{ marginTop: 8 }}>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={start.kind === "kit" && start.slug === slug}
                    onChange={() => pickStart({ kind: "kit", slug })}
                  />{" "}
                  {partsKits[slug].robot} — {partsKits[slug].kit?.parts.length} printable kit parts
                  {partsKits[slug].kit?.estimated ? " (ESTIMATED kit — photo-drafted spec)" : ""}
                </label>
              </p>
            ))}
            <p className="prov" style={{ marginTop: 8 }}>
              <span>
                Robots without a kit (the catalogue records why on their
                pages) cannot start a BOM here — parts are never invented
                for an entry.
              </span>
            </p>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: "var(--fs-md)" }}>A build template</h3>
            {partTemplates.map((t) => (
              <p key={t.name} style={{ marginTop: 8 }}>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={start.kind === "template" && start.name === t.name}
                    onChange={() => pickStart({ kind: "template", name: t.name })}
                  />{" "}
                  {t.label} — {Object.keys(t.required).length} required catalogue parts,{" "}
                  {t.optional.length} optional
                </label>
              </p>
            ))}
          </div>
          {buildEntries.length ? (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: "var(--fs-md)" }}>Your build list</h3>
              <p style={{ marginTop: 8 }}>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={start.kind === "build"}
                    onChange={() => pickStart({ kind: "build" })}
                  />{" "}
                  The parts you added from the Parts palette on the Kit
                  page or by asking the assistant in chat —{" "}
                  {buildEntries.reduce((s, e) => s + e.qty, 0)} item
                  {buildEntries.reduce((s, e) => s + e.qty, 0) === 1 ? "" : "s"}.
                </label>
              </p>
            </div>
          ) : null}
          <div className="card" style={{ marginTop: 12 }}>
            <p>
              <label>
                <input
                  type="radio"
                  name="start"
                  checked={start.kind === "blank"}
                  onChange={() => pickStart({ kind: "blank" })}
                />{" "}
                Start empty — describe the build in step 2 and add parts by hand.
              </label>
            </p>
          </div>
          <p style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={() => setStep(2)}>
              Continue to configure →
            </button>
          </p>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="section">
          <h2>Configure — {title}</h2>
          {tpl ? (
            <div className="card">
              <h3 style={{ fontSize: "var(--fs-md)" }}>Template options</h3>
              <p className="sub">
                The options the template data itself supports — nothing
                else is configurable, because nothing else is recorded.
              </p>
              {tpl.optional.map((id) => {
                const part = partsById.get(id);
                if (!part) return null;
                return (
                  <p key={id} style={{ marginTop: 6 }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={optionals.includes(id)}
                        onChange={(e) =>
                          setOptionals((prev) =>
                            e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                          )
                        }
                      />{" "}
                      {part.name}
                    </label>
                  </p>
                );
              })}
            </div>
          ) : null}

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <h3 style={{ fontSize: "var(--fs-md)" }}>Describe your build</h3>
              <span className={`fbadge ${ai ? (ai.mode === "live" ? "live" : "local") : "local"}`}>
                {ai ? (ai.mode === "live" ? "LIVE" : "LOCAL") : "LIVE or LOCAL"}
              </span>
            </div>
            <p className="sub">
              One structured step: your description goes to the live
              endpoint&apos;s parts matcher (Muse Spark) when it is
              answering, and the reply is validated against the catalogue
              before anything is suggested. When it is not answering, the
              same step runs as a deterministic token match in your
              browser and is badged LOCAL.
            </p>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              rows={3}
              style={{ width: "100%" }}
              placeholder="e.g. a differential-drive rover with a Raspberry Pi 5, two 12 V gearmotors, an RPLidar and a 4S LiPo"
            />
            <p style={{ marginTop: 8 }}>
              <button type="button" className="primary" onClick={runAi} disabled={aiBusy || !aiText.trim()}>
                {aiBusy ? "Matching…" : "Suggest parts from my description"}
              </button>
            </p>
            {ai ? (
              <div style={{ marginTop: 12 }}>
                <p className="prov"><span>{ai.note}</span></p>
                {ai.suggested.length ? (
                  <ul className="items" style={{ marginTop: 8 }}>
                    {ai.suggested.map((s) => (
                      <li key={s.partId} style={{ marginTop: 6 }}>
                        <strong>{s.name}</strong> ×{s.qty}
                        {"matchedOn" in s && s.matchedOn?.length ? (
                          <span className="faint"> — matched on: {s.matchedOn.join(", ")}</span>
                        ) : null}{" "}
                        <button type="button" onClick={() => addSuggestion(s, ai.mode)}>
                          Add to BOM
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="state-box" style={{ marginTop: 8 }}>
                    No catalogue parts matched that description. Nothing was
                    added — try naming parts the way the catalogue does.
                  </p>
                )}
                {ai.unmatched.length ? (
                  <p className="prov" style={{ marginTop: 8 }}>
                    <span>
                      Named but not in the catalogue (kept as text, never
                      added): {ai.unmatched.join(" · ")}
                    </span>
                  </p>
                ) : null}
                {ai.missing.length ? (
                  <p className="prov" style={{ marginTop: 8 }}>
                    <span>
                      A build like this would still need: {ai.missing.join(" · ")}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: "var(--fs-md)" }}>Add a catalogue part by hand</h3>
            <p style={{ marginTop: 8 }}>
              <select value={addPick} onChange={(e) => setAddPick(e.target.value)}>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>{" "}
              <button
                type="button"
                onClick={() => {
                  const part = partsById.get(addPick);
                  if (part) setExtra((prev) => [...prev, catalogBomLine(part, 1, "added from the catalogue")]);
                }}
              >
                Add
              </button>
            </p>
          </div>

          <LineEditor
            lines={lines}
            onQty={(key, qty) => setQtyEdit((prev) => ({ ...prev, [key]: qty }))}
            onRemove={(key) => setRemoved((prev) => new Set(prev).add(key))}
          />
          <p style={{ marginTop: 16 }}>
            <button type="button" onClick={() => setStep(1)}>← Back</button>{" "}
            <button type="button" className="primary" onClick={() => setStep(3)}>
              Review & export →
            </button>
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="section">
          <h2>Review & export — {title}</h2>
          <p className="sub">
            {lines.length} line{lines.length === 1 ? "" : "s"},{" "}
            {lines.reduce((s, l) => s + l.qty, 0)} items total. Vendor links
            are searches built from each part&apos;s name and recorded
            specs — no prices, stock or availability are shown, here or in
            the exports.
          </p>
          {lines.length ? (
            <>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr><th>Item</th><th>Qty</th><th>From</th><th>Search it</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.key}>
                        <td>
                          {l.name}
                          {l.dims ? <span className="faint"> — {l.dims}</span> : null}
                        </td>
                        <td className="num">{l.qty}</td>
                        <td>{l.sourceLabel}</td>
                        <td><SourcingLinks query={l.searchQuery} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginTop: 16 }}>
                <button type="button" className="primary" onClick={downloadCsv}>
                  Download CSV
                </button>{" "}
                <button type="button" onClick={copyText}>
                  {copied ? "Copied ✓" : "Copy as text"}
                </button>
              </p>
            </>
          ) : (
            <p className="state-box">
              The BOM is empty — go back and start from a kit or template,
              or add parts in step 2.
            </p>
          )}
          <p style={{ marginTop: 16 }}>
            <button type="button" onClick={() => setStep(2)}>← Back to configure</button>
          </p>
        </section>
      ) : null}
    </div>
  );
}

function LineEditor({ lines, onQty, onRemove }: {
  lines: BomLine[];
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
}) {
  if (!lines.length) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="state-box">No lines yet — this starting point contributes none until you add parts.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: "var(--fs-md)" }}>Lines so far</h3>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="data">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>From</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={l.qty}
                    style={{ width: 64 }}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 1) onQty(l.key, v);
                    }}
                    aria-label={`Quantity for ${l.name}`}
                  />
                </td>
                <td>{l.sourceLabel}</td>
                <td>
                  <button type="button" onClick={() => onRemove(l.key)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
