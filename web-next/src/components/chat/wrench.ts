/* Wrench Tier 1 turn layer — pure and DOM-free, wrapped around the
 * recorded-data engine (engine.ts). The engine still decides every
 * factual answer; this layer adds what a conversation needs around
 * it, without ever inventing data:
 *
 *  - failure explanations: a FAIL answered as which recorded check
 *    went over the locked limit, in plain words, plus the suspect
 *    the record itself names (gate-report suspects, or the suspect
 *    sentence in the robot's recorded note) and the fix it points
 *    to. No suspect in the record → the answer says so.
 *  - sources: every factual answer carries the records it came
 *    from (the robot's Robodex page, the gate report on the
 *    Evidence page, the catalogue entry) as tappable chips,
 *    derived from the answer's own hits — the same records, never
 *    a decoration added afterwards.
 *  - actions: a small set of real, in-line actions rendered as
 *    hits — send a failing robot's spec to the Workshop fix loop,
 *    run the one-click demo, open the gate evidence.
 *  - session memory: the last robot an answer was about is kept
 *    per session, and a follow-up that names no robot ("and its
 *    battery?", "why did it fail?") resolves against it. A
 *    question with no topical link to the robot is never hijacked.
 *  - contextual chips: the suggestion row adapts to the page and
 *    the robot on it (a FAIL robot offers "Why did it fail?",
 *    a PASS robot never does).
 *
 * The honesty contract is unchanged: factual unknowns still come
 * back as the engine's fallback, flagged `fallback: true`, and the
 * UI may still offer only those to a live model.
 */

import {
  createEngine,
  esc,
  phraseIn,
  slugify,
  tokens,
  type AnswerResult,
  type Engine,
  type EngineData,
  type Hit,
  type ReportRunData,
  type RobotData,
} from "./engine";

/* ---------------- shapes ---------------- */

export interface SourceRef {
  label: string;
  route: string;
}

export interface TurnMemory {
  robotName?: string;
  robotSlug?: string;
}

export interface TurnResult extends AnswerResult {
  sources?: SourceRef[];
  memory: TurnMemory;
}

export interface Wrench {
  answerTurn: (question: string, mem: TurnMemory) => TurnResult;
  contextChips: (pathname: string, mem: TurnMemory) => string[];
  suggestions: string[];
}

/* The locked gate thresholds, as recorded in the gate block. */
const LIMIT_PCT = 5;
const LIMIT_DEG = 5;

interface ReportCheck {
  name: string;
  error: number | string;
  unit?: string;
  verdict?: string;
  [key: string]: unknown;
}

interface ReportDoc {
  verdict?: string;
  spec?: string;
  checks?: ReportCheck[];
  suspects?: { field?: string; reason?: string }[];
  [key: string]: unknown;
}

function reportDoc(run: ReportRunData): ReportDoc {
  return (run.doc || {}) as ReportDoc;
}

function fmt(v: unknown): string | null {
  return v == null ? null : String(parseFloat(Number(v).toFixed(3)));
}

function dexId(robot: RobotData): string {
  const n = String(robot.number);
  return "#" + ("00" + n).slice(-3);
}

function robotRoute(root: string, robot: RobotData): string {
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return base + "robots/" + slugify(robot.name) + "/";
}

function evidenceRoute(root: string): string {
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return base + "evidence/";
}

/* ---------------- robot matching (mirrors the engine's keys) ---------------- */

function matchRobot(qt: string[], robots: RobotData[]): RobotData | null {
  let best: RobotData | null = null;
  let bestScore = 0;
  robots.forEach((r) => {
    const toks = tokens(r.name);
    const keys: { text: string; score: number }[] = [{ text: r.name, score: 10 }];
    if (toks.length > 1) {
      const last = toks[toks.length - 1];
      if (last.length >= 3) keys.push({ text: last, score: 8 });
      if (toks.length > 2) {
        keys.push({ text: toks.slice(-2).join(" "), score: 8 });
        toks.slice(1, -1).forEach((t) => {
          if (t.length >= 5) keys.push({ text: t, score: 8 });
        });
      }
    }
    const num = ("00" + String(r.number)).slice(-3);
    keys.push({ text: "#" + num, score: 6 });
    keys.push({ text: num, score: 6 });
    keys.forEach((k) => {
      if (phraseIn(qt, k.text) && k.score > bestScore) {
        best = r;
        bestScore = k.score;
      }
    });
  });
  return bestScore >= 6 ? best : null;
}

/* ---------------- gate reports about a robot ---------------- */

function reportsForRobot(data: EngineData, robot: RobotData): ReportRunData[] {
  const runs = (data.reports && data.reports.runs) || [];
  const specBase = String(robot.spec_file || "").split("/").pop()!.replace(/\.json$/, "");
  return runs.filter((run) => {
    const spec = String(reportDoc(run).spec || "");
    return (
      spec === specBase ||
      slugify(spec) === slugify(robot.name) ||
      String(run.id || "").indexOf(slugify(robot.name)) === 0
    );
  });
}

