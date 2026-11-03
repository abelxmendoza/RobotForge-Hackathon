/* Web knowledge loop — the pure core (zero imports, no DOM, so a
 * node-driven pin test can compile and run it standalone, same
 * convention as lib/webIntent.ts).
 *
 * The loop, end to end:
 *   DISCOVER — a live chat turn fetches a product/datasheet page
 *     through the Worker's /web route (PR #133; account-gated,
 *     budget-counted). Only a SCRAPE — one page, one source — can
 *     become a proposal; a search result is many sources at once
 *     and stays an answer, never a record.
 *   PROPOSE — buildWebProposal extracts a structured record from
 *     the fetched text with deterministic rules (below) and the
 *     chat presents it verbatim. Nothing is saved at this step.
 *   CONFIRM — the save happens only after the visitor's explicit
 *     affirmative reply, and is executed by deterministic caller
 *     code (ChatDock), never by the model.
 *   LAND — confirmed records live in the browser-local store under
 *     WEB_PARTS_KEY, alongside the Garage/inventory stores. The
 *     Worker's KV Parts API stays read-only; nothing here writes
 *     to any server.
 *   BUILD — mergeCatalogue feeds confirmed records to the Forge
 *     Engine next to the built-in catalogue, always flagged
 *     WEB-SOURCED — UNVERIFIED, so generated builds that use one
 *     inherit the mark and the engine's checks say so (a WARN).
 *
 * Honesty rules, enforced by validateWebProposal rather than by
 * good intentions:
 * - Every numeric spec carries the exact fetched-text snippet it
 *   was read from (its basis). A proposal whose numeric spec lacks
 *   a basis that literally appears in the fetched text is REJECTED.
 *   Values a unit conversion produced (mA → A, kg → g, kg·cm →
 *   N·m) keep the ORIGINAL snippet as their basis.
 * - A price is carried only when a $ figure literally appears in
 *   the fetched text, and is stored as an estimate with its source
 *   and fetch time. No price, spec, MPN or rating is ever invented:
 *   a field the page does not state stays absent.
 * - Scraped means UNVERIFIED, permanently, until a datasheet or a
 *   measurement confirms the field — the verification label on the
 *   record says exactly that and nothing here ever upgrades it. */

export const WEB_PARTS_KEY = 'rf.webparts.v1';
export const WEB_VERIFICATION = 'WEB-SOURCED — UNVERIFIED';

/* ---------------- shapes ---------------- */

export interface WebProvenance {
  sourceUrl: string;
  fetchedAt: string; // ISO timestamp of the fetch, never of the save
  sourceKind: 'scrape' | 'search';
}

/* One extracted spec field. `sourceText` is the exact snippet of
 * fetched page text the value was read from — the field's basis.
 * Extraction sets it for every field it produces; validation
 * refuses a numeric field without one that appears in the page. */
export interface WebSpecEntry {
  value: number | string;
  sourceText: string;
}

export interface WebPriceEstimate {
  amountUsd: number;
  text: string; // the literal "$…" snippet, as it appears on the page
}

export interface WebPartProposal {
  kind: 'part' | 'tool';
  name: string;
  category: string; // catalogue part_class vocabulary, or 'tools' / 'uncategorised'
  specs: Record<string, WebSpecEntry>;
  priceEstimate: WebPriceEstimate | null;
  provenance: WebProvenance;
  verification: string; // always WEB_VERIFICATION
}

export interface WebPartRecord {
  id: string;
  kind: 'part' | 'tool';
  name: string;
  category: string;
  specs: Record<string, number | string>;
  priceEstimate: (WebPriceEstimate & { sourceUrl: string; fetchedAt: string }) | null;
  provenance: WebProvenance;
  verification: string;
  addedAt: string;
}

/* The structural minimum of a /web scrape result (webIntent's
 * WebScrapeResult satisfies it; this module imports nothing). */
export interface WebScrapeLike {
  mode: 'scrape';
  url: string;
  title?: string;
  markdown: string;
}

/* The Forge Engine's catalogue shape, structurally (forgeEngine's
 * CataloguePart satisfies and is satisfied by this). */
export interface CataloguePartLike {
  id: string;
  name?: string;
  part_class?: string;
  specs?: Record<string, unknown>;
  web_sourced?: boolean;
  provenance?: WebProvenance;
}

