/* Forge Guide answer engine — pure and DOM-free.
 *
 * TypeScript port of assets/js/chat-engine.js (the source of truth).
 * Every answer is assembled from RobotForge's recorded data at runtime:
 * catalog/robots.json, catalog/parts.json and catalog/gate-reports.json,
 * plus the intent table in chat-intents.json. Robot and part facts are
 * never hardcoded here; if the data doesn't say it, the answer says so.
 *
 * Live-model hook: this local engine ALWAYS answers first, from the
 * recorded data, and its answers stay the default. Only when an
 * answer is the honest fallback (flagged `fallback: true` below) may
 * the chat UI offer the question to a live model — and only when a
 * deployment has configured the live endpoint (the UI's live config;
 * CONFIG.endpoint here stays '' and is a legacy override). Live
 * replies are badged as model output in the UI; this module's
 * contract ({html, chips, hits, fallback}) is unchanged.
 *
 * Route mapping (the one deliberate difference from the vanilla
 * engine): vanilla links point at app/robots/…, app/evidence/ and
 * app/forge/ under a site root. In the Next app those pages live at
 * /robots/…, /evidence/ and /forge/, so every generated link goes
 * through routePath(), which strips the legacy "app/" prefix and
 * roots the path at "/". The `root` data field is still accepted
 * and honoured as a prefix.
 */

export const CONFIG: { endpoint: string } = { endpoint: "" };

/* ---------------- data shapes (the catalog JSON, loosely typed) ------ */

export interface GateRunData {
  drive_error_pct?: number | null;
  heading_error_deg?: number | null;
  odometry_distance_error_pct?: number | null;
  odometry_heading_error_deg?: number | null;
  [key: string]: unknown;
}

export interface StaticCheckData {
  type: string;
  grade: string;
  tip_angle_deg: number;
  weakest_margin_mm: number;
  weakest_direction: string;
  date: string;
  [key: string]: unknown;
}