/* ---------------- failure explanations ---------------- */

const CHECK_PLAIN: Record<string, string> = {
  drive_distance: "drive distance — driving straight to the commanded distance",
  turn_heading: "turn heading — turning to the commanded angle",
  odometry_distance: "odometry distance — the robot's own distance reading",
  odometry_heading: "odometry heading — the robot's own heading reading",
};

const METRIC_PLAIN: Record<string, { label: string; unit: string; limit: number }> = {
  drive_error_pct: { label: "drive distance — driving straight to the commanded distance", unit: "%", limit: LIMIT_PCT },
  heading_error_deg: { label: "turn heading — turning to the commanded angle", unit: "°", limit: LIMIT_DEG },
  odometry_distance_error_pct: { label: "odometry distance — the robot's own distance reading", unit: "%", limit: LIMIT_PCT },
  odometry_heading_error_deg: { label: "odometry heading — the robot's own heading reading", unit: "°", limit: LIMIT_DEG },
};

function limitFor(unit?: string): number {
  return unit === "deg" || unit === "°" ? LIMIT_DEG : LIMIT_PCT;
}

function suspectSentence(note: string): string | null {
  const sentences = String(note || "").split(/(?<=\.)\s+/);
  for (const s of sentences) {
    if (/suspect/i.test(s)) return s.trim();
  }
  return null;
}

function fixHit(robot: RobotData): Hit {
  return {
    kind: "action",
    id: "fix:" + slugify(robot.name),
    label: "Fix " + robot.name + " in the Workshop →",
    specFile: robot.spec_file || "",
  };
}

function demoHit(): Hit {
  return { kind: "action", id: "demo", label: "Run the one-click demo →", route: "/demo" };
}

function failureAnswer(data: EngineData, root: string, robot: RobotData): AnswerResult | null {
  const gs = robot.gate_status || {};
  const status = String(gs.status || "NOT_GATED");
  const runs = gs.runs || [];
  const reports = reportsForRobot(data, robot);
  const failReports = reports.filter((r) => reportDoc(r).verdict === "FAIL");
  const passReports = reports.filter((r) => reportDoc(r).verdict === "PASS");
  if (status !== "FAIL" && status !== "MARGINAL" && !failReports.length) return null;

  let out =
    "<p><strong>" +
    esc(dexId(robot)) +
    " " +
    esc(robot.name) +
    "</strong> — gate: <strong>" +
    esc(status === "NOT_GATED" ? "Not gated" : status.charAt(0) + status.slice(1).toLowerCase()) +
    "</strong>. " +
    (status !== "FAIL" && status !== "MARGINAL" && failReports.length
      ? "Its recorded spec passes — the failure on record is an injected-fault run of the same spec:</p>"
      : "Here is what the record says went wrong:</p>");

  /* Over-limit checks, from the robot's recorded gate runs. */
  const over: string[] = [];
  Object.keys(METRIC_PLAIN).forEach((key) => {
    const m = METRIC_PLAIN[key];
    let worst: number | null = null;
    let worstRun = 0;
    runs.forEach((run, i) => {
      const v = run[key];
      if (typeof v === "number" && v > m.limit && (worst === null || v > worst)) {
        worst = v;
        worstRun = i + 1;
      }
    });
    if (worst !== null) {
      over.push(
        "<li><strong>" +
          esc(m.label) +
          "</strong>: worst error " +
          fmt(worst) +
          esc(m.unit) +
          " (run " +
          worstRun +
          "), over the locked limit of " +
          m.limit +
          esc(m.unit) +
          ".</li>"
      );
    }
  });
  if (over.length) {
    out += "<p><strong>Over the limit in its recorded runs:</strong></p><ul>" + over.join("") + "</ul>";
  }

  /* Over-limit checks from a recorded FAIL gate report. */
  const suspects: { field?: string; reason?: string }[] = [];
  failReports.forEach((run) => {
    const doc = reportDoc(run);
    const bad = (doc.checks || []).filter(
      (c) => c.verdict === "FAIL" || Number(c.error) > limitFor(c.unit)
    );
    if (bad.length) {
      out +=
        "<p><strong>In the recorded report &lsquo;" +
        esc(run.title || run.id) +
        "&rsquo;:</strong></p><ul>" +
        bad
          .map(
            (c) =>
              "<li><strong>" +
              esc(CHECK_PLAIN[c.name] || c.name.replace(/_/g, " ")) +
              "</strong>: error " +
              fmt(c.error) +
              esc(c.unit === "deg" ? "°" : c.unit || "") +
              ", over the locked limit of " +
              limitFor(c.unit) +
              esc(c.unit === "deg" ? "°" : c.unit || "") +
              ".</li>"
          )
          .join("") +
        "</ul>";
    }
    (doc.suspects || []).forEach((s) => suspects.push(s));
  });

  /* What the record blames — never an invented cause. */
  if (suspects.length) {
    out +=
      "<p><strong>What the record blames:</strong></p><ul>" +
      suspects
        .map(
          (s) =>
            "<li><code>" +
            esc(s.field || "not named") +
            "</code> — " +
            esc(s.reason || "") +
            "</li>"
        )
        .join("") +
      "</ul>";
  } else {
    const sentence = suspectSentence(String(gs.note || ""));
    if (sentence) {
      out += "<p><strong>What the record blames:</strong> " + esc(sentence) + "</p>";
    } else {
      out +=
        "<p>The record names no suspect for this one — the diagnosis was not recorded, and I won&rsquo;t invent one.</p>";
    }
  }

  /* The fix the record points to. */
  if (suspects.length) {
    out +=
      "<p><strong>What would fix it:</strong> correct " +
      suspects.map((s) => "<code>" + esc(s.field || "") + "</code>").join(", ") +
      " — that is the field the recorded diagnosis points at." +
      (passReports.length
        ? " The same spec without the fault is recorded passing (" +
          esc(passReports[0].title || passReports[0].id) +
          ")."
        : "") +
      "</p>";
  } else if (status === "FAIL" || status === "MARGINAL") {
    out +=
      "<p><strong>What would fix it:</strong> no corrected re-run is recorded for " +
      esc(robot.name) +
      " yet. Its spec can go through the Workshop fix loop — the checks there decide whether a change holds.</p>";
  }

  const hits: Hit[] = [
    { kind: "robot", id: slugify(robot.name), label: dexId(robot) + " " + robot.name, route: robotRoute(root, robot) },
  ];
  if (robot.spec_file) hits.push(fixHit(robot));
  hits.push(demoHit());
  return { html: out, hits: hits };
}

