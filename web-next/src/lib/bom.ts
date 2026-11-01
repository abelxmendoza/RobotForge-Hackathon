/* Bill-of-materials assembly + the wizard's one AI step.
 *
 * Assembly is deterministic and data-only: lines come from the
 * take-apart kits (catalog/parts-kits.json), from the parts
 * catalogue's build templates (catalog/parts.json), or picked from
 * the catalogue by hand. Quantities are the data's own; the wizard
 * may edit them, and every line keeps the label of where it came
 * from.
 *
 * The AI step is ONE structured call: a free-text build description
 * goes to the live endpoint's /list route (Muse Spark through the
 * Worker, which matches lines against this same catalogue), and the
 * answer comes back through the AI SDK's generateObject with a zod
 * schema — the model cannot invent a catalogue id, and the Worker
 * already nulls ids it does not recognise. When the endpoint is not
 * answering, localMatchParts() does a deterministic token match in
 * this browser instead and the UI badges it LOCAL. Functions take
 * the catalogue data as parameters (the chat engine's pattern) so
 * the node tests run the real code against the real data. */
import { z } from "zod";
import { generateObject } from "ai";
import type { KitPart, Part, PartTemplate, RobotKit } from "./types";
import { partSearchQuery, sourcingLinks } from "./sourcing";

export type BomLineKind = "kit-part" | "catalog-part";
export interface BomLine {
  key: string;
  name: string;
  qty: number;
  kind: BomLineKind;
  partId?: string;
  dims?: string;
  note?: string;
  /** Where the line came from, in words: "Andino parts kit",
   *  "template: Rover — differential drive", "live model match",
   *  "local match", "added from the catalogue". */
  sourceLabel: string;
  searchQuery: string;
}

/* ---- assembly -------------------------------------------------------- */

export function kitBomLines(entry: RobotKit): BomLine[] {
  if (!entry.kit) return [];
  return entry.kit.parts.map((p: KitPart) => ({
    key: `kit:${p.file}`,
    name: p.name,
    qty: p.qty,
    kind: "kit-part" as const,
    dims: p.dims,
    note: p.does,
    sourceLabel: `${entry.robot} parts kit`,
    searchQuery: `${p.name} ${p.dims}`,
  }));
}

export function templateBomLines(
  tpl: PartTemplate,
  partsById: Map<string, Part>,
  includeOptional: string[],
): BomLine[] {
  const lines: BomLine[] = [];
  const push = (id: string, qty: number, optional: boolean) => {
    const part = partsById.get(id);
    if (!part) return;
    lines.push({
      key: `part:${id}`,
      name: part.name,
      qty,
      kind: "catalog-part",
      partId: id,
      note: optional ? "optional in this template" : part.used_for,
      sourceLabel: `template: ${tpl.label}${optional ? " (optional)" : ""}`,
      searchQuery: partSearchQuery(part),
    });
  };
  for (const [id, qty] of Object.entries(tpl.required)) push(id, qty, false);
  for (const id of includeOptional) {
    if (tpl.optional.includes(id)) push(id, 1, true);
  }
  return lines;
}

export function catalogBomLine(part: Part, qty: number, sourceLabel: string): BomLine {
  return {
    key: `part:${part.id}`,
    name: part.name,
    qty,
    kind: "catalog-part",
    partId: part.id,
    note: part.used_for,
    sourceLabel,
    searchQuery: partSearchQuery(part),
  };
}

/** Merge lines with the same key, summing quantities; the first
 *  line's labels win, and a merged line says so. */
export function mergeBomLines(lines: BomLine[]): BomLine[] {
  const out: BomLine[] = [];
  const byKey = new Map<string, BomLine>();
  for (const line of lines) {
    const prev = byKey.get(line.key);
    if (prev) {
      prev.qty += line.qty;
      if (!prev.sourceLabel.includes(line.sourceLabel)) {
        prev.sourceLabel = `${prev.sourceLabel} + ${line.sourceLabel}`;
      }
    } else {
      const copy = { ...line };
      byKey.set(line.key, copy);
      out.push(copy);
    }
  }
  return out;
}

/* ---- export ------------------------------------------------------------ */

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomToCsv(lines: BomLine[]): string {
  const head = ["Item", "Qty", "Kind", "Source", "Notes",
    "Octopart", "Digi-Key", "McMaster-Carr", "Amazon", "AliExpress"];
  const rows = lines.map((l) => {
    const links = sourcingLinks(l.searchQuery);
    const byVendor = new Map(links.map((x) => [x.vendor, x.url]));
    return [
      l.name, String(l.qty), l.kind, l.sourceLabel, l.note ?? "",
      byVendor.get("octopart") ?? "", byVendor.get("digikey") ?? "",
      byVendor.get("mcmaster") ?? "", byVendor.get("amazon") ?? "",
      byVendor.get("aliexpress") ?? "",
    ].map(csvCell).join(",");
  });
  return [head.join(","), ...rows].join("\n") + "\n";
}

export function bomToText(lines: BomLine[], title: string): string {
  const out = [`Bill of materials — ${title}`, ""];
  for (const l of lines) {
    out.push(`- ${l.qty} × ${l.name}  [${l.sourceLabel}]`);
    if (l.note) out.push(`    ${l.note}`);
    const links = sourcingLinks(l.searchQuery)
      .map((x) => `${x.label}: ${x.url}`)
      .join("\n    ");
    out.push(`    search: ${links}`);
  }
  out.push("");
  out.push("Vendor links are searches, not listings — no prices or stock are shown, by design.");
  return out.join("\n");
}

/* ---- the structured AI step ------------------------------------------ */