/* ---------------- deterministic extraction ---------------- */

const NUM = '(\\d+(?:\\.\\d+)?)';

/* First line (in order) whose lowercase form contains `needle` and
 * that yields a value from `take`. Line-scoped on purpose: a spec
 * is read from the line that states it, never blended across the
 * page. */
function lineValue(
  lines: string[],
  needle: string | RegExp,
  take: (line: string) => WebSpecEntry | null,
): WebSpecEntry | null {
  for (const line of lines) {
    const hit = typeof needle === 'string' ? line.toLowerCase().includes(needle) : needle.test(line);
    if (!hit) continue;
    const v = take(line);
    if (v) return v;
  }
  return null;
}

function numIn(line: string, re: RegExp): { n: number; text: string } | null {
  const m = line.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? { n, text: m[0] } : null;
}

/* Extract the spec fields the fetched text actually states. The
 * field set mirrors what the Forge Engine's checks and the
 * Garage's part→field mapping can consume; anything else on the
 * page is left in the page. Conversions are arithmetic on a stated
 * value, and the entry keeps the stated snippet as its basis. */
export function extractSpecsFromText(markdown: string): Record<string, WebSpecEntry> {
  const lines = String(markdown || '').split(/\r?\n/);
  const specs: Record<string, WebSpecEntry> = {};
  const put = (key: string, e: WebSpecEntry | null) => { if (e && !(key in specs)) specs[key] = e; };

  // Voltage: a range ("4.8-7.2 V") is stored as the range string —
  // the catalogue's own voltage reader accepts both shapes.
  put('voltage_v', lineValue(lines, /voltage/i, (line) => {
    const range = line.match(new RegExp(NUM + '\\s*[-–]\\s*' + NUM + '\\s*V\\b'));
    if (range) return { value: range[1] + '-' + range[2], sourceText: range[0] };
    const single = numIn(line, new RegExp(NUM + '\\s*V\\b'));
    return single ? { value: single.n, sourceText: single.text } : null;
  }));
  // Current: mA converts to A (basis stays the mA snippet).
  put('current_a', lineValue(lines, /current/i, (line) => {
    const ma = numIn(line, new RegExp(NUM + '\\s*mA\\b'));
    if (ma) return { value: Math.round((ma.n / 1000) * 1000) / 1000, sourceText: ma.text };
    const a = numIn(line, new RegExp(NUM + '\\s*A\\b'));
    return a ? { value: a.n, sourceText: a.text } : null;
  }));
  // Stall torque: N·m direct; kg·cm converts (×0.0980665).
  put('stall_torque_nm', lineValue(lines, /torque/i, (line) => {
    const nm = numIn(line, new RegExp(NUM + '\\s*(?:N·m|Nm|N-m)\\b'));
    if (nm) return { value: nm.n, sourceText: nm.text };
    const kgcm = numIn(line, new RegExp(NUM + '\\s*(?:kg·cm|kg-cm|kgcm)\\b'));
    return kgcm ? { value: Math.round(kgcm.n * 0.0980665 * 1000) / 1000, sourceText: kgcm.text } : null;
  }));
  // Mass: kg converts to g (basis stays the kg snippet).
  put('mass_g', lineValue(lines, /(weight|mass)/i, (line) => {
    const kg = numIn(line, new RegExp(NUM + '\\s*kg\\b'));
    if (kg) return { value: Math.round(kg.n * 1000), sourceText: kg.text };
    const g = numIn(line, new RegExp(NUM + '\\s*g\\b'));
    return g ? { value: g.n, sourceText: g.text } : null;
  }));
  // Capacity.
  put('capacity_mah', lineValue(lines, /capacity/i, (line) => {
    const mah = numIn(line, new RegExp(NUM + '\\s*mAh\\b'));
    return mah ? { value: Math.round(mah.n), sourceText: mah.text } : null;
  }));
  // Speed.
  put('rpm', lineValue(lines, /rpm/i, (line) => {
    const r = numIn(line, new RegExp(NUM + '\\s*rpm\\b', 'i'));
    return r ? { value: Math.round(r.n), sourceText: r.text } : null;
  }));
  // Diameter (wheel / disc / motor can): "diameter: 100 mm", "Ø100".
  put('diameter_mm', lineValue(lines, /(diameter|ø)/i, (line) => {
    const d = numIn(line, new RegExp(NUM + '\\s*mm\\b'));
    return d ? { value: d.n, sourceText: d.text } : null;
  }));
  // Dimensions line: "100 × 80 × 20 mm" → length/width/height.
  const dim = String(markdown || '').match(
    new RegExp(NUM + '\\s*[×x]\\s*' + NUM + '(?:\\s*[×x]\\s*' + NUM + ')?\\s*mm\\b'));
  if (dim) {
    specs.length_mm = { value: parseFloat(dim[1]), sourceText: dim[0] };
    specs.width_mm = { value: parseFloat(dim[2]), sourceText: dim[0] };
    if (dim[3]) specs.height_mm = { value: parseFloat(dim[3]), sourceText: dim[0] };
  }
  return specs;
}