/* ---------------- sources, from the answer's own hits ---------------- */

function sourcesFor(data: EngineData, root: string, ans: AnswerResult): SourceRef[] {
  const out: SourceRef[] = [];
  const seen: Record<string, number> = {};
  const push = (label: string, route: string) => {
    if (!route || seen[route] || out.length >= 3) return;
    seen[route] = 1;
    out.push({ label: label, route: route });
  };
  (ans.hits || []).forEach((h) => {
    if (h.kind === "robot" && h.route) {
      push("Robodex — " + h.label, h.route);
      const robot = (data.robots || []).find((r) => slugify(r.name) === h.id);
      if (robot) {
        const reps = reportsForRobot(data, robot);
        if (reps.length) {
          const rep = reps[reps.length - 1];
          push("Gate report — " + (rep.title || rep.id), evidenceRoute(root) + "#run-" + rep.id);
        } else if (/gate:/i.test(ans.html || "")) {
          push("Gate evidence", evidenceRoute(root));
        }
      }
    } else if (h.kind === "part" && h.id) {
      push("Parts catalogue — " + h.label, "/kit/?part=" + encodeURIComponent(h.id) + "#parts");
    } else if (h.kind === "kind") {
      push("Starter kinds — the Forge", "/forge/");
    } else if (h.kind === "route" && h.route) {
      push(h.label, h.route);
    }
  });
  return out;
}

/* ---------------- session memory ---------------- */

const REF_TOKENS = ["it", "its", "that", "this", "one", "they", "them", "their"];
const TOPICAL_TOKENS = [
  "gate", "verdict", "pass", "passed", "fail", "failed", "run", "runs",
  "battery", "wheel", "wheels", "motor", "motors", "sensor", "sensors",
  "spec", "specs", "weight", "heavy", "mass", "stable", "stability",
  "tip", "parts", "fix", "broken", "license", "source", "size", "big",
  "cost", "price", "camera", "lidar", "chassis", "computer", "height",
];

function isFollowUp(qt: string[]): boolean {
  const starts =
    qt[0] === "and" || phraseIn(qt, "what about") || phraseIn(qt, "how about");
  const pronoun = qt.some((t) => REF_TOKENS.indexOf(t) !== -1);
  const topical = qt.some((t) => TOPICAL_TOKENS.indexOf(t) !== -1);
  if ((pronoun || starts) && topical) return true;
  if (qt.length <= 4 && (pronoun || qt.indexOf("more") !== -1)) return true;
  return false;
}