/* The /list route's answer, validated. The Worker sanitises matched
 * ids against its own catalogue mirror; this schema is the second
 * gate, and suggestionsFromImport checks ids against the site's
 * catalogue data a third time — a model-invented id dies at every
 * gate and lands in `unmatched` as plain text instead. */
export const listImportSchema = z.object({
  items: z.array(z.object({
    title: z.string(),
    matched_part_id: z.string().nullable().optional(),
    qty: z.number().positive(),
  })),
  missing: z.array(z.string()).default([]),
});
export type ListImport = z.infer<typeof listImportSchema>;

export interface Suggestion {
  partId: string;
  name: string;
  qty: number;
  title: string;
}

export function suggestionsFromImport(
  imp: ListImport,
  partsById: Map<string, Part>,
): { suggested: Suggestion[]; unmatched: string[]; missing: string[] } {
  const suggested: Suggestion[] = [];
  const unmatched: string[] = [];
  for (const it of imp.items) {
    const part = it.matched_part_id ? partsById.get(it.matched_part_id) : undefined;
    if (part) {
      suggested.push({
        partId: part.id, name: part.name,
        qty: Math.max(1, Math.round(it.qty)), title: it.title,
      });
    } else {
      unmatched.push(it.title);
    }
  }
  return { suggested, unmatched, missing: imp.missing ?? [] };
}

/* A LanguageModelV4 whose one job is to carry the build description
 * to the existing /list route: the endpoint IS the model route (the
 * site never holds a key), so doGenerate POSTs the text and returns
 * the Worker's import object as its text completion, and
 * generateObject validates it against listImportSchema. Token
 * counts are reported as undefined — the endpoint does not meter
 * them back, and inventing numbers is not an option. */
export function workerListModel(
  text: string,
  post: (path: string, body: unknown) => Promise<unknown>,
) {
  return {
    specificationVersion: "v4" as const,
    provider: "robotforge-live-endpoint",
    modelId: "list-route (Muse Spark via the live endpoint)",
    supportedUrls: {},
    async doGenerate() {
      const body = (await post("/list", { text })) as { import?: unknown };
      if (!body || typeof body !== "object" || !("import" in body)) {
        throw new Error("the endpoint answered without an import object");
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(body.import) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(): Promise<never> {
      throw new Error("streaming is not supported by the list-route model");
    },
  };
}

export async function suggestPartsLive(
  text: string,
  post: (path: string, body: unknown) => Promise<unknown>,
): Promise<ListImport> {
  const { object } = await generateObject({
    model: workerListModel(text, post),
    schema: listImportSchema,
    maxRetries: 0,
    prompt:
      "Match this robot build description against the RobotForge parts catalogue " +
      "and return the parts it calls for: " + text,
  });
  return object;
}

/* ---- deterministic local matching (the offline path) ------------------ */

const STOP = new Set(["the", "a", "an", "and", "with", "for", "robot", "build", "want", "need", "some", "that", "this", "from", "into", "make", "using"]);
const NUMWORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/* Crude plural folding, applied to both sides: "gearmotors" and
 * "gearmotor" are the same search word. */
function fold(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

export interface LocalSuggestion extends Suggestion {
  matchedOn: string[];
}

/* Token-overlap matching, fully explainable. A part is suggested
 * when its whole name appears in the description, or at least two
 * of its name/id words do, or one word does that at most two
 * catalogue parts carry (a distinctive word like "rplidar" — a
 * common word like "battery" never matches alone). matchedOn lists
 * exactly which words hit, and the wizard shows them. Quantities
 * come from a numeral written just before the part's first matched
 * word, else 1. */
export function localMatchParts(text: string, parts: Part[]): LocalSuggestion[] {
  const textTokens = tokens(text).map(fold);
  const textSet = new Set(textTokens);
  const lowerText = text.toLowerCase();
  const tokenSets = parts.map((part) => {
    const set = new Set(
      [...tokens(part.name), ...tokens(part.id.replace(/_/g, " "))]
        .map(fold)
        .filter((t) => t.length >= 2 && !STOP.has(t)),
    );
    return { part, set };
  });
  const df = new Map<string, number>();
  for (const { set } of tokenSets) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const out: LocalSuggestion[] = [];
  for (const { part, set } of tokenSets) {
    const hit = [...set].filter((t) => textSet.has(t));
    const phraseHit = lowerText.includes(part.name.toLowerCase());
    const distinctive = hit.length === 1 && hit[0].length >= 4 && (df.get(hit[0]) ?? 99) <= 2;
    if (!phraseHit && hit.length < 2 && !distinctive) continue;
    // quantity: a numeral written immediately before the part's
    // first matched word, else 1. (Distance-1 only, on purpose: a
    // digit two words back is likelier another part's model number
    // — "raspberry pi 5" must not make the lidar quantity 5.)
    let qty = 1;
    const firstIdx = Math.min(
      ...hit.map((t) => textTokens.indexOf(t)).filter((i) => i >= 0),
      phraseHit ? textTokens.length - 1 : Infinity,
    );
    const prev = firstIdx >= 1 ? textTokens[firstIdx - 1] : "";
    if (/^\d+$/.test(prev)) qty = parseInt(prev, 10);
    else if (NUMWORDS[prev]) qty = NUMWORDS[prev];
    out.push({
      partId: part.id, name: part.name, qty,
      title: part.name, matchedOn: phraseHit ? [...hit, "(full name)"] : hit,
    });
  }
  out.sort((a, b) => b.matchedOn.length - a.matchedOn.length || a.name.localeCompare(b.name));
  return out.slice(0, 12);
}
