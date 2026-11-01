/* The Parts Palette: one catalogue for the Kit page's parts grid,
 * the drag-and-drop stage, and the chat's build commands.
 *
 * The palette is the parts catalogue (catalog/parts.json — real,
 * datasheet-sourced parts) plus the NVIDIA SimReady bench props
 * (catalog/props/simready/props.json — external CC BY 4.0 models).
 * Those props are the only palette items with a 3D model, so they
 * are the only ones that can be placed in the kit scene; catalogue
 * parts join the build list only, and the UI says so on the card.
 *
 * Picture provenance: the catalogue's part images are AI
 * illustrations (the Parts catalogue captions them as such), so the
 * palette never presents them as part photos — catalogue cards
 * carry a labelled no-image placeholder. Prop cards show a live
 * render of the actual GLB (PropThumb), never a stock photo.
 *
 * Reality badges mirror the inventory split (lib/inventory.ts
 * `reality`): catalogue parts are 'real' (physical parts a builder
 * buys — the sourcing links exist for exactly that); bench props
 * are 'sim_only' (virtual assets, never owned stock). parts.json
 * itself carries no reality field; the split is applied here by
 * item kind and stated, not hidden.
 *
 * The build list is the shared list the palette, the chat and the
 * BOM wizard all read and write (stored by lib/buildList.ts under
 * rf.build.v1). Functions take the catalogue data as parameters
 * (the bom.ts pattern) so the node tests run the real code against
 * the real data.
 */
import type { Part, SimReadyPropEntry } from "./types";
import { catalogBomLine, mergeBomLines, type BomLine } from "./bom";
import { partSearchQuery } from "./sourcing";

/* ---------------- palette items ---------------- */

export type PaletteItemKind = "catalog-part" | "bench-prop";

export interface PaletteItem {
  /** 'part:<catalogue id>' or 'prop:<prop id>' — also the drag key. */
  key: string;
  kind: PaletteItemKind;
  refId: string;
  name: string;
  /** One line of recorded spec (or the part's recorded use). */
  specLine: string;
  /** Where the item comes from, in words. */
  sourceLabel: string;
  /** Mirrors the inventory reality split (see module comment). */
  reality: "real" | "sim_only";
  /** Only bench props have a 3D model (a GLB in the scene). */
  hasModel: boolean;
  part?: Part;
  prop?: SimReadyPropEntry;
}

function partSpecLine(part: Part): string {
  const specs = part.specs ?? {};
  const entries = Object.entries(specs).slice(0, 3);
  if (entries.length) {
    return entries
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
      .join(" · ");
  }
  return part.used_for ?? "";
}

/* Bench props first (they are the ones with pictures and models),
 * then the catalogue in the Parts catalogue's own (class, name)
 * order — plain codepoint order, like PartsCatalogue. */
export function buildPaletteItems(
  parts: Part[],
  props: SimReadyPropEntry[],
): PaletteItem[] {
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const propItems: PaletteItem[] = props.map((prop) => ({
    key: `prop:${prop.id}`,
    kind: "bench-prop" as const,
    refId: prop.id,
    name: prop.name,
    specLine: `${prop.size_m.map((v) => v.toFixed(2)).join(" × ")} m · glTF model`,
    sourceLabel: "NVIDIA SimReady · CC BY 4.0",
    reality: "sim_only" as const,
    hasModel: true,
    prop,
  }));
  const partItems: PaletteItem[] = [...parts]
    .sort((a, b) => cmp(a.part_class, b.part_class) || cmp(a.name, b.name))
    .map((part) => ({
      key: `part:${part.id}`,
      kind: "catalog-part" as const,
      refId: part.id,
      name: part.name,
      specLine: partSpecLine(part),
      sourceLabel: part.source ?? "RobotForge parts catalogue",
      reality: "real" as const,
      hasModel: false,
      part,
    }));
  return [...propItems, ...partItems];
}

/* ---------------- the build list ---------------- */