/* The first literal $ price in the text, or null. The matched
 * snippet is stored verbatim so validation can prove the figure
 * was on the page. */
export function extractPriceFromText(markdown: string): WebPriceEstimate | null {
  const m = String(markdown || '').match(/\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? { amountUsd: amount, text: m[0] } : null;
}

/* The record's name: the page title when the fetch carried one,
 * else the first markdown heading, else the first usable line.
 * A name is presentation, not a spec — but an empty name is a
 * failed proposal (validation refuses it). */
export function extractName(result: WebScrapeLike): string {
  const title = String(result.title || '').replace(/\s+/g, ' ').trim();
  if (title) return title.slice(0, 120);
  for (const line of String(result.markdown || '').split(/\r?\n/)) {
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) return h[1].replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  for (const line of String(result.markdown || '').split(/\r?\n/)) {
    const t = line.replace(/[#>*_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length >= 3) return t.slice(0, 120);
  }
  return '';
}

/* Category from page keywords, in the catalogue's part_class
 * vocabulary (tools and the honest 'uncategorised' aside). First
 * matching rule wins; the order goes specific before generic. */
const CATEGORY_RULES: { re: RegExp; category: string; kind: 'part' | 'tool' }[] = [
  { re: /(soldering|multimeter|crimp(er|ing) tool|oscilloscope|bench supply|tool ?kit|screwdriver|hex driver)/i, category: 'tools', kind: 'tool' },
  { re: /(motor driver|h-bridge|dual.*driver|stepper driver)/i, category: 'drivers', kind: 'part' },
  { re: /(flight controller)/i, category: 'flight_control', kind: 'part' },
  { re: /(raspberry pi(?! pico)|jetson|single[- ]board)/i, category: 'sbc', kind: 'part' },
  { re: /(teensy|arduino|stm32|raspberry pi pico|microcontroller)/i, category: 'microcontrollers', kind: 'part' },
  { re: /(gearmotor|servo|dc motor|brushless|stepper motor|linear actuator)/i, category: 'actuators', kind: 'part' },
  { re: /(gripper)/i, category: 'end_effectors', kind: 'part' },
  { re: /(lipo|li-ion|liion|lithium|battery)/i, category: 'power', kind: 'part' },
  { re: /(propeller|\bprops?\b)/i, category: 'propulsion_air', kind: 'part' },
  { re: /(camera|lidar|ultrasonic|imu|sensor|encoder)/i, category: 'cameras_sensors', kind: 'part' },
  { re: /\bwheel\b/i, category: 'wheels', kind: 'part' },
  { re: /(fuse|circuit breaker)/i, category: 'safety_protection', kind: 'part' },
  { re: /(radio|receiver|transmitter|telemetry)/i, category: 'comms', kind: 'part' },
  { re: /(cable|connector|harness)/i, category: 'cables_connectors', kind: 'part' },
  { re: /(filament|\bpla\b|\bpetg\b)/i, category: 'materials', kind: 'part' },
  { re: /(frame|chassis|bracket|mount)/i, category: 'structure', kind: 'part' },
];

export function classifyCategory(name: string, markdown: string): { category: string; kind: 'part' | 'tool' } {
  const hay = name + '\n' + String(markdown || '').slice(0, 4000);
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(hay)) return { category: rule.category, kind: rule.kind };
  }
  return { category: 'uncategorised', kind: 'part' };
}

/* ---------------- proposal build + validation ---------------- */

/* Build a proposal from ONE scrape result. Returns null for
 * anything that is not a scrape (a search is not a record source)
 * or when validation rejects what extraction produced — the caller
 * then presents no proposal at all, never a partial one. */
export function buildWebProposal(
  result: WebScrapeLike,
  fetchedAt: string,
): WebPartProposal | null {
  if (!result || result.mode !== 'scrape' || !result.url) return null;
  const markdown = String(result.markdown || '');
  if (!markdown.trim()) return null;
  const { category, kind } = classifyCategory(extractName(result), markdown);
  const proposal: WebPartProposal = {
    kind,
    name: extractName(result),
    category,
    specs: extractSpecsFromText(markdown),
    priceEstimate: extractPriceFromText(markdown),
    provenance: { sourceUrl: result.url, fetchedAt, sourceKind: 'scrape' },
    verification: WEB_VERIFICATION,
  };
  return validateWebProposal(proposal, markdown).length === 0 ? proposal : null;
}

/* The honesty gate. Returns a list of problems; empty = the
 * proposal may be presented. `fetchedText` is the exact markdown
 * the proposal was derived from. */
export function validateWebProposal(p: WebPartProposal, fetchedText: string): string[] {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return ['proposal is not an object'];
  if (!String(p.name || '').trim()) errors.push('name is empty — a record needs the name the page gives it');
  if (p.kind !== 'part' && p.kind !== 'tool') errors.push('kind must be part or tool');
  if (!/^https?:\/\//i.test(String(p.provenance?.sourceUrl || ''))) {
    errors.push('provenance.sourceUrl is not an http(s) URL');
  }
  if (p.verification !== WEB_VERIFICATION) {
    errors.push('verification label must be exactly "' + WEB_VERIFICATION + '"');
  }
  const text = String(fetchedText || '');
  for (const [key, entry] of Object.entries(p.specs || {})) {
    if (!entry || typeof entry !== 'object' || !('value' in entry)) {
      errors.push('spec "' + key + '" has no value');
      continue;
    }
    if (typeof entry.value === 'number') {
      // THE basis rule: a numeric spec must name the fetched-text
      // snippet it was read from, and that snippet must be there.
      if (!entry.sourceText || !text.includes(entry.sourceText)) {
        errors.push('spec "' + key + '" lacks a fetched-text basis (its source snippet is absent from the fetched page)');
      }
    }
  }
  if (p.priceEstimate) {
    if (!p.priceEstimate.text || !text.includes(p.priceEstimate.text)) {
      errors.push('price estimate is not literally in the fetched text');
    }
    const parsed = parseFloat(String(p.priceEstimate.text || '').replace(/[$,]/g, ''));
    if (!Number.isFinite(parsed) || Math.abs(parsed - p.priceEstimate.amountUsd) > 0.005) {
      errors.push('price amount does not match its literal text');
    }
  }
  return errors;
}

/* ---------------- proposal presentation (chat text) ---------------- */

export interface ProposalFieldChange { path: string; before: unknown; after: unknown }

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return String(parseFloat(v.toPrecision(6)));
  return String(v);
}

