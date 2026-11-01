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

/* ---------------- the wrench ---------------- */

export function createWrench(data: EngineData): Wrench {
  const engine: Engine = createEngine(data);
  const root = data.root || "";
  const robots = (data.robots || []).slice().sort((a, b) => Number(a.number) - Number(b.number));

  function finish(ans: AnswerResult, mem: TurnMemory): TurnResult {
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

    let ans = engine.answer(q);

    /* Session memory: a follow-up that names no robot resolves
     * against the remembered one. The direct answer may be a
     * catalogue detour (a bare "battery" matches parts before it
     * matches the conversation), so the retry fires whenever the
     * follow-up did not itself resolve to the remembered robot —
     * and it only replaces the direct answer when it lands on
     * that robot, or when the direct answer was the fallback. */
    if (mem.robotName && mem.robotSlug && isFollowUp(qt)) {
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
      return ["Show me batteries", "What is a TB6612FNG?", "Plan a differential rover build"];
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