export interface BuildEntry {
  uid: string;
  kind: PaletteItemKind;
  refId: string;
  /** Catalogue parts: how many. Bench props: always 1 — each entry
   *  is one placed instance, and the BOM line sums the instances. */
  qty: number;
  via: "palette" | "chat";
  /** Scene placement [x, y] in metres (the stage is Z-up, ground
   *  plane z=0). Bench props only; null for catalogue parts. */
  pos: [number, number] | null;
}

/* Deterministic slots for props added without a drop point (the
 * Add button, chat): around the robot, inside the 0.55 m ground
 * disc, clear of the kit itself. */
const SLOT_ANGLES_DEG = [140, 40, 220, 320, 90, 270];
export function defaultScenePos(index: number): [number, number] {
  const angle = ((SLOT_ANGLES_DEG[index % SLOT_ANGLES_DEG.length]) * Math.PI) / 180;
  const radius = index < SLOT_ANGLES_DEG.length ? 0.37 : 0.45;
  return [
    Math.round(radius * Math.cos(angle) * 1000) / 1000,
    Math.round(radius * Math.sin(angle) * 1000) / 1000,
  ];
}

/* Add `qty` of an item. Catalogue parts merge into their existing
 * entry (quantities sum). Bench props get one entry per instance,
 * placed at explicitPos (a drag drop) for the first instance and at
 * deterministic slots for the rest. */
export function addToBuildList(
  entries: BuildEntry[],
  item: PaletteItem,
  qty: number,
  via: "palette" | "chat",
  makeUid: () => string,
  explicitPos?: [number, number],
): BuildEntry[] {
  const n = Math.max(1, Math.floor(qty));
  if (item.kind === "catalog-part") {
    const existing = entries.find(
      (e) => e.kind === "catalog-part" && e.refId === item.refId,
    );
    if (existing) {
      return entries.map((e) =>
        e === existing ? { ...e, qty: e.qty + n } : e,
      );
    }
    return [
      ...entries,
      {
        uid: makeUid(),
        kind: item.kind,
        refId: item.refId,
        qty: n,
        via,
        pos: null,
      },
    ];
  }
  const placed = entries.filter(
    (e) => e.kind === "bench-prop" && e.pos,
  ).length;
  const next = [...entries];
  for (let i = 0; i < n; i++) {
    next.push({
      uid: makeUid(),
      kind: item.kind,
      refId: item.refId,
      qty: 1,
      via,
      pos:
        i === 0 && explicitPos
          ? explicitPos
          : defaultScenePos(placed + i),
    });
  }
  return next;
}

export function removeFromBuildList(
  entries: BuildEntry[],
  uid: string,
): BuildEntry[] {
  return entries.filter((e) => e.uid !== uid);
}

export function setBuildQty(
  entries: BuildEntry[],
  uid: string,
  qty: number,
): BuildEntry[] {
  const n = Math.max(1, Math.floor(qty));
  return entries.map((e) =>
    e.uid === uid && e.kind === "catalog-part" ? { ...e, qty: n } : e,
  );
}

/* The build list as BOM lines — the same BomLine shape the wizard
 * assembles from kits and templates, merged by key, so a part the
 * palette and a template both name sums instead of duplicating.
 * Entries whose id is no longer in the data are skipped (the data
 * moved; inventing the part back would be worse). */
export function buildListToBomLines(
  entries: BuildEntry[],
  partsById: Map<string, Part>,
  propsById: Map<string, SimReadyPropEntry>,
): BomLine[] {
  const SOURCE = "Your build list (palette & chat)";
  const lines: BomLine[] = [];
  for (const e of entries) {
    if (e.kind === "catalog-part") {
      const part = partsById.get(e.refId);
      if (part) lines.push(catalogBomLine(part, e.qty, SOURCE));
    } else {
      const prop = propsById.get(e.refId);
      if (prop) {
        lines.push({
          key: `prop:${prop.id}`,
          name: prop.name,
          qty: 1,
          kind: "catalog-part",
          note: "Bench prop — NVIDIA SimReady (CC BY 4.0), sim only",
          sourceLabel: SOURCE,
          searchQuery: `${prop.name} ${prop.source_package.replace(/_/g, " ")}`,
        });
      }
    }
  }
  return mergeBomLines(lines);
}