function memoryFrom(ans: AnswerResult, prev: TurnMemory): TurnMemory {
  const hit = (ans.hits || []).find((h) => h.kind === "robot");
  if (!hit || !hit.id) return prev;
  return {
    robotSlug: hit.id,
    robotName: String(hit.label || "").replace(/^#\d+\s+/, ""),
  };
}

/* ---------------- failure-intent + demo intent ---------------- */

function failureIntent(qt: string[]): boolean {
  const has = (w: string) => qt.indexOf(w) !== -1;
  if (has("why") && (has("fail") || has("failed") || has("broken"))) return true;
  if (phraseIn(qt, "what would fix") || phraseIn(qt, "how do i fix") ||
      phraseIn(qt, "how to fix") || phraseIn(qt, "what fixes")) return true;
  if (has("fix") && (has("it") || has("this") || has("that"))) return true;
  return false;
}

function demoIntent(qt: string[]): boolean {
  if (phraseIn(qt, "recorded sample") || phraseIn(qt, "one click demo")) return true;
  if (qt.indexOf("demo") !== -1 &&
      ["run", "show", "watch", "play", "see"].some((w) => qt.indexOf(w) !== -1)) return true;
  if (phraseIn(qt, "run the sample")) return true;
  return false;
}

/* The UI's operation-verb gate routes "run …" to the live-model
 * translator before answers; the recorded-sample ask is an answer,
 * not an operation, so the UI asks this first. */
export function isDemoRequest(question: string): boolean {
  return demoIntent(tokens(String(question || "")));
}

/* ---------------- Omega1, RobotForge's own robot ---------------- */

/* Omega1 is the team's real rover and the Workshop's built-in
 * specimen. It is not a Robodex entry, so the engine alone answered
 * "do you know Omega1?" with the fallback (2026-11-03 demo
 * transcript). Every fact below comes from the records only:
 * lib/omega1Twin.ts (OMEGA1_FACTS) and docs/omega1/omega1.extracted.json
 * (Omega-Code @ 1d7bb60). Size and mass are not measured, and no gate
 * has ever run on Omega1, so nothing here claims either. This file
 * imports only ./engine (the eval harness compiles it standalone), so
 * the facts are restated here; tests/test_chat_omega1_wrench.py keeps
 * them in step with OMEGA1_FACTS. */

export const OMEGA1_SLUG = "omega1";
const OMEGA1_NAME = "Omega1";
const OMEGA1_MEM: TurnMemory = { robotName: OMEGA1_NAME, robotSlug: OMEGA1_SLUG };

const PERSON_REF = ["he", "him", "his", "hes", "she", "her", "hers", "shes"];

function workshopRoute(root: string): string {
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return base + "garage/#omega1";
}

function omega1Named(qt: string[]): boolean {
  if (["omega1", "omega", "freenove", "fnk0043"].some((w) => qt.indexOf(w) !== -1)) return true;
  return phraseIn(qt, "built in specimen") || qt.indexOf("specimen") !== -1;
}

/* The ask is about something the Workshop's how-to topics already
 * answer step by step (improve the twin, scans, measuring, wiring):
 * the engine's topic answer is the better reply. */
function omega1HowTo(qt: string[]): boolean {
  const how = qt.indexOf("how") !== -1 || qt.indexOf("can") !== -1;
  return (
    ["improve", "scan", "scans", "scanned", "upload", "adopt", "wiring", "wire", "wires"].some(
      (w) => qt.indexOf(w) !== -1
    ) ||
    (how && ["measure", "measuring", "twin", "add"].some((w) => qt.indexOf(w) !== -1))
  );
}

type Omega1Aspect =
  | "broken" | "power" | "sensors" | "drive" | "compute"
  | "control" | "size" | "gate" | "specimen" | "overview" | "unknown";

/* Words that make an ask an introduction ("do you know Omega1?",
 * "tell me about Omega1", or just "Omega1?"). Any other Omega1 ask
 * the aspects above do not cover is a fact the records do not hold. */
const INTRO_WORDS = ["know", "about", "who", "tell", "describe", "introduce", "overview", "summary", "explain", "more"];
const FILLER = ["omega", "omega1", "1", "freenove", "fnk0043", "what", "whats", "is", "s", "the", "a", "an", "this", "that", "he", "him", "hes", "it", "its", "and", "so", "ok", "okay", "hey", "wrench"];

function omega1Intro(qt: string[]): boolean {
  if (INTRO_WORDS.some((w) => qt.indexOf(w) !== -1)) return true;
  return qt.every((t) => FILLER.indexOf(t) !== -1);
}

/* An explicit list or catalogue ask ("show me robots that passed")
 * is not about the remembered robot, even when it says "that". */
function listAsk(qt: string[]): boolean {
  return ["robots", "which", "list", "show", "all", "any", "every", "parts", "catalogue", "catalog"].some(
    (w) => qt.indexOf(w) !== -1
  );
}

function omega1Aspect(qt: string[]): Omega1Aspect {
  const has = (ws: string[]) => ws.some((w) => qt.indexOf(w) !== -1);
  if (has(["broken", "broke", "wrong", "repair", "repairs", "fix", "fixed", "fixes", "problem", "problems", "issue", "issues", "damaged"]))
    return "broken";
  if (has(["gate", "gated", "pass", "passed", "fail", "failed", "verdict", "simulation", "sim", "gazebo", "tested", "test"]))
    return "gate";
  if (has(["battery", "batteries", "power", "voltage", "volts", "18650", "cells"])) return "power";
  if (has(["sensor", "sensors", "camera", "cameras", "ultrasonic", "lidar", "see", "sees"])) return "sensors";
  if (has(["wheel", "wheels", "motor", "motors", "drive", "drives", "track", "steer", "steering", "servo", "servos"]))
    return "drive";
  if (has(["computer", "compute", "pi", "raspberry", "jetson", "brain", "cpu"])) return "compute";
  if (has(["control", "controlled", "remote", "autonomous", "itself", "xbox", "controller", "teleop"]))
    return "control";
  if (has(["size", "big", "small", "weight", "weigh", "weighs", "heavy", "mass", "dimensions", "long", "wide", "tall"]))
    return "size";
  if (has(["specimen", "workshop", "looking", "see", "seeing", "here", "garage", "twin", "model"])) return "specimen";
  return omega1Intro(qt) ? "overview" : "unknown";
}

const OMEGA1_OVERVIEW =
  "<ul>" +
  "<li><strong>Base kit:</strong> Freenove FNK0043 4WD Raspberry Pi car.</li>" +
  "<li><strong>Drive:</strong> skid-steer, four driven wheels.</li>" +
  "<li><strong>Control:</strong> manual remote control (an Xbox controller in its code). It does not drive itself.</li>" +
  "<li><strong>Compute:</strong> Raspberry Pi 4B (4 GB). A Jetson Orin is planned, not fitted.</li>" +
  "<li><strong>Sensors:</strong> HC-SR04 ultrasonic and a camera, both at the front, plus three IR line-tracking sensors.</li>" +
  "<li><strong>Battery:</strong> 2× 18650 cells in series, 7.4 V nominal.</li>" +
  "<li><strong>Right now:</strong> off the bench, waiting for repair parts.</li>" +
  "</ul>";

const OMEGA1_REPAIRS =
  "<ul>" +
  "<li><strong>Loose camera pitch servo.</strong> Its code narrows the servo to 1300–1700 µs because of loose hardware. That is a real repair item.</li>" +
  "<li><strong>Track width disagrees.</strong> The motor code assumes a 0.20 m track, but the Freenove kit is only 0.15 m wide overall, so its turning maths is off until the track is measured.</li>" +
  "<li><strong>Two wheel sizes in the code.</strong> 0.05 m and 0.04 m radius. The real wheel has to be measured to settle it.</li>" +
  "</ul>";

const OMEGA1_NOT_RECORDED =
  "<p>Not recorded yet: its real size and mass. They still need a tape " +
  "measure and a scale. No gate has run on Omega1, so it has no " +
  "verdict.</p>";

function omega1Answer(qt: string[], root: string): AnswerResult {
  const aspect = omega1Aspect(qt);
  const lead = "<strong>Omega1</strong>";
  let html = "";
  switch (aspect) {
    case "specimen":
      html =
        "<p>That&rsquo;s " + lead + ", RobotForge&rsquo;s own robot. " +
        "Its digital twin began as the built-in specimen: a 3D model " +
        "generated from a photo of the real rover, so its shape and " +
        "size are <strong>estimates</strong>, not measurements. The " +
        "specimen entry is hidden now, but the twin itself lives on " +
        "your stored copy: open Omega1 in the Workshop and its " +
        "Overview opens on the 3D twin — drag to look around it, or " +
        "use its Turn control for the full 360.</p>" +
        "<p>Make the twin better with more input: attach a mesh " +
        "file (.glb) or a 3D scan (.ply) here in chat — the " +
        "Overview&rsquo;s &ldquo;Add a scan through Wrench&rdquo; button does " +
        "the same — or bring an Intel RealSense scan in through " +
        "Scan Studio, and the Overview opens on your scan instead " +
        "of the estimate. Its Checks pane lists only what the " +
        "records say. No gate has run on it, so it has no gate " +
        "verdict.</p>";
      break;
    case "broken":
      html =
        "<p>" + lead + " is off the bench waiting for repair parts. What " +
        "its records show needs fixing:</p>" + OMEGA1_REPAIRS +
        "<p>No gate has run on Omega1 yet, so none of this is a gate " +
        "result. It comes from its code and its kit documents.</p>";
      break;
    case "gate":
      html =
        "<p>No gate has run on " + lead + ", so it has no verdict, and I " +
        "won&rsquo;t make one up. A gate needs measured geometry, and its " +
        "size and mass are not measured yet. The repairs it is waiting " +
        "on:</p>" + OMEGA1_REPAIRS;
      break;
    case "power":
      html =
        "<p>" + lead + " runs on 2× 18650 cells in series, 7.4 V nominal. " +
        "Capacity and runtime are not recorded.</p>";
      break;
    case "sensors":
      html =
        "<p>" + lead + " has an HC-SR04 ultrasonic sensor and a camera " +
        "(OV5647), both at the front, plus three IR line-tracking sensors " +
        "underneath. The camera sits on a pitch servo that is loose, which " +
        "is one of its repair items.</p>";
      break;
    case "drive":
      html =
        "<p>" + lead + " is skid-steer: four driven wheels on a Freenove " +
        "FNK0043 4WD kit. Its code drives the motors through a PCA9685 PWM " +
        "hat. Two " +
        "things in its records disagree with the real robot:</p>" +
        OMEGA1_REPAIRS;
      break;
    case "compute":
      html =
        "<p>" + lead + " runs on a Raspberry Pi 4B (4 GB). A Jetson Orin is " +
        "planned in its code but not fitted.</p>";
      break;
    case "control":
      html =
        "<p>" + lead + " is driven by hand with remote control (an Xbox " +
        "controller in its code). It does not drive itself.</p>";
      break;
    case "size":
      html =
        "<p>" + lead + "&rsquo;s size and mass are not measured yet, so I " +
        "won&rsquo;t guess them. The Freenove kit is 0.15 m wide overall, but its code " +
        "assumes a 0.20 m track, which is why measuring comes first: a " +
        "RealSense scan gives the true size, and tape-measure numbers " +
        "added through Wrench cover the rest.</p>";
      break;
    case "unknown":
      /* Same honesty contract as the engine's fallback: say it is not
       * recorded, and flag it so a live model may take it when on. */
      return {
        html:
          "<p>That isn&rsquo;t in " + lead + "&rsquo;s records, so I&rsquo;d " +
          "rather say so than guess. What is recorded about it:</p>" +
          OMEGA1_OVERVIEW,
        chips: omega1Chips(aspect),
        hits: [{ kind: "route", label: "Workshop — Omega1", route: workshopRoute(root) }],
        fallback: true,
      };
    default:
      html =
        "<p>" + (qt.indexOf("know") !== -1 ? "Yes. " : "") + lead + " is RobotForge&rsquo;s own robot: a real " +
        "rover on its builder&rsquo;s bench. It is the robot the demo " +
        "is tested on.</p>" +
        OMEGA1_OVERVIEW;
  }
  if (aspect === "overview" || aspect === "specimen") html += OMEGA1_NOT_RECORDED;
  return {
    html: html,
    chips: omega1Chips(aspect),
    hits: [{ kind: "route", label: "Workshop — Omega1", route: workshopRoute(root) }],
  };
}

function omega1Chips(aspect: Omega1Aspect): string[] {
  const all = [
    "What's wrong with Omega1?",
    "Has Omega1 been gated?",
    "How do I improve my Omega1 twin?",
    "What sensors does Omega1 have?",
  ];
  const skip: Partial<Record<Omega1Aspect, string>> = {
    broken: all[0],
    gate: all[1],
    sensors: all[3],
  };
  return all.filter((c) => c !== skip[aspect]).slice(0, 3);
}

/* ---------------- contextual chips ---------------- */

function chipsForRobot(robot: RobotData): string[] {
  const name = robot.name;
  const status = String((robot.gate_status || {}).status || "NOT_GATED");
  if (status === "FAIL" || status === "MARGINAL") {
    return [
      "Why did " + name + " fail?",
      "What would fix " + name + "?",
      name + "'s key specs",
    ];
  }
  if (status === "PASS") {
    return [
      "Did " + name + " pass the gate?",
      name + "'s recorded runs",
      name + "'s key specs",
    ];
  }
  return [
    "Tell me about " + name,
    "Is " + name + " gated?",
    name + "'s key specs",
  ];
}

/* ---------------- yours vs the Robodex (2026-11-04) ----------------
 * The user's robots are exactly the active robots in their Workshop
 * — the same list the Robodex's My robots tab shows. Every other
 * robot Wrench knows (the Robodex catalog, sightings, Omega1's
 * records) is a reference robot, not theirs, and Wrench says which
 * is which instead of blurring them. */

function ownedNames(data: EngineData): string[] | null {
  if (!data.myRobots) return null;
  try {
    return data.myRobots();
  } catch {
    return null;
  }
}

function ownsName(owned: string[], name: string): boolean {
  const key = slugify(name);
  return owned.some((n) => slugify(n) === key);
}

const MY_ROBOTS_ASK =
  /^(?:(?:what|which) robots (?:do i (?:have|own)|are mine|are my own|have i got)|(?:what|which|who) are my robots|(?:show|list|show me) my robots|my robots|which (?:ones|robots) (?:are|is) mine|which robots belong to me)\s*[?.!]*$/i;
const IS_MINE_ASK =
  /^(?:is|are) (?:the )?"?(.+?)"? (?:mine|my robots?|one of my robots|in my workshop)\s*[?.!]*$|^do i (?:own|have) (?:a |an |the )?"?(.+?)"?(?: robot)?\s*[?.!]*$/i;

function workshopHit(root: string): Hit {
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return { kind: "route", label: "Your Workshop", route: base + "garage/" };
}

function myRobotsHit(root: string): Hit {
  const base = root ? root.replace(/\/?$/, "/") : "/";
  return { kind: "route", label: "Robodex — My robots", route: base + "robots/#source=mine" };
}

function myRobotsAnswer(owned: string[], root: string): AnswerResult {
  const list = owned.map((n) => "<strong>" + esc(n) + "</strong>").join(", ");
  const html = owned.length
    ? "<p>Your robots are the ones in your Workshop: " + list + ". That is exactly what " +
      "My robots in the Robodex shows.</p><p>Every other robot in the Robodex " +
      "(researched, sighted or from photos) is a reference robot, not yours. Bring one into " +
      "your Workshop and it becomes one of yours.</p>"
    : "<p>You don&rsquo;t have any robots of your own yet: your Workshop is empty, so My " +
      "robots in the Robodex is empty too. The Robodex robots are reference robots, not " +
      "yours. Bring one into your Workshop from a photo, a spec file or the Robodex and it " +
      "becomes yours.</p>";
  return { html, hits: [workshopHit(root), myRobotsHit(root)] };
}

function isMineAnswer(name: string, owned: string[], robots: RobotData[], root: string): AnswerResult {
  const dex = matchRobot(tokens(name), robots);
  if (ownsName(owned, name) || (dex && ownsName(owned, dex.name))) {
    const shown = owned.find((n) => slugify(n) === slugify(name)) || (dex ? dex.name : name);
    return {
      html: "<p>Yes. <strong>" + esc(shown) + "</strong> is in your Workshop, so it is one of " +
        "your robots and it shows under My robots in the Robodex.</p>",
      hits: [workshopHit(root), myRobotsHit(root)],
    };
  }
  if (dex) {
    return {
      html: "<p>No. <strong>" + esc(dex.name) + "</strong> is a Robodex robot, not one of " +
        "yours: it isn&rsquo;t in your Workshop. Say &ldquo;move &quot;" + esc(dex.name) +
        "&quot; to my robots&rdquo; to bring it in from its recorded spec.</p>",
      hits: [{ kind: "robot", id: slugify(dex.name), label: dex.name, route: robotRoute(root, dex) }, workshopHit(root)],
    };
  }
  if (slugify(name) === OMEGA1_SLUG) {
    return {
      html: "<p>Not right now. <strong>Omega1</strong> isn&rsquo;t in your Workshop, so it " +
        "isn&rsquo;t one of your robots here. Open it from the Workshop link and a copy is " +
        "added from its records.</p>",
      hits: [{ kind: "route", label: "Workshop — Omega1", route: workshopRoute(root) }],
    };
  }
  return {
    html: "<p>I don&rsquo;t see a robot called <strong>" + esc(name) + "</strong> in your " +
      "Workshop, so it isn&rsquo;t one of your robots.</p>",
    hits: [workshopHit(root), myRobotsHit(root)],
  };
}

/* One line under an answer about a single Robodex robot: is it yours? */
function ownershipNote(ans: AnswerResult, owned: string[] | null, robots: RobotData[]): AnswerResult {
  if (!owned || ans.fallback) return ans;
  const robotHits = (ans.hits || []).filter((h) => h.kind === "robot");
  if (robotHits.length !== 1) return ans;
  const robot = robots.find((r) => slugify(r.name) === robotHits[0].id);
  if (!robot) return ans;
  const name = robot.name;
  const note = ownsName(owned, name)
    ? "<p class=\"fc-dim\">You also have <strong>" + esc(name) + "</strong> in your " +
      "Workshop. The answer above is the Robodex record; your copy lives in the Workshop.</p>"
    : "<p class=\"fc-dim\"><strong>" + esc(name) + "</strong> is a Robodex robot, not " +
      "one of yours.</p>";
  return { ...ans, html: ans.html + note };
}

/* ---------------- the wrench ---------------- */

export function createWrench(data: EngineData): Wrench {
  const engine: Engine = createEngine(data);
  const root = data.root || "";
  const robots = (data.robots || []).slice().sort((a, b) => Number(a.number) - Number(b.number));

  function finish(raw: AnswerResult, mem: TurnMemory): TurnResult {
    const ans = ownershipNote(raw, ownedNames(data), robots);
    return {
      html: ans.html,
      chips: ans.chips,
      hits: ans.hits,
      fallback: ans.fallback,
      sources: sourcesFor(data, root, ans),
      memory: memoryFrom(ans, mem),
    };
  }

  function answerTurn(question: string, mem: TurnMemory): TurnResult {
    const q = String(question || "");
    const qt = tokens(q);
    if (!qt.length) return finish(engine.answer(q), mem);

    /* Yours vs the Robodex: "what robots do I have?", "is Spot mine?" */
    const owned = ownedNames(data);
    if (owned) {
      const trimmed = q.trim();
      if (MY_ROBOTS_ASK.test(trimmed)) return finish(myRobotsAnswer(owned, root), mem);
      const mine = IS_MINE_ASK.exec(trimmed);
      const askedName = mine ? (mine[1] || mine[2] || "").trim() : "";
      /* "do I have …" also asks about parts and tools: answer it here
       * only when it names a robot (yours, a Robodex one, or Omega1). */
      const namesRobot = (n: string) =>
        ownsName(owned, n) || !!matchRobot(tokens(n), robots) || slugify(n) === OMEGA1_SLUG;
      if (askedName && !/^(?:any|anything|robots?)$/i.test(askedName) &&
          (mine![1] ? true : namesRobot(askedName))) {
        return finish(isMineAnswer(askedName, owned, robots, root), mem);
      }
    }

    /* Failure explanations come from the record, structured —
     * they pre-empt the generic robot answer for why/fix asks. */
    if (failureIntent(qt)) {
      const named = matchRobot(qt, robots);
      const remembered =
        !named && mem.robotSlug
          ? robots.find((r) => slugify(r.name) === mem.robotSlug) || null
          : null;
      const robot = named || remembered;
      if (robot) {
        const fa = failureAnswer(data, root, robot);
        if (fa) return finish(fa, mem);
      }
    }

    if (demoIntent(qt)) {
      return finish(
        {
          html:
            "<p>The Demo page runs the whole story in one click: a broken " +
            "robot goes in, the engineering checks catch what is wrong, " +
            "Muse Spark proposes a fix the checks must accept, and the " +
            "simulation evidence — a recorded run, labelled recorded — " +
            "shows the result.</p>",
          hits: [demoHit(), { kind: "route", label: "Gate evidence", route: evidenceRoute(root) }],
        },
        mem
      );
    }

    /* Omega1: named, or carried over from the last turn by a
     * pronoun ("he's in my workshop"). How-to asks still go to the
     * engine's Workshop topics, which answer them step by step. */
    const named = omega1Named(qt);
    const carried =
      !named &&
      mem.robotSlug === OMEGA1_SLUG &&
      !listAsk(qt) &&
      (qt.some((t) => PERSON_REF.indexOf(t) !== -1) || isFollowUp(qt));
    if ((named || carried) && !omega1HowTo(qt) && !matchRobot(qt, robots)) {
      const oa = omega1Answer(qt, root);
      if (owned) {
        oa.html += ownsName(owned, OMEGA1_NAME)
          ? "<p class=\"fc-dim\">Omega1 is in your Workshop, so it is one of your robots.</p>"
          : "<p class=\"fc-dim\">Omega1 isn&rsquo;t in your Workshop right now, so it isn&rsquo;t " +
            "one of your robots here and My robots doesn&rsquo;t list it. Open it from the " +
            "Workshop link to add a copy from its records.</p>";
      }
      return { ...finish(oa, mem), memory: OMEGA1_MEM };
    }

    let ans = engine.answer(q);

    /* Session memory: a follow-up that names no robot resolves
     * against the remembered one. The direct answer may be a
     * catalogue detour (a bare "battery" matches parts before it
     * matches the conversation), so the retry fires whenever the
     * follow-up did not itself resolve to the remembered robot —
     * and it only replaces the direct answer when it lands on
     * that robot, or when the direct answer was the fallback. */
    if (named) return { ...finish(ans, mem), memory: OMEGA1_MEM };
    if (mem.robotName && mem.robotSlug && mem.robotSlug !== OMEGA1_SLUG && isFollowUp(qt)) {
      const resolvedToMem = (a: AnswerResult) =>
        (a.hits || []).some((h) => h.kind === "robot" && h.id === mem.robotSlug);
      if (!resolvedToMem(ans)) {
        const retry = engine.answer(q + " " + mem.robotName);
        if (resolvedToMem(retry) || (ans.fallback && !retry.fallback)) ans = retry;
      }
    }
    return finish(ans, mem);
  }

  function contextChips(pathname: string, mem: TurnMemory): string[] {
    const p = String(pathname || "").replace(/\/+$/, "");
    const m = /^\/robots\/([^/]+)$/.exec(p);
    if (m) {
      const robot = robots.find((r) => slugify(r.name) === m[1]);
      if (robot) return chipsForRobot(robot);
    }
    if (p === "/kit" || p.indexOf("/kit/") === 0) {
      return ["Add a RealSense camera and an RPLIDAR A1 to my build", "Show me batteries", "What is a TB6612FNG?", "Plan a differential rover build"];
    }
    if (p === "/evidence" || p.indexOf("/evidence/") === 0) {
      return ["Show me the reports", "Which robots failed the gate?", "What are the gate thresholds?"];
    }
    if (p === "/demo" || p.indexOf("/demo/") === 0) {
      return ["Why did Andino fail?", "Which robots passed the gate?", "How does the gate work?"];
    }
    if (mem.robotName) {
      const robot = robots.find((r) => r.name === mem.robotName);
      if (robot) return chipsForRobot(robot).slice(0, 2).concat(engine.suggestions.slice(0, 1));
    }
    return engine.suggestions.slice(0, 4);
  }

  return { answerTurn: answerTurn, contextChips: contextChips, suggestions: engine.suggestions };
}