/* The in-chat presentation of a proposal: the record's fields,
 * its provenance and its UNVERIFIED label, then the confirm ask.
 * Plain text — the chat renders it as a normal message; there is
 * no proposal UI. `target` describes a robot-directed proposal:
 * with field changes it lists old → new per field; additionOnly
 * means the part is recorded on the robot as a planned addition
 * (no spec field maps to it). */
export function formatProposalText(
  p: WebPartProposal,
  target?: { robotName: string; changes?: ProposalFieldChange[]; additionOnly?: boolean },
): string {
  const lines: string[] = [];
  lines.push(
    'Web proposal — ' + (p.kind === 'tool' ? 'tool' : 'part') + ': ' + p.name,
    'Category: ' + p.category + ' · Status: ' + p.verification,
  );
  const specKeys = Object.keys(p.specs);
  if (specKeys.length) {
    lines.push('Specs read from the page:');
    for (const k of specKeys) lines.push('  · ' + k + ': ' + fmtVal(p.specs[k].value));
  } else {
    lines.push('Specs read from the page: none stated that I can record — the record would carry the name and source only.');
  }
  if (p.priceEstimate) {
    lines.push('Price estimate: ' + p.priceEstimate.text + ' (from the page, fetched ' + p.provenance.fetchedAt.slice(0, 10) + ' — an estimate, not a quote)');
  }
  lines.push('Source: ' + p.provenance.sourceUrl + ' (fetched ' + p.provenance.fetchedAt.slice(0, 10) + ')');
  if (target && target.changes && target.changes.length) {
    lines.push('On “' + target.robotName + '” this changes:');
    for (const c of target.changes) lines.push('  · ' + c.path + ': ' + fmtVal(c.before) + ' → ' + fmtVal(c.after));
    lines.push('Saving creates a NEW version of “' + target.robotName + '”; the current version stays untouched.');
  } else if (target && target.additionOnly) {
    lines.push('On “' + target.robotName + '” no spec field maps to this part, so it would be recorded as a PLANNED addition on a new version — planned, not built or installed.');
  } else if (target) {
    lines.push('For “' + target.robotName + '”: no field changes follow from this part — it would land in your web parts list only.');
  }
  lines.push('Nothing is saved yet. Reply “yes” to save it, or “no” to discard it.');
  return lines.join('\n');
}