/* ---------------- deterministic matching ----------------
 * Mirrors the rules of bom.ts localMatchParts (the wizard's offline
 * matcher), applied per request segment: a part matches when its
 * whole name appears in the phrase, or at least two of its name/id
 * words do, or one word does that at most two palette items carry
 * (a distinctive word like "rplidar"). A tie at the top is reported
 * as ambiguous — never resolved by guessing. */

const STOP = new Set([
  "the", "a", "an", "and", "with", "for", "robot", "build", "want",
  "need", "some", "that", "this", "from", "into", "make", "using",
]);
const NUMWORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function tokensOf(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function fold(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

interface ItemTokens {
  item: PaletteItem;
  set: Set<string>;
}

function itemTokenSets(items: PaletteItem[]): ItemTokens[] {
  return items.map((item) => ({
    item,
    set: new Set(
      [...tokensOf(item.name), ...tokensOf(item.refId.replace(/_/g, " "))]
        .map(fold)
        .filter((t) => t.length >= 2 && !STOP.has(t)),
    ),
  }));
}

export type PhraseMatch =
  | { status: "match"; item: PaletteItem; matchedOn: string[] }
  | { status: "ambiguous"; options: PaletteItem[]; matchedOn: string[] }
  | { status: "none" };

export function matchPhrase(
  phrase: string,
  items: PaletteItem[],
): PhraseMatch {
  const phraseTokens = tokensOf(phrase).map(fold);
  const phraseSet = new Set(phraseTokens);
  const lowerPhrase = phrase.toLowerCase();
  if (!phraseTokens.length) return { status: "none" };
  const sets = itemTokenSets(items);
  const df = new Map<string, number>();
  for (const { set } of sets) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const scored: { item: PaletteItem; hit: string[]; phraseHit: boolean }[] = [];
  const weak: { item: PaletteItem; hit: string[] }[] = [];
  for (const { item, set } of sets) {
    const hit = [...set].filter((t) => phraseSet.has(t));
    const phraseHit = lowerPhrase.includes(item.name.toLowerCase());
    const distinctive =
      hit.length === 1 && hit[0].length >= 4 && (df.get(hit[0]) ?? 99) <= 2;
    if (!phraseHit && hit.length < 2 && !distinctive) {
      /* A single common word ("battery", "motor") never matches on
       * its own — but it is not "not in the palette" either: keep
       * the carriers as ambiguity candidates for the reply. */
      if (hit.length === 1) weak.push({ item, hit });
      continue;
    }
    scored.push({ item, hit, phraseHit });
  }
  if (!scored.length) {
    if (weak.length) {
      return {
        status: "ambiguous",
        options: weak.map((w) => w.item),
        matchedOn: weak[0].hit,
      };
    }
    return { status: "none" };
  }
  scored.sort(
    (a, b) =>
      Number(b.phraseHit) - Number(a.phraseHit) ||
      b.hit.length - a.hit.length ||
      a.item.name.localeCompare(b.item.name),
  );
  const top = scored[0];
  const tied = scored.filter(
    (s) => s.phraseHit === top.phraseHit && s.hit.length === top.hit.length,
  );
  if (tied.length > 1) {
    return {
      status: "ambiguous",
      options: tied.map((s) => s.item),
      matchedOn: top.hit,
    };
  }
  return {
    status: "match",
    item: top.item,
    matchedOn: top.phraseHit ? [...top.hit, "(full name)"] : top.hit,
  };
}

/* ---------------- the chat build command ---------------- */

export interface BuildAdd {
  item: PaletteItem;
  qty: number;
}
export interface BuildAmbiguous {
  phrase: string;
  qty: number;
  options: string[];
}
export interface BuildRequest {
  adds: BuildAdd[];
  /** Request phrases (as typed, quantity stripped) that match no
   *  palette item — the reply names them, never drops them. */
  notFound: string[];
  ambiguous: BuildAmbiguous[];
}

/* "to my build", "into the build list", "in my kit", … at the end of
 * the request marks it as addressed to the build list. */
const TARGET_RE =
  /\s+(?:to|into|in|on|for)\s+(?:my\s+|the\s+)?(build(?:\s+list)?|parts\s+list|kit|palette)\s*$/i;

/* Parse "add a RealSense camera and two wheels to my build".
 * Returns null when the text is not a build-list request at all:
 * no add verb, a quoted name (the robot-directed grammars' shape),
 * a leftover "to <somewhere else>", a named robot, or — with no
 * explicit build target — nothing that resolves, so the caller's
 * other paths (the live translator included) still get their turn.
 * When the target IS explicit, an all-miss request still returns a
 * result: the user addressed the build list and deserves the
 * not-found names back, not a detour. */
export function parseBuildRequest(
  raw: string,
  items: PaletteItem[],
  robotNames: string[],
): BuildRequest | null {
  const q = raw.trim().replace(/[.\s]+$/, "");
  const verb = /^(add|put|include)\s+/i.exec(q);
  if (!verb) return null;
  let rest = q.slice(verb[0].length).trim();
  if (!rest || /"[^"]+"/.test(rest)) return null;
  let explicitTarget = false;
  const target = TARGET_RE.exec(rest);
  if (target) {
    explicitTarget = true;
    rest = rest.slice(0, target.index).trim();
  }
  if (/\bto\b/i.test(rest)) return null;
  const lowerRest = rest.toLowerCase();
  for (const name of robotNames) {
    if (name && lowerRest.includes(name.toLowerCase())) return null;
  }
  const segments = rest
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  const adds = new Map<string, BuildAdd>();
  const notFound: string[] = [];
  const ambiguous: BuildAmbiguous[] = [];
  for (const segment of segments) {
    let qty = 1;
    let phrase = segment;
    const numLead = /^(\d+)\s+(.+)$/.exec(segment);
    const wordLead = /^([a-z]+)\s+(.+)$/i.exec(segment);
    if (numLead) {
      qty = parseInt(numLead[1], 10);
      phrase = numLead[2].trim();
    } else if (wordLead && NUMWORDS[wordLead[1].toLowerCase()]) {
      qty = NUMWORDS[wordLead[1].toLowerCase()];
      phrase = wordLead[2].trim();
    } else if (wordLead && /^(a|an)$/i.test(wordLead[1])) {
      phrase = wordLead[2].trim();
    }
    if (!phrase) continue;
    const m = matchPhrase(phrase, items);
    if (m.status === "match") {
      const prev = adds.get(m.item.key);
      if (prev) prev.qty += qty;
      else adds.set(m.item.key, { item: m.item, qty });
    } else if (m.status === "ambiguous") {
      ambiguous.push({
        phrase,
        qty,
        options: m.options.map((o) => o.name),
      });
    } else {
      notFound.push(phrase);
    }
  }
  const result: BuildRequest = {
    adds: [...adds.values()],
    notFound,
    ambiguous,
  };
  if (!result.adds.length && !result.ambiguous.length && !explicitTarget) {
    return null;
  }
  return result;
}

/* The chat's plain confirmation: what was added with quantities,
 * and what wasn't — ambiguous phrases with the candidates named,
 * unknown phrases named as not in the palette. Nothing is silently
 * dropped, and no line claims an add that didn't happen. */
export function buildConfirmationText(req: BuildRequest): string {
  const out: string[] = [];
  if (req.adds.length) {
    out.push(
      "Added to your build list: " +
        req.adds.map((a) => `${a.qty} × ${a.item.name}`).join(" · ") +
        ".",
    );
  } else {
    out.push("Nothing was added to your build list.");
  }
  for (const a of req.ambiguous) {
    const names = a.options.slice(0, 4).join(" · ") +
      (a.options.length > 4 ? " · …" : "");
    out.push(
      `“${a.phrase}” matches more than one palette part (${names}) — ` +
        "name the one you mean and I'll add it.",
    );
  }
  if (req.notFound.length) {
    out.push(
      "Not in the palette: " +
        req.notFound.map((p) => `“${p}”`).join(" · ") +
        " — nothing was added for those.",
    );
  }
  out.push(
    "The build list lives in the Parts palette on the Kit page.",
  );
  return out.join("\n");
}