export interface RobotData {
  number: number | string;
  name: string;
  class: string;
  description: string;
  spec_file?: string;
  key_specs?: Record<string, unknown>;
  provenance?: {
    source_name?: string;
    source_url?: string;
    license?: string;
    note?: string;
    [key: string]: unknown;
  };
  checks?: StaticCheckData[] | null;
  gate_status?: {
    status?: string;
    note?: string;
    runs?: GateRunData[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PartData {
  id: string;
  name: string;
  part_class?: string;
  blurb?: string;
  used_for?: string;
  robot_types?: string[];
  specs?: Record<string, unknown>;
  notes?: string;
  source?: string;
  license?: string;
  [key: string]: unknown;
}

export interface TemplateData {
  name: string;
  label: string;
  required?: Record<string, number>;
  optional?: string[];
  [key: string]: unknown;
}

export interface KindParamData {
  label: string;
  default: string | number;
  unit?: string;
  [key: string]: unknown;
}

export interface KindData {
  id: string;
  label: string;
  one_liner: string;
  gate_pack: string;
  gate_note?: string;
  reference: string;
  bom_hints?: string[];
  params?: KindParamData[];
  [key: string]: unknown;
}

export interface ReportCheckData {
  name: string;
  error: number | string;
  unit?: string;
  [key: string]: unknown;
}

export interface ReportRunData {
  id?: string;
  title?: string;
  doc?: {
    verdict?: string;
    checks?: ReportCheckData[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ReportsData {
  runs?: ReportRunData[];
  [key: string]: unknown;
}

export interface TopicData {
  keywords?: string[];
  answer?: string;
  link?: { label: string; route: string };
  handler?: string;
  samples?: string[];
  [key: string]: unknown;
}

export interface IntentsData {
  topics?: TopicData[];
  suggestions?: string[];
  [key: string]: unknown;
}

export interface EngineData {
  robots?: RobotData[];
  parts?: PartData[];
  templates?: number;
  templateList?: TemplateData[];
  kinds?: KindData[];
  reports?: ReportsData | null;
  intents?: IntentsData | null;
  root?: string;
}

export interface Hit {
  kind: string;
  id?: string;
  label: string;
  route?: string;
}

export interface AnswerResult {
  html: string;
  chips?: string[];
  hits?: Hit[];
  fallback?: boolean;
}

export interface Engine {
  answer: (question: string) => AnswerResult;
  suggestions: string[];
  CONFIG: { endpoint: string };
}

interface CtxData {
  robots: RobotData[];
  parts: PartData[];
  templates: number;
  templateList: TemplateData[];
  kinds: KindData[];
  reports: ReportsData | null;
}

interface Ctx {
  data: CtxData;
  root: string;
  noData: (route: string, label: string) => string;
}

/* ---------------- helpers (ported 1:1) ---------------- */

const VLABEL: Record<string, string> = {
  PASS: "Pass",
  MARGINAL: "Marginal",
  FAIL: "Fail",
  NOT_GATED: "Not gated",
};

export function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalize(s: unknown): string {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: unknown): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

/* True when phrase's tokens appear consecutively in qtoks. */
export function phraseIn(qtoks: string[], phrase: string): boolean {
  const pt = tokens(phrase);
  if (!pt.length || pt.length > qtoks.length) return false;
  for (let i = 0; i + pt.length <= qtoks.length; i++) {
    let ok = true;
    for (let j = 0; j < pt.length; j++) {
      if (qtoks[i + j] !== pt[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function slugify(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fmt(v: unknown): string | null {
  return v == null ? null : String(parseFloat(Number(v).toFixed(3)));
}

function dexId(robot: RobotData): string {
  const n = String(robot.number);
  return "#" + ("00" + n).slice(-3);
}

/* Map a vanilla site path ("app/robots/x/", "app/evidence/", …) to
 * the Next app's route ("/robots/x/", "/evidence/", …), honouring
 * the engine root as a prefix. */
function routePath(root: string, path: string): string {
  const p = path.replace(/^app\//, "");
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return base + p;
}

function robotPage(root: string, robot: RobotData): string {
  return routePath(root, "app/robots/" + slugify(robot.name) + "/");
}

/* ---------------- robot matching ---------------- */

interface RobotKey {
  text: string;
  score: number;
}

function robotKeys(robot: RobotData): RobotKey[] {
  const toks = tokens(robot.name);
  const keys: RobotKey[] = [{ text: robot.name, score: 10 }];
  if (toks.length > 1) {
    const last = toks[toks.length - 1];
    /* >= 3 so model designators like "go2" and "op3" resolve; both
       are distinctive, unlike a bare "g1" (2 chars, stays unmatched) */
    if (last.length >= 3) keys.push({ text: last, score: 8 });
    if (toks.length > 2) {
      keys.push({ text: toks.slice(-2).join(" "), score: 8 });
      /* distinctive middle token: "waffle" in TurtleBot3 Waffle Pi */
      toks.slice(1, -1).forEach((t) => {
        if (t.length >= 5) keys.push({ text: t, score: 8 });
      });
    }
  }
  const num = String(robot.number);
  keys.push({ text: "#" + ("00" + num).slice(-3), score: 6 });
  keys.push({ text: ("00" + num).slice(-3), score: 6 });
  return keys;
}

interface RobotHitScore {
  robot: RobotData;
  score: number;
}

function findRobots(qt: string[], robots: RobotData[]): RobotHitScore[] {
  const hits: RobotHitScore[] = [];
  robots.forEach((r) => {
    let best = 0;
    robotKeys(r).forEach((k) => {
      if (phraseIn(qt, k.text)) best = Math.max(best, k.score);
    });
    if (best) hits.push({ robot: r, score: best });
  });
  return hits.sort((a, b) => b.score - a.score);
}

/* Brand token shared by 2+ robots (e.g. "turtlebot3", or "turtlebot"
   with the model number dropped) with no qualifier — the honest move
   is to list the candidates. */
function brandAmbiguity(qt: string[], robots: RobotData[]): RobotData[] | null {
  const first: Record<string, RobotData[]> = {};
  robots.forEach((r) => {
    const t = tokens(r.name)[0];
    if (!t) return;
    [t, t.replace(/\d+$/, "")].forEach((brand) => {
      if (brand.length >= 4) (first[brand] = first[brand] || []).push(r);
    });
  });
  for (const brand in first) {
    const group = first[brand].filter((r, i, a) => a.indexOf(r) === i);
    if (group.length > 1 && qt.indexOf(brand) !== -1) return group;
  }
  return null;
}

/* ---------------- robot answers ---------------- */

function runLine(run: GateRunData): string {
  const bits = [`drive error ${fmt(run.drive_error_pct)}%`];
  if (run.heading_error_deg != null)
    bits.push(`turn error ${fmt(run.heading_error_deg)}°`);
  if (run.odometry_distance_error_pct != null) {
    bits.push(`odometry distance error ${fmt(run.odometry_distance_error_pct)}%`);
  }
  if (run.odometry_heading_error_deg != null) {
    bits.push(`odometry heading error ${fmt(run.odometry_heading_error_deg)}°`);
  }
  return bits.join(" · ");
}

function gateBlock(robot: RobotData): string {
  const gs = robot.gate_status || {};
  const status = gs.status || "NOT_GATED";
  const runs = gs.runs || [];
  let out = "";
  if (status === "NOT_GATED" || !runs.length) {
    out += "<p><strong>Gate: not gated yet</strong> — no recorded runs, so no verdict.</p>";
  } else {
    out +=
      "<p><strong>Gate: " +
      esc(VLABEL[status]) +
      "</strong> — " +
      runs.length +
      " recorded run" +
      (runs.length === 1 ? "" : "s") +
      " at the locked thresholds (pass ≤ 5% / 5°):</p><ul>" +
      runs
        .map((run, i) => "<li>Run " + (i + 1) + ": " + esc(runLine(run)) + "</li>")
        .join("") +
      "</ul>";
  }
  if (gs.note) out += "<p>" + esc(gs.note) + "</p>";
  return out;
}

function staticCheckOf(robot: RobotData): StaticCheckData | null {
  const checks = robot.checks || [];
  for (let i = 0; i < checks.length; i++) {
    if (checks[i].type === "static_stability") return checks[i];
  }
  return null;
}

function stabilityBlock(robot: RobotData): string {
  const c = staticCheckOf(robot);
  if (!c) return "";
  const gs = robot.gate_status || {};
  return (
    "<p><strong>Static stability check: " +
    esc(c.grade) +
    "</strong>" +
    " — a computation from the spec (support-polygon statics), not a " +
    "gate run. Weakest tip margin " +
    fmt(Math.round(c.tip_angle_deg * 10) / 10) +
    "° (" +
    fmt(c.weakest_margin_mm) +
    " mm, " +
    esc(c.weakest_direction) +
    "), checked " +
    esc(c.date) +
    ". The gate status is unchanged by " +
    "it: still " +
    esc(VLABEL[gs.status || "NOT_GATED"]) +
    ".</p>"
  );
}

function specsBlock(robot: RobotData): string {
  const ks = robot.key_specs || {};
  const keys = Object.keys(ks);
  if (!keys.length) return "<p>No key specs recorded for this robot.</p>";
  return (
    "<p><strong>Key specs</strong></p><ul>" +
    keys
      .map((k) => "<li>" + esc(k.replace(/_/g, " ")) + ": " + esc(ks[k]) + "</li>")
      .join("") +
    "</ul>"
  );
}

function provBlock(robot: RobotData): string {
  const p = robot.provenance || {};
  let out = "<p><strong>Provenance</strong></p><ul>";
  if (p.source_name) {
    out +=
      "<li>Source: " +
      esc(p.source_name) +
      (p.source_url ? ' (<a href="' + esc(p.source_url) + '">link</a>)' : "") +
      "</li>";
  }
  if (p.license) out += "<li>License: " + esc(p.license) + "</li>";
  if (robot.spec_file)
    out += "<li>Spec file: <code>" + esc(robot.spec_file) + "</code></li>";
  if (p.note) out += "<li>" + esc(p.note) + "</li>";
  return out + "</ul>";
}

function robotAnswer(robot: RobotData, qt: string[], root: string): string {
  const gs = robot.gate_status || {};
  const status = gs.status || "NOT_GATED";
  const wantsGate = [
    "gate", "verdict", "passed", "pass", "failed", "fail",
    "measured", "run", "runs", "score", "why",
  ].some((w) => qt.indexOf(w) !== -1);
  const wantsSpecs = [
    "spec", "specs", "size", "dimension", "dimensions",
    "mass", "weight", "heavy", "wheel", "wheels", "battery", "motor",
    "motors", "sensor", "sensors", "big",
  ].some((w) => qt.indexOf(w) !== -1);
  const wantsProv = [
    "license", "licence", "source", "provenance", "made",
    "maker", "manufacturer", "designed", "built",
  ].some((w) => qt.indexOf(w) !== -1);
  const wantsStability = ["stable", "stability", "tip", "balance", "fall over", "upright"].some(
    (w) => qt.indexOf(w) !== -1
  );
  let out =
    "<p><strong>" +
    esc(dexId(robot)) +
    " " +
    esc(robot.name) +
    "</strong> · " +
    esc(robot.class) +
    "</p><p>" +
    esc(robot.description) +
    "</p>";
  if (wantsGate || (!wantsSpecs && !wantsProv)) {
    out += gateBlock(robot);
  } else {
    out +=
      "<p><strong>Gate: " +
      esc(VLABEL[status]) +
      "</strong>" +
      (gs.runs && gs.runs.length
        ? " — " + gs.runs.length + " recorded run" + (gs.runs.length === 1 ? "" : "s") + "."
        : " — no recorded runs.") +
      "</p>";
  }
  if (staticCheckOf(robot)) {
    if (wantsStability || (!wantsSpecs && !wantsProv)) {
      out += stabilityBlock(robot);
    }
  } else if (wantsStability) {
    out +=
      "<p>No static stability check is recorded for this robot" +
      " — that check covers legged robots only.</p>";
  }
  if (wantsSpecs) out += specsBlock(robot);
  if (wantsProv) out += provBlock(robot);
  out += '<p><a href="' + esc(robotPage(root, robot)) + '">Open ' + esc(robot.name) + "&rsquo;s page &rarr;</a>";
  if (wantsGate) {
    out += ' · <a href="' + esc(routePath(root, "app/evidence/")) + '">Gate evidence</a>';
  }
  return out + "</p>";
}

function compareAnswer(hits: RobotHitScore[], root: string): string {
  let out = "<p>Here is what the recorded data says about each:</p>";
  hits.forEach((h) => {
    const r = h.robot;
    const gs = r.gate_status || {};
    const runs = gs.runs || [];
    const latest = runs.length ? runs[runs.length - 1] : null;
    out +=
      "<p><strong>" +
      esc(dexId(r)) +
      " " +
      esc(r.name) +
      "</strong> — gate: <strong>" +
      esc(VLABEL[gs.status || "NOT_GATED"]) +
      "</strong>" +
      (latest ? "; latest run: " + esc(runLine(latest)) : "; no recorded runs") +
      '. <a href="' +
      esc(robotPage(root, r)) +
      '">Its page &rarr;</a></p>';
  });
  return out;
}

function brandAnswer(group: RobotData[], root: string): string {
  const out =
    "<p>More than one robot matches that name:</p><ul>" +
    group
      .map((r) => {
        const gs = r.gate_status || {};
        return (
          '<li><a href="' +
          esc(robotPage(root, r)) +
          '">' +
          esc(dexId(r)) +
          " " +
          esc(r.name) +
          "</a> — " +
          esc(r.class) +
          "; gate: " +
          esc(VLABEL[gs.status || "NOT_GATED"]) +
          "</li>"
        );
      })
      .join("") +
    "</ul><p>Ask about one by its full name or number.</p>";
  return out;
}

/* ---------------- part matching + answers ---------------- */

const STOP: Record<string, number> = {
  mm: 1, cm: 1, kg: 1, per: 1, metre: 1, meter: 1, inch: 1,
  size: 1, class: 1, with: 1, the: 1, for: 1, and: 1,
};

function headName(name: string): string {
  return String(name).split("(")[0].split(",")[0].trim();
}

function scorePart(part: PartData, q: string, qt: string[]): number {
  const nameN = normalize(part.name);
  const headN = normalize(headName(part.name));
  if (phraseIn(qt, nameN)) return 10;
  if (headN && headN !== nameN && phraseIn(qt, headN)) return 9;
  if (phraseIn(qt, String(part.id).replace(/_/g, " "))) return 8;
  /* An accessory (mount/bracket/post/holder) must not outrank the
   * part itself on a bare type word: "lidar" is the RPLIDAR first,
   * its mount post second — unless the question names the accessory. */
  const accessory =
    /(mount|bracket|post|holder)/.test(headN) &&
    qt.indexOf("mount") === -1 &&
    qt.indexOf("bracket") === -1 &&
    qt.indexOf("post") === -1 &&
    qt.indexOf("holder") === -1;
  const segs = String(part.id).split("_");
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].length >= 4 && qt.indexOf(segs[i]) !== -1) return accessory ? 4 : 7;
  }
  const headToks = tokens(headN);
  tokens(String((part.specs || {}).kind || "").replace(/_/g, " ")).forEach((tk) => {
    if (headToks.indexOf(tk) === -1) headToks.push(tk);
  });
  if (headToks.length >= 2) {
    /* a run of >= 2 question tokens that starts the part's head name
       ("lidar mount" -> "Lidar mount post (3D-printed)") */
    for (let s = 0; s + 1 < qt.length; s++) {
      if (qt[s] === headToks[0] && qt[s + 1] === headToks[1]) return 7;
    }
    const sig = headToks.filter((t) => t.length >= 3 && !STOP[t]);
    const matched = sig.filter((t) => qt.indexOf(t) !== -1);
    if (matched.length >= 2 && matched.length / sig.length >= 0.75) return 5;
    if (matched.length >= 1 && matched.length / sig.length >= 0.5) return accessory ? 3 : 5;
  } else if (
    headToks.length === 1 &&
    headToks[0].length >= 4 &&
    qt.indexOf(headToks[0]) !== -1
  ) {
    return 6;
  }
  return 0;
}

interface PartHitScore {
  part: PartData;
  score: number;
}

function findParts(q: string, qt: string[], parts: PartData[]): PartHitScore[] {
  const hits: PartHitScore[] = [];
  parts.forEach((p) => {
    const s = scorePart(p, q, qt);
    if (s) hits.push({ part: p, score: s });
  });
  return hits.sort((a, b) => b.score - a.score);
}

/* ---------------- query cards: hits + catalogue filters ----------------
 * Answers carry structured hits (kind/id/label/route) alongside the
 * HTML, so the UI can render result buttons that pop the entity up
 * in the app — a robot's page, or the part's own catalogue card. */

function partHit(part: PartData): Hit {
  return { kind: "part", id: part.id, label: part.name };
}

function robotHit(robot: RobotData, root: string): Hit {
  return {
    kind: "robot",
    id: slugify(robot.name),
    label: dexId(robot) + " " + robot.name,
    route: robotPage(root, robot),
  };
}

function partText(part: PartData): string {
  const bits = [
    part.name,
    String(part.id).replace(/_/g, " "),
    String(part.part_class || "").replace(/_/g, " "),
    part.blurb || "",
    part.used_for || "",
    part.source || "",
    (part.robot_types || []).join(" "),
  ];
  const specs = part.specs || {};
  Object.keys(specs).forEach((k) => {
    const v = specs[k];
    bits.push(k.replace(/_/g, " ") + " " + (Array.isArray(v) ? v.join(" ") : String(v)));
  });
  return normalize(bits.join(" "));
}

const FILTER_STOP: Record<string, number> = {
  what: 1, how: 1, does: 1, do: 1, did: 1, is: 1,
  are: 1, was: 1, were: 1, which: 1, who: 1, why: 1, when: 1, where: 1,
  the: 1, a: 1, an: 1, of: 1, for: 1, with: 1, on: 1, in: 1, me: 1,
  about: 1, tell: 1, show: 1, find: 1, search: 1, list: 1, filter: 1,
  give: 1, get: 1, parts: 1, part: 1, robots: 1, robot: 1, used: 1,
  use: 1, using: 1, there: 1, any: 1, and: 1, or: 1, to: 1, from: 1,
  work: 1, works: 1, i: 1, want: 1, need: 1, have: 1, has: 1, can: 1,
  could: 1, please: 1, all: 1, one: 1, ones: 1,
};

/* Class words a question might use, mapped to catalogue classes.
 * `any` tokens offer a text route in for parts filed elsewhere
 * (a battery charger lives under power, a BMS board does not). */
interface ClassSynonym {
  words: string[];
  classes: string[];
  any: string[];
}

const CLASS_SYNONYMS: ClassSynonym[] = [
  { words: ["battery", "batteries"], classes: ["power"], any: ["battery", "pack"] },
  { words: ["lidar"], classes: ["cameras_sensors"], any: ["lidar"] },
  { words: ["camera", "cameras"], classes: ["cameras_sensors"], any: ["camera"] },
  { words: ["sensor", "sensors"], classes: ["cameras_sensors"], any: [] },
  { words: ["imu"], classes: ["cameras_sensors"], any: ["imu"] },
  { words: ["motor", "motors"], classes: ["actuators"], any: ["motor"] },
  { words: ["servo", "servos"], classes: ["actuators"], any: ["servo"] },
  { words: ["stepper"], classes: ["actuators"], any: ["stepper"] },
  { words: ["wheel", "wheels"], classes: ["wheels"], any: ["wheel"] },
  { words: ["caster", "casters"], classes: ["wheels"], any: ["caster"] },
  { words: ["driver", "drivers"], classes: ["drivers"], any: ["driver"] },
  { words: ["esc"], classes: ["drivers"], any: ["esc"] },
  { words: ["charger", "chargers"], classes: ["power"], any: ["charger"] },
  { words: ["connector", "connectors"], classes: ["cables_connectors"], any: [] },
  { words: ["wire", "wires", "cable", "cables"], classes: ["cables_connectors"], any: [] },
  { words: ["microcontroller", "microcontrollers"], classes: ["microcontrollers"], any: [] },
  { words: ["frame", "frames"], classes: ["structure"], any: ["frame"] },
  { words: ["filament"], classes: ["materials"], any: ["filament"] },
  { words: ["gripper", "grippers"], classes: ["end_effectors"], any: ["gripper"] },
  { words: ["propeller", "propellers", "prop", "props"], classes: ["propulsion_air"], any: ["propeller"] },
  { words: ["fuse", "fuses"], classes: ["safety_protection"], any: ["fuse"] },
];

function filterPartsQuery(
  q: string,
  qt: string[],
  parts: PartData[]
): AnswerResult | null {
  const qn = normalize(q);
  const typeMatches: string[] = [];
  parts.forEach((p) => {
    (p.robot_types || []).forEach((tp) => {
      if (normalize(tp) && qn.indexOf(normalize(tp)) !== -1) typeMatches.push(tp);
    });
  });
  const typePhrase: string | null = typeMatches.length
    ? typeMatches[typeMatches.length - 1]
    : null;
  const synMatches: ClassSynonym[] = [];
  const synWords: Record<string, number> = {};
  CLASS_SYNONYMS.forEach((d) => {
    d.words.forEach((w) => {
      synWords[w] = 1;
      if (qt.indexOf(w) !== -1) synMatches.push(d);
    });
  });
  const syn: ClassSynonym | null = synMatches.length
    ? synMatches[synMatches.length - 1]
    : null;
  const attrs = qt.filter((tk) => !FILTER_STOP[tk] && !synWords[tk]);
  const intentVerb = ["show", "find", "search", "filter", "list"].some(
    (v) => qt.indexOf(v) !== -1
  );
  const signal =
    syn ||
    typePhrase ||
    (attrs.length >= 1 && (intentVerb || qt.indexOf("parts") !== -1)) ||
    attrs.length >= 2;
  if (!signal) return null;
  const hits = parts.filter((p) => {
    if (typePhrase && (p.robot_types || []).indexOf(typePhrase) === -1) {
      return false;
    }
    const text = partText(p);
    const toks = tokens(text);
    if (syn) {
      const synDef: ClassSynonym = syn;
      if (synDef.any.length) {
        /* A specific type word must be named by the part itself
         * (name, id, kind or a spec value) — class membership alone
         * is too broad: every sensor in the class is not a lidar. */
        const corpus = tokens(
          [
            p.name,
            String(p.id).replace(/_/g, " "),
            String((p.specs || {}).kind || "").replace(/_/g, " "),
          ].join(" ")
        );
        const squash = normalize(p.name + " " + p.id).replace(/ /g, "");
        const named = synDef.any.some(
          (tk) => corpus.indexOf(tk) !== -1 || squash.indexOf(tk) !== -1
        );
        if (!named) return false;
      } else if (synDef.classes.indexOf(p.part_class || "") === -1) {
        return false;
      }
    }
    const squash = text.replace(/ /g, "");
    return attrs.every((a) => toks.indexOf(a) !== -1 || squash.indexOf(a) !== -1);
  });
  if (!hits.length) return null;
  if (hits.length === 1) {
    return { html: partAnswer(hits[0]), hits: [partHit(hits[0])] };
  }
  const shown = hits.slice(0, 8);
  const out =
    "<p><strong>" +
    hits.length +
    " catalogue parts</strong> match" +
    (typePhrase ? " for " + esc(typePhrase) : "") +
    ":</p><ul>" +
    shown
      .map((p) => {
        const specs = p.specs || {};
        const ks = Object.keys(specs)
          .slice(0, 3)
          .map((k) => {
            const v = specs[k];
            return (
              esc(k.replace(/_/g, " ")) +
              ": " +
              esc(Array.isArray(v) ? v.join(" / ") : v)
            );
          })
          .join(" · ");
        return (
          "<li><strong>" +
          esc(p.name) +
          "</strong> — " +
          esc(String(p.part_class || "").replace(/_/g, " ")) +
          (ks ? " · " + ks : "") +
          "</li>"
        );
      })
      .join("") +
    "</ul>" +
    (hits.length > shown.length
      ? "<p>…and " +
        (hits.length - shown.length) +
        " more. Narrow it with a spec (voltage, connector, size), " +
        "or tap a result button below.</p>"
      : "<p>Tap a result button below to pop one up in the catalogue.</p>");
  return { html: out, hits: hits.slice(0, 6).map(partHit) };
}

function partAnswer(part: PartData): string {
  let out =
    "<p><strong>" +
    esc(part.name) +
    "</strong> · " +
    esc(String(part.part_class || "").replace(/_/g, " ")) +
    "</p>";
  if (part.blurb) out += "<p>" + esc(part.blurb) + "</p>";
  if (part.used_for) out += "<p><strong>Used for:</strong> " + esc(part.used_for) + "</p>";
  if (part.robot_types && part.robot_types.length) {
    out += "<p><strong>Found on:</strong> " + esc(part.robot_types.join(", ")) + "</p>";
  }
  const specs = part.specs || {};
  const keys = Object.keys(specs).slice(0, 5);
  if (keys.length) {
    out +=
      "<p><strong>Recorded specs:</strong> " +
      keys
        .map((k) => {
          const v = specs[k];
          return esc(k.replace(/_/g, " ")) + ": " + esc(Array.isArray(v) ? v.join(" / ") : v);
        })
        .join(" · ") +
      "</p>";
  }
  if (part.notes) out += "<p>" + esc(part.notes) + "</p>";
  out +=
    '<p><span class="fc-dim">Source: ' +
    esc(part.source || "not recorded") +
    " · License: " +
    esc(part.license || "not recorded") +
    "</span></p>";
  return out;
}

function partAmbiguous(hits: PartHitScore[]): string {
  return (
    "<p>That matches more than one catalogue part:</p><ul>" +
    hits
      .slice(0, 5)
      .map(
        (h) =>
          "<li>" +
          esc(h.part.name) +
          " (" +
          esc(String(h.part.part_class || "").replace(/_/g, " ")) +
          ")</li>"
      )
      .join("") +
    "</ul><p>Ask again with the fuller name.</p>"
  );
}

/* ---------------- build planning ----------------
 * Planning answers are assembled from two recorded sources:
 * the starter kinds (catalog/kinds.json — kind, gate badge,
 * starter parameters) and the class templates in parts.json
 * (the reference BOM as required part ids x qty). Nothing here
 * invents a part or a verdict: a kind with no gate pack says
 * so in its own badge. */

const KIND_TEMPLATE: Record<string, string> = {
  differential: "rover_diff_drive",
  "skid-steer": "rover_skid_steer",
  mecanum: "rover_skid_steer",
  tracked: "rover_skid_steer",
  ackermann: "rc_car",
  quadcopter: "quadcopter_5inch",
  arm: "robot_arm_6dof",
};
const KIND_TEMPLATE_NOTE: Record<string, string> = {
  mecanum:
    "Uses the skid-steer template; its plain wheels become mecanum wheels (the template lists one as an optional part).",
  tracked:
    "Uses the skid-steer template; tracks are not a catalogue part yet, so the template’s wheels stand in for the track units.",
};
const KIND_PHRASES: { id: string; phrases: string[] }[] = [
  { id: "differential", phrases: ["differential"] },
  { id: "skid-steer", phrases: ["skid steer", "skidsteer"] },
  { id: "mecanum", phrases: ["mecanum"] },
  { id: "tracked", phrases: ["tracked", "treads", "tank"] },
  { id: "ackermann", phrases: ["ackermann", "rc car"] },
  { id: "quadcopter", phrases: ["quadcopter", "quad", "drone"] },
  { id: "arm", phrases: ["robot arm", "robotic arm"] },
];

function findKindId(qt: string[]): string | null {
  for (let i = 0; i < KIND_PHRASES.length; i++) {
    const ps = KIND_PHRASES[i].phrases;
    for (let j = 0; j < ps.length; j++) {
      if (phraseIn(qt, ps[j])) return KIND_PHRASES[i].id;
    }
  }
  return null;
}
function kindById(ctx: Ctx, id: string): KindData | null {
  let found: KindData | null = null;
  (ctx.data.kinds || []).forEach((k) => {
    if (k.id === id) found = k;
  });
  return found;
}
function templateByName(ctx: Ctx, name: string): TemplateData | null {
  let found: TemplateData | null = null;
  (ctx.data.templateList || []).forEach((t) => {
    if (t.name === name) found = t;
  });
  return found;
}
function partById(ctx: Ctx, id: string): PartData | null {
  let found: PartData | null = null;
  ctx.data.parts.forEach((p) => {
    if (p.id === id) found = p;
  });
  return found;
}
function gateBadge(pack: string): string {
  return (
    ({
      live: "gate pack LIVE",
      partial: "gate pack PARTIAL",
      "catalogue-only": "CATALOGUE ONLY — no gate pack yet",
      roadmap: "no gate pack yet (roadmap)",
    } as Record<string, string>)[pack] || pack
  );
}
function kindHit(kind: KindData, root: string): Hit {
  return {
    kind: "kind",
    id: kind.id,
    label: kind.label + " — starter kind",
    route: routePath(root, "app/forge/"),
  };
}

interface BomItem {
  id: string;
  qty: number;
  part: PartData | null;
  name: string;
}

function bomItems(ctx: Ctx, template: TemplateData): BomItem[] {
  return Object.keys(template.required || {})
    .map((id) => ({
      id: id,
      qty: (template.required || {})[id],
      part: partById(ctx, id),
      name: "",
    }))
    .map((it) => {
      it.name = it.part ? it.part.name : it.id;
      return it;
    });
}

function planAnswer(ctx: Ctx, kind: KindData): AnswerResult {
  let out =
    "<p><strong>" + esc(kind.label) + "</strong> — " + esc(kind.one_liner) + "</p>";
  out +=
    "<p><strong>" +
    esc(gateBadge(kind.gate_pack)) +
    "</strong>" +
    (kind.gate_note ? " " + esc(kind.gate_note) : "") +
    '<br><span class="fc-dim">Reference: ' +
    esc(kind.reference) +
    "</span></p>";
  const hits: Hit[] = [kindHit(kind, ctx.root)];
  const tname = KIND_TEMPLATE[kind.id];
  const template = tname ? templateByName(ctx, tname) : null;
  if (template) {
    const items = bomItems(ctx, template);
    out +=
      "<p><strong>The reference build</strong> (the " +
      esc(template.label) +
      " template):</p><ul>" +
      items
        .map((it) => "<li>" + esc(it.name) + " ×" + it.qty + "</li>")
        .join("") +
      "</ul>";
    items.slice(0, 5).forEach((it) => {
      if (it.part) hits.push(partHit(it.part));
    });
    const opt = (template.optional || []).length;
    if (opt) {
      out +=
        "<p>Plus " + opt + " optional parts in the template " + "(sensors, safety, upgrades).</p>";
    }
    if (KIND_TEMPLATE_NOTE[kind.id]) {
      out += "<p>" + esc(KIND_TEMPLATE_NOTE[kind.id]) + "</p>";
    }
  } else if (kind.bom_hints && kind.bom_hints.length) {
    out +=
      "<p><strong>The build, at BOM level:</strong></p><ul>" +
      kind.bom_hints.map((h) => "<li>" + esc(h) + "</li>").join("") +
      "</ul>";
  }
  const params = (kind.params || []).slice(0, 5);
  if (params.length) {
    out +=
      "<p><strong>Starter parameters</strong> (defaults): " +
      params
        .map(
          (p) =>
            esc(p.label) + " " + esc(p.default) + (p.unit ? " " + esc(p.unit) : "")
        )
        .join(" · ") +
      "</p>";
  }
  out +=
    '<p>Start from this kind in the <a href="' +
    esc(routePath(ctx.root, "app/forge/")) +
    '">Forge</a>, or ask me what ' +
    "you still need: ‘I have wheels and motors, what else do " +
    "I need for a " +
    esc(kind.id) +
    " build?’</p>";
  return { html: out, hits: hits };
}

function kindPickerAnswer(ctx: Ctx, lead: string): AnswerResult | null {
  const kinds = ctx.data.kinds || [];
  if (!kinds.length) return null;
  const out =
    "<p>" +
    esc(lead) +
    "</p><ul>" +
    kinds
      .map(
        (k) =>
          "<li><strong>" +
          esc(k.label) +
          "</strong> — " +
          esc(k.one_liner) +
          " <em>" +
          esc(gateBadge(k.gate_pack)) +
          "</em></li>"
      )
      .join("") +
    "</ul><p>Name a kind and I’ll lay out its " +
    "reference build.</p>";
  return {
    html: out,
    hits: kinds.map((k) => kindHit(k, ctx.root)),
  };
}

function haveNeedAnswer(ctx: Ctx, q: string, qt: string[], kind: KindData): AnswerResult {
  const ownedIds: Record<string, number> = {};
  const ownedClasses: Record<string, number> = {};
  const classWords: string[] = [];
  findParts(q, qt, ctx.data.parts).forEach((h) => {
    if (h.score >= 7) ownedIds[h.part.id] = 1;
  });
  CLASS_SYNONYMS.forEach((d) => {
    if (d.words.some((w) => qt.indexOf(w) !== -1)) {
      d.classes.forEach((c) => {
        ownedClasses[c] = 1;
        if (classWords.indexOf(c) === -1) classWords.push(c);
      });
    }
  });
  const tname = KIND_TEMPLATE[kind.id];
  const template = tname ? templateByName(ctx, tname) : null;
  if (!template) {
    return {
      html:
        "<p>For a " +
        esc(kind.label) +
        " there is no " +
        "part-by-part template yet — it is a BOM-level kind (" +
        esc(gateBadge(kind.gate_pack)) +
        "). Its build list:</p><ul>" +
        (kind.bom_hints || []).map((h) => "<li>" + esc(h) + "</li>").join("") +
        "</ul>",
      hits: [kindHit(kind, ctx.root)],
    };
  }
  const missing: BomItem[] = [];
  const covered: BomItem[] = [];
  bomItems(ctx, template).forEach((it) => {
    const cls = it.part ? it.part.part_class : null;
    if (ownedIds[it.id] || (cls && ownedClasses[cls])) {
      covered.push(it);
    } else {
      missing.push(it);
    }
  });
  const haveBits: string[] = [];
  Object.keys(ownedIds).forEach((id) => {
    const p = partById(ctx, id);
    if (p) haveBits.push(p.name);
  });
  classWords.forEach((c) => {
    haveBits.push(c.replace(/_/g, " ") + " (class)");
  });
  let out =
    "<p><strong>" + esc(kind.label) + "</strong> — " + esc(gateBadge(kind.gate_pack)) + "</p>";
  out +=
    "<p>Counting what you named (" +
    (haveBits.length ? esc(haveBits.join(", ")) : "nothing specific") +
    "), the " +
    esc(template.label) +
    " template still needs:</p>";
  if (missing.length) {
    out +=
      "<ul>" +
      missing.map((it) => "<li>" + esc(it.name) + " ×" + it.qty + "</li>").join("") +
      "</ul>";
  } else {
    out +=
      "<p><strong>Nothing — the required list is " +
      "covered.</strong> The template also lists " +
      (template.optional || []).length +
      " optional parts.</p>";
  }
  if (covered.length && missing.length) {
    out +=
      "<p>Already covered: " +
      covered.map((it) => esc(it.name)).join(", ") +
      ".</p>";
  }
  out +=
    '<p><span class="fc-dim">Counting is by part class: ' +
    "naming ‘wheels’ covers the template’s wheel line, " +
    "whatever the specific wheel. Quantities are the " +
    "template’s.</span></p>";
  const hits: Hit[] = [kindHit(kind, ctx.root)];
  missing.slice(0, 5).forEach((it) => {
    if (it.part) hits.push(partHit(it.part));
  });
  return { html: out, hits: hits };
}

const BUILD_VERBS = ["build", "building", "plan", "planning", "assemble", "assembling"];

function planningAnswer(ctx: Ctx, q: string, qt: string[]): AnswerResult | null {
  /* Pricing questions belong to the topics table, not planning. */
  if (qt.indexOf("cost") !== -1 || qt.indexOf("price") !== -1 || qt.indexOf("expensive") !== -1)
    return null;
  const kindId = findKindId(qt);
  const kind = kindId ? kindById(ctx, kindId) : null;
  const hasBuild =
    BUILD_VERBS.some((v) => qt.indexOf(v) !== -1) ||
    (qt.indexOf("start") !== -1 && (qt.indexOf("robot") !== -1 || !!kind)) ||
    (qt.indexOf("new") !== -1 && qt.indexOf("robot") !== -1) ||
    (qt.indexOf("custom") !== -1 && qt.indexOf("robot") !== -1);
  const needPhrase =
    phraseIn(qt, "what do i need") ||
    phraseIn(qt, "parts do i need") ||
    phraseIn(qt, "do i need") ||
    phraseIn(qt, "what else") ||
    phraseIn(qt, "whats missing") ||
    phraseIn(qt, "am i missing");
  const havePhrase =
    phraseIn(qt, "i have") ||
    phraseIn(qt, "i already have") ||
    phraseIn(qt, "i own") ||
    phraseIn(qt, "i got");
  const missingAsk =
    havePhrase || (needPhrase && (qt.indexOf("else") !== -1 || qt.indexOf("missing") !== -1));

  if (missingAsk) {
    if (kind) return haveNeedAnswer(ctx, q, qt, kind);
    return kindPickerAnswer(
      ctx,
      "Tell me which kind you are " +
        "building and I will diff what you have against its " +
        "reference build. The starter kinds:"
    );
  }
  if (kind && (hasBuild || needPhrase)) return planAnswer(ctx, kind);
  if (needPhrase && !kind) {
    /* "What motors do I need for a rover?" is a catalogue
     * question in planning clothes — the filter answers it. */
    const fq = filterPartsQuery(q, qt, ctx.data.parts);
    if (fq) return fq;
  }
  /* Recommendation routing runs before the generic picker:
   * "what battery should I use for a 4S build?" names a build
   * but asks a catalogue question — strip the modal words and
   * let the filter answer with the attribute that is meant. */
  if (qt.indexOf("should") !== -1 || qt.indexOf("recommend") !== -1) {
    const cleaned = qt
      .filter(
        (tk) =>
          ["should", "would", "recommend", "best", "pick", "choose", "use", "get", "buy", "build"].indexOf(tk) === -1
      )
      .join(" ");
    const rf = filterPartsQuery(cleaned, tokens(cleaned), ctx.data.parts);
    if (rf) {
      rf.html = "<p>From the catalogue:</p>" + rf.html;
      return rf;
    }
  }
  if (hasBuild || needPhrase) {
    return kindPickerAnswer(
      ctx,
      "Every custom build starts " +
        "from a starter kind — a body plan with real defaults " +
        "and an honest gate badge. Pick one:"
    );
  }
  return null;
}

/* ---------------- data-driven topic handlers ---------------- */

type HandlerResult = string | AnswerResult;

export const HANDLERS: Record<string, (ctx: Ctx) => HandlerResult> = {
  robodex_list: function (ctx) {
    if (!ctx.data.robots.length) return ctx.noData("app/robots/", "the Robodex page");
    let out =
      "<p>The Robodex — " +
      ctx.data.robots.length +
      " robots, numbered in the order the forge learned them:</p><ul>";
    ctx.data.robots.forEach((r) => {
      const gs = r.gate_status || {};
      out +=
        '<li><a href="' +
        esc(robotPage(ctx.root, r)) +
        '">' +
        esc(dexId(r)) +
        " " +
        esc(r.name) +
        "</a> — " +
        esc(r.class) +
        "; gate: " +
        esc(VLABEL[gs.status || "NOT_GATED"]) +
        "</li>";
    });
    return {
      html: out + "</ul>",
      hits: ctx.data.robots.map((r) => robotHit(r, ctx.root)),
    };
  },

  passed_list: function (ctx) {
    if (!ctx.data.robots.length) return ctx.noData("app/robots/", "the Robodex page");
    const passed = ctx.data.robots.filter((r) => (r.gate_status || {}).status === "PASS");
    if (!passed.length)
      return "<p>No robot in the Robodex has a recorded PASS yet.</p>";
    let out =
      "<p>" +
      passed.length +
      " of " +
      ctx.data.robots.length +
      " robots hold a recorded gate PASS:</p><ul>";
    passed.forEach((r) => {
      const runs = (r.gate_status || {}).runs || [];
      const latest = runs[runs.length - 1];
      out +=
        '<li><a href="' +
        esc(robotPage(ctx.root, r)) +
        '">' +
        esc(dexId(r)) +
        " " +
        esc(r.name) +
        "</a> — " +
        runs.length +
        " recorded run" +
        (runs.length === 1 ? "" : "s") +
        (latest ? "; latest: " + esc(runLine(latest)) : "") +
        "</li>";
    });
    return {
      html:
        out +
        '</ul><p><a href="' +
        esc(routePath(ctx.root, "app/evidence/")) +
        '">See the gate evidence &rarr;</a></p>',
      hits: passed.map((r) => robotHit(r, ctx.root)),
    };
  },

  failed_list: function (ctx) {
    if (!ctx.data.robots.length) return ctx.noData("app/robots/", "the Robodex page");
    const failed = ctx.data.robots.filter((r) => (r.gate_status || {}).status === "FAIL");
    const ungated = ctx.data.robots.filter(
      (r) => (r.gate_status || {}).status === "NOT_GATED"
    );
    let out = "";
    if (failed.length) {
      out +=
        "<p>Recorded gate FAIL:</p><ul>" +
        failed
          .map((r) => {
            const runs = (r.gate_status || {}).runs || [];
            const latest = runs[runs.length - 1];
            return (
              '<li><a href="' +
              esc(robotPage(ctx.root, r)) +
              '">' +
              esc(dexId(r)) +
              " " +
              esc(r.name) +
              "</a>" +
              (latest ? " — latest run: " + esc(runLine(latest)) : "") +
              ". Ask me &lsquo;why did it fail?&rsquo; for the recorded diagnosis.</li>"
            );
          })
          .join("") +
        "</ul>";
    } else {
      out += "<p>No robot in the Robodex has a recorded FAIL.</p>";
    }
    if (ungated.length) {
      out +=
        "<p>Not gated yet (no runs, so no verdict): " +
        ungated
          .map(
            (r) =>
              '<a href="' +
              esc(robotPage(ctx.root, r)) +
              '">' +
              esc(dexId(r)) +
              " " +
              esc(r.name) +
              "</a>"
          )
          .join(", ") +
        ".</p>";
    }
    return {
      html: out,
      hits: failed.concat(ungated).map((r) => robotHit(r, ctx.root)),
    };
  },

  parts_overview: function (ctx) {
    if (!ctx.data.parts.length) return ctx.noData("app/kit/#parts", "the parts catalogue");
    const byClass: Record<string, number> = {};
    ctx.data.parts.forEach((p) => {
      const cls = p.part_class || "";
      byClass[cls] = (byClass[cls] || 0) + 1;
    });
    const classes = Object.keys(byClass).sort();
    const out =
      "<p>The parts catalogue holds <strong>" +
      ctx.data.parts.length +
      " real parts</strong> in " +
      classes.length +
      " classes, plus " +
      ctx.data.templates +
      " robot-class templates (reference BOMs):</p><ul>" +
      classes
        .map((c) => "<li>" + esc(c.replace(/_/g, " ")) + ": " + byClass[c] + "</li>")
        .join("") +
      "</ul>" +
      "<p>Ask me about any part by name — for example &lsquo;What is a TB6612FNG?&rsquo;</p>";
    return out;
  },

  reports_list: function (ctx) {
    const runs = (ctx.data.reports && ctx.data.reports.runs) || [];
    if (!runs.length) return ctx.noData("app/evidence/", "the Evidence page");
    let out = "<p>" + runs.length + " recorded gate reports:</p><ul>";
    runs.forEach((rep) => {
      const doc = rep.doc || {};
      const checks = doc.checks || [];
      const worst = checks
        .slice()
        .sort((a, b) => Number(b.error) - Number(a.error))[0];
      out +=
        "<li><strong>" +
        esc(rep.title || rep.id) +
        "</strong> — verdict <strong>" +
        esc(doc.verdict || "not recorded") +
        "</strong>" +
        (worst
          ? "; largest error: " +
            esc(worst.name.replace(/_/g, " ")) +
            " " +
            fmt(worst.error) +
            esc(worst.unit === "deg" ? "°" : worst.unit)
          : "") +
        "</li>";
    });
    return {
      html:
        out +
        '</ul><p><a href="' +
        esc(routePath(ctx.root, "app/evidence/")) +
        '">Open the Evidence page &rarr;</a></p>',
      hits: [
        { kind: "route", label: "Open the Evidence page", route: routePath(ctx.root, "app/evidence/") },
      ],
    };
  },
};

/* ---------------- topics ---------------- */

function scoreTopic(topic: TopicData, qt: string[]): { score: number; longest: number } {
  let score = 0;
  let longest = 0;
  (topic.keywords || []).forEach((kw) => {
    if (phraseIn(qt, kw)) {
      const w = Math.max(2, tokens(kw).length);
      score += w;
      longest = Math.max(longest, tokens(kw).length);
    }
  });
  return { score: score, longest: longest };
}

function textAnswer(
  text: string,
  link: { label: string; route: string } | undefined,
  root: string
): string {
  let out = text
    .split(/\n\n+/)
    .map((para) => "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>")
    .join("");
  if (link) {
    out +=
      '<p><a href="' +
      esc(routePath(root, link.route)) +
      '">' +
      esc(link.label) +
      " &rarr;</a></p>";
  }
  return out;
}

/* ---------------- the engine ---------------- */

export function createEngine(data: EngineData): Engine {
  const root = data.root || "";
  const ctx: Ctx = {
    data: {
      robots: (data.robots || []).slice().sort((a, b) => Number(a.number) - Number(b.number)),
      parts: data.parts || [],
      templates: data.templates || 0,
      templateList: data.templateList || [],
      kinds: data.kinds || [],
      reports: data.reports || null,
    },
    root: root,
    noData: function (route: string, label: string) {
      return (
        "<p>I couldn&rsquo;t load the recorded catalogue just now, so I can&rsquo;t " +
        'answer that from data. The full record is on <a href="' +
        esc(routePath(root, route)) +
        '">' +
        esc(label) +
        "</a>.</p>"
      );
    },
  };
  const topics = (data.intents && data.intents.topics) || [];
  const suggestions = (data.intents && data.intents.suggestions) || [];

  function answer(question: string): AnswerResult {
    const q = String(question || "");
    const qt = tokens(q);
    if (!qt.length) {
      return { html: "<p>Ask me about a robot, a part, or the gate.</p>", chips: suggestions };
    }

    /* 1. robots: strong entity match wins */
    const rHits = findRobots(qt, ctx.data.robots).filter((h) => h.score >= 6);
    if (rHits.length === 1) {
      return {
        html: robotAnswer(rHits[0].robot, qt, ctx.root),
        hits: [robotHit(rHits[0].robot, ctx.root)],
      };
    }
    if (rHits.length > 1) {
      return {
        html: compareAnswer(rHits, ctx.root),
        hits: rHits.map((h) => robotHit(h.robot, ctx.root)),
      };
    }
    const brand = brandAmbiguity(qt, ctx.data.robots);
    if (brand)
      return {
        html: brandAnswer(brand, ctx.root),
        hits: brand.map((r) => robotHit(r, ctx.root)),
      };

    /* 2. parts with a confident match beat generic topics */
    const pHits = findParts(q, qt, ctx.data.parts);
    const topPart = pHits.length ? pHits[0] : null;
    if (topPart && topPart.score >= 8) {
      const tied = pHits.filter((h) => h.score === topPart.score);
      const near = pHits.filter((h) => h.score >= topPart.score - 2).slice(0, 4);
      return {
        html: tied.length > 1 ? partAmbiguous(tied) : partAnswer(topPart.part),
        hits: (tied.length > 1 ? tied : near).map((h) => partHit(h.part)),
      };
    }

    /* 2.2 build planning: kinds + templates + have-vs-need.
     * "What do I need to build..." plans a build here instead
     * of falling through to word matches or the fallback. */
    const plan = planningAnswer(ctx, q, qt);
    if (plan) return plan;

    /* 2.5 query cards: catalogue filter questions ("show me 4S
     * batteries", "parts with xt60", bare "lidar"). Only fires on a
     * real filter signal and only when it finds something; otherwise
     * the topic/fallback flow below decides as before. */
    const fq = filterPartsQuery(q, qt, ctx.data.parts);
    if (fq) return fq;

    /* 3. intent topics */
    let best: TopicData | null = null;
    let bestScore = 0;
    let bestLong = 0;
    for (const t of topics) {
      const s = scoreTopic(t, qt);
      if (s.score > bestScore || (s.score === bestScore && s.score > 0 && s.longest > bestLong)) {
        best = t;
        bestScore = s.score;
        bestLong = s.longest;
      }
    }
    if (best && bestScore >= 2) {
      const topic: TopicData = best;
      if (topic.handler && HANDLERS[topic.handler]) {
        const hr = HANDLERS[topic.handler](ctx);
        return typeof hr === "string" ? { html: hr } : hr;
      }
      if (topic.answer) return { html: textAnswer(topic.answer, topic.link, ctx.root) };
    }

    /* 4. weaker part match */
    if (topPart && topPart.score >= 5) {
      const tied2 = pHits.filter((h) => h.score === topPart.score);
      const near2 = pHits.filter((h) => h.score >= topPart.score - 2).slice(0, 4);
      return {
        html: tied2.length > 1 ? partAmbiguous(tied2) : partAnswer(topPart.part),
        hits: (tied2.length > 1 ? tied2 : near2).map((h) => partHit(h.part)),
      };
    }

    /* 5. honest fallback, with the nearest topics as suggestions */
    const near = topics
      .map((t) => ({ t: t, s: scoreTopic(t, qt).score }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2);
    const chips = near.length
      ? near.map((x) => (x.t.samples || [])[0]).filter((s): s is string => Boolean(s))
      : suggestions;
    return {
      html:
        "<p>I don&rsquo;t have that in RobotForge&rsquo;s recorded data, and " +
        "I&rsquo;d rather say so than guess.</p>" +
        "<p>I can answer about the Robodex robots and their gate verdicts, the " +
        "parts catalogue, planning a build from a starter kind, how the gate works and its thresholds, and how " +
        "RobotForge works. Try one of these:</p>",
      chips: chips.length ? chips : suggestions,
      /* The one answer the UI may route to a live model when a
       * deployment configures one: the local engine honestly
       * could not answer from recorded data. */
      fallback: true,
    };
  }

  return { answer: answer, suggestions: suggestions, CONFIG: CONFIG };
}