/* The confirmation reply after a save actually landed: exactly
 * what was saved, with its labels — never a vaguer success. */
export function formatSavedText(record: WebPartRecord, robotName?: string): string {
  const fields = Object.keys(record.specs).length;
  return (
    'Saved “' + record.name + '” ' +
    (robotName ? 'for “' + robotName + '” ' : 'to your web parts list ') +
    '— ' + record.category + ', ' + fields + ' spec field' + (fields === 1 ? '' : 's') +
    ', ' + record.verification + '. Source: ' + record.provenance.sourceUrl + '.' +
    (record.priceEstimate ? ' Price estimate kept: ' + record.priceEstimate.text + ' (sourced, timestamped).' : '')
  );
}

/* ---------------- add/update intent + reply classification ---------------- */

/* An add/update intent rides on an imperative: the message opens
 * with an add verb, or says add/use/save/install/fit THIS. A
 * question (trailing '?', or opening with a question word) is
 * never an add intent — questions get answers, not proposals.
 * The caller additionally requires a scrape (a pasted URL). */
export function detectWebAddIntent(text: string): { kind: 'add' } | { kind: 'robot'; robotName: string } | null {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const opensImperative = /^(add|save|keep|install|fit|use|swap|upgrade|mount)\b/i.test(t);
  const saysThis = /\b(add|save|use|install|fit|keep)\s+this\b/i.test(t);
  if (!opensImperative && !saysThis) return null;
  if (/\?\s*$/.test(t) && !opensImperative) return null;
  // The named robot runs up to the pasted URL or the end of the
  // message ("use this driver for Omega1 https://…" — the link
  // almost always comes last).
  const forRobot = t.match(/\b(?:for|to|on)\s+(?:my\s+)?["']?([A-Za-z][A-Za-z0-9 _.'-]{1,40}?)["']?(?=\s+https?:\/\/|\s*[.!?]*$)/i);
  if (forRobot && opensImperative) {
    const name = forRobot[1].trim();
    // "add this to my build / list / garage" names destinations,
    // not robots — those stay plain adds.
    if (!/^(build|list|garage|parts|inventory|collection)$/i.test(name)) {
      return { kind: 'robot', robotName: name };
    }
  }
  return { kind: 'add' };
}

/* The visitor's answer to a pending proposal. Deliberately a
 * closed set: an exact-ish short affirmative or negative. Anything
 * else is 'ambiguous' — the caller re-asks once when the reply is
 * short, and treats a longer reply as a new topic (the proposal is
 * discarded, the message processed normally). */
export type ProposalReply = 'confirm' | 'discard' | 'ambiguous';

export function classifyProposalReply(text: string): ProposalReply {
  const t = String(text || '').trim().replace(/\s+/g, ' ').replace(/[.!,]+$/, '');
  if (/^(yes|yeah|yep|yup|ok|okay|sure|confirm|add it|add|save it|save|do it|go ahead|please do|land it)$/i.test(t)) return 'confirm';
  if (/^(no|nope|cancel|discard|drop it|don't|do not|never ?mind|stop|forget it|not now)$/i.test(t)) return 'discard';
  return 'ambiguous';
}

export function isShortReply(text: string): boolean {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length <= 5;
}

/* ---------------- the local store (pure list ops) ---------------- */

/* A stable id from the record's own identity: re-adding the same
 * page for the same part refreshes the same record instead of
 * piling up duplicates. */
export function webRecordId(p: { name: string; provenance: WebProvenance }): string {
  const slug = (p.name + ' ' + p.provenance.sourceUrl)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  let h = 5381;
  const s = p.provenance.sourceUrl + '|' + p.name;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'web-' + slug + '-' + h.toString(16).slice(0, 6);
}

/* Land a confirmed proposal as a record (pure projection: specs
 * keep their values; the bases stay behind in the proposal — the
 * record's provenance is the standing evidence). */
export function proposalToRecord(p: WebPartProposal, addedAt: string): WebPartRecord {
  const specs: Record<string, number | string> = {};
  for (const [k, e] of Object.entries(p.specs)) specs[k] = e.value;
  return {
    id: webRecordId(p),
    kind: p.kind,
    name: p.name,
    category: p.category,
    specs,
    priceEstimate: p.priceEstimate
      ? { ...p.priceEstimate, sourceUrl: p.provenance.sourceUrl, fetchedAt: p.provenance.fetchedAt }
      : null,
    provenance: p.provenance,
    verification: p.verification,
    addedAt,
  };
}

/* Insert or refresh (same id replaces). Returns a NEW list. */
export function addWebRecord(list: WebPartRecord[], record: WebPartRecord): WebPartRecord[] {
  const at = list.findIndex((r) => r.id === record.id);
  if (at >= 0) return list.map((r, i) => (i === at ? record : r));
  return [...list, record];
}

export function removeWebRecord(list: WebPartRecord[], id: string): WebPartRecord[] {
  return list.filter((r) => r.id !== id);
}

/* ---------------- engine integration ---------------- */

/* A confirmed web record as a catalogue entry: same id space as
 * its record, specs as plain values, permanently flagged. */
export function toCataloguePart(r: WebPartRecord): CataloguePartLike {
  return {
    id: r.id,
    name: r.name,
    part_class: r.category,
    specs: { ...r.specs },
    web_sourced: true,
    provenance: r.provenance,
  };
}

/* The Forge Engine's catalogue view: built-in parts first, then
 * confirmed web parts. A web record whose id collides with a
 * built-in id is dropped — the catalogue of record always wins,
 * and a web page may never shadow it. */
export function mergeCatalogue(
  builtin: readonly CataloguePartLike[],
  records: readonly WebPartRecord[],
): CataloguePartLike[] {
  const have = new Set(builtin.map((p) => p.id));
  const out: CataloguePartLike[] = [...builtin];
  for (const r of records) {
    if (have.has(r.id)) continue;
    have.add(r.id);
    out.push(toCataloguePart(r));
  }
  return out;
}

/* ---------------- robot additions (spec transform) ---------------- */

/* Record a confirmed web part on a robot's spec as a PLANNED
 * addition — the same added_parts shape the chat's catalogue save
 * uses, but with honest provenance: recorded_from names the web
 * source, never the parts catalogue. Pure spec → spec; the caller
 * wraps it in a new version. Already-recorded (same id) is a
 * no-op the caller reports as such. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recordWebAddition(
  spec: Record<string, unknown> | null | undefined,
  record: WebPartRecord,
): { spec: Record<string, unknown>; already: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const next: Record<string, any> = JSON.parse(JSON.stringify(spec ?? {}));
  const existing: unknown[] = Array.isArray(next.added_parts) ? next.added_parts : [];
  if (existing.some((e) => e && typeof e === 'object' && (e as { id?: string }).id === record.id)) {
    return { spec: next, already: true };
  }
  next.added_parts = [...existing, {
    id: record.id,
    name: record.name,
    part_class: record.category,
    recorded_from: 'web — ' + record.provenance.sourceUrl,
    recorded_via: 'chat web proposal (confirmed)',
    verification: record.verification,
  }];
  return { spec: next, already: false };
}
