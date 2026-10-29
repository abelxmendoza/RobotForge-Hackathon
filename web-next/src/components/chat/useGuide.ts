"use client";
/* Forge Guide ask/live/health logic — extracted from ChatDock.tsx
 * (plan §1, One Forge) so the SAME Guide brain drives both chat
 * surfaces: the floating Guide widget (landing) and the merged
 * Forge thread (/forge), where Guide answers render as in-thread
 * entries. The engine (./engine.ts) is unchanged and always
 * answers first from the recorded data; only its honest fallback
 * may go to the live model at POST /chat, badged LIVE MODEL.
 *
 * The hook is presentation-free: the host supplies callbacks for
 * the pending bubble, the final answer and plain-text notes, and
 * renders them in its own idiom (chat bubbles in the widget,
 * thread entries in the Forge). Badge and note strings are the
 * widget's originals, copied verbatim — never paraphrased.
 *
 * Data: the catalog JSON is statically imported (see @/lib/data
 * and @/data), so the engine is built synchronously and no
 * fetching happens.
 *
 * Routes: the engine already returns Next routes (/robots/<slug>/,
 * /evidence/, /forge/). Robot/kind/route hits navigate with the
 * Next router; part hits dispatch a window CustomEvent
 * "rf-focus-part" (detail {id}) and land on /robots/?part=<id>#parts.
 */
import { useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createEngine,
  esc,
  type AnswerResult,
  type Engine,
  type Hit,
  type IntentsData,
  type KindData,
  type PartData,
  type ReportsData,
  type RobotData,
  type TemplateData,
} from "./engine";
import { gateReports, parts, robots } from "@/lib/data";
import partsDoc from "@/data/parts.json";
import kindsDoc from "@/data/kinds.json";
import intentsDoc from "@/data/chat-intents.json";

/* Deployment live-endpoint config (assets/js/live-config.js in the
 * vanilla site): EMPTY in the committed site — recorded answers
 * only, no network calls, no badges. */
const LIVE_ENDPOINT = "https://robotforge-live.abelxmendoza.workers.dev";

export const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "What are the gate thresholds?",
  "Tell me about Andino",
  "How does RobotForge work?",
];

export const SUB_RECORDED =
  "Answers from RobotForge's recorded data (not a live AI) — the Robodex, the parts catalogue and the recorded gate reports.";
export const SUB_LIVE =
  "Recorded data first — the Robodex, the parts catalogue and the recorded gate reports. Questions they can’t answer go to a live model, badged LIVE MODEL.";

export const LIVE_BADGE =
  "LIVE MODEL — not from recorded RobotForge data; check numbers on the Evidence page";

export const PENDING_HTML =
  '<p class="fc-dim">Checking the recorded data&hellip;</p>';
export const LIVE_PENDING_HTML =
  '<p class="fc-dim">The recorded data ' +
  "doesn&rsquo;t have that &mdash; asking the live model&hellip;</p>";

export function buildGuideEngine(): Engine {
  const templates =
    (partsDoc as unknown as { templates?: TemplateData[] }).templates || [];
  return createEngine({
    robots: robots as unknown as RobotData[],
    parts: parts as unknown as PartData[],
    templates: templates.length,
    templateList: templates,
    kinds: (kindsDoc as { kinds?: KindData[] }).kinds || [],
    reports: { runs: gateReports } as unknown as ReportsData,
    intents: intentsDoc as unknown as IntentsData,
    root: "",
  });
}

export interface LiveHealth {
  ok?: boolean;
  mode?: string;
  routes?: { chat?: boolean };
  budget?: { exhausted?: boolean };
  [key: string]: unknown;
}

/* What a host must supply to present an ask: a pending state, a
 * live-pending state (the recorded data missed, the model is being
 * asked), the final answer, and a channel for plain-text notes
 * (the in-page-action bubbles: part highlighted, catalogue
 * filtered). */
export interface GuideHost {
  onPending: () => void;
  onLivePending: () => void;
  onAnswer: (view: AnswerResult) => void;
  onNote: (text: string) => void;
}

export type GuideFallbackHost = Pick<
  GuideHost,
  "onLivePending" | "onAnswer" | "onNote"
>;

export function useGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildGuideEngine, []);
  const healthRef = useRef<Promise<LiveHealth | null> | null>(null);

  /* ---------------- live model (deployment-configured) ------------ */

  const liveBase = useCallback((): string => {
    const base = LIVE_ENDPOINT || "";
    return String(base).replace(/\/+$/, "");
  }, []);

  const checkLive = useCallback((): Promise<LiveHealth | null> => {
    /* Cached /health probe: resolves to the health JSON when the
     * endpoint is configured AND answering AND able to run chat;
     * resolves to null otherwise. With no endpoint configured (the
     * shipped site) it resolves null immediately — no network call. */
    if (!liveBase()) return Promise.resolve(null);
    if (!healthRef.current) {
      healthRef.current = fetch(liveBase() + "/health", { cache: "no-cache" })
        .then((r) => (r.ok ? (r.json() as Promise<LiveHealth>) : null))
        .catch(() => null);
    }
    return healthRef.current;
  }, [liveBase]);

  const liveUsable = (h: LiveHealth | null): boolean =>
    Boolean(
      h && h.ok && h.mode === "live" && h.routes && h.routes.chat &&
        !(h.budget && h.budget.exhausted)
    );

  const liveChat = useCallback(
    (q: string): Promise<string> =>
      fetch(liveBase() + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      }).then((r) =>
        r
          .json()
          .catch(() => null)
          .then((body: { answer?: unknown; error?: string; code?: string } | null) => {
            if (!r.ok) {
              const e = new Error(
                (body && body.error) || "endpoint -> " + r.status
              ) as Error & { code?: string; status?: number };
              e.code = body ? body.code : undefined;
              e.status = r.status;
              throw e;
            }
            if (!body || typeof body.answer !== "string") {
              throw new Error("endpoint returned no answer");
            }
            return body.answer;
          })
      ),
    [liveBase]
  );

  /* ---------------- part focus + in-page actions ---------------- */

  const onRobotsPage = Boolean(pathname && pathname.startsWith("/robots"));

  const dispatchFocusPart = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent("rf-focus-part", { detail: { id } })
    );
  }, []);

  /* A part hit: on the Robots page, focus the part there (event +
   * the ?part= deep link the page understands); from anywhere else,
   * navigate to that deep link. */
  const focusPartHit = useCallback(
    (hit: Hit, note: (text: string) => void) => {
      if (!hit.id) return;
      dispatchFocusPart(hit.id);
      const url = "/robots/?part=" + encodeURIComponent(hit.id) + "#parts";
      if (onRobotsPage) {
        note(
          "I highlighted “" + hit.label + "” in the parts catalogue on this page."
        );
        router.replace(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [dispatchFocusPart, onRobotsPage, router]
  );

  /* A real in-page action, not just an answer: on a page with the
   * catalogue's own search box, "find lidar" / "show servos" drives
   * that box, so the page itself responds to the conversation. */
  const filterPartsHere = useCallback(
    (q: string, note: (text: string) => void) => {
      const ps = document.getElementById("part-search") as HTMLInputElement | null;
      if (!ps) return;
      const m = q.match(/^(?:find|search|show(?: me)?|filter)\s+(.+)$/i);
      if (!m) return;
      ps.value = m[1].trim();
      ps.dispatchEvent(new Event("input", { bubbles: true }));
      note(
        "I filtered the parts catalogue on this page for “" +
          m[1].trim() +
          "” — it is just below."
      );
      const sec = document.getElementById("parts");
      if (sec) sec.scrollIntoView({ behavior: "smooth" });
    },
    []
  );

  /* After an answer, act on a find/show question: highlight the
   * first part hit in the catalogue when this page has one. Falls
   * back to the original search-box behaviour when there are no
   * structured hits to act on. */
  const autoAction = useCallback(
    (q: string, ans: AnswerResult, note: (text: string) => void) => {
      if (/^(find|search|show|filter)\b/i.test(q) && ans.hits) {
        const partHits = ans.hits.filter((h) => h.kind === "part");
        if (partHits.length && onRobotsPage && partHits[0].id) {
          dispatchFocusPart(partHits[0].id);
          note(
            "I highlighted the first match, “" +
              partHits[0].label +
              "”, in the catalogue on this page — tap any result " +
              "button to pop another one up."
          );
          return;
        }
      }
      filterPartsHere(q, note);
    },
    [dispatchFocusPart, filterPartsHere, onRobotsPage]
  );

  const handleHit = useCallback(
    (h: Hit, note: (text: string) => void) => {
      if (h.kind === "part") focusPartHit(h, note);
      else if (h.route) router.push(h.route);
    },
    [focusPartHit, router]
  );

  /* ---------------- fallback resolution (live routing) ------------ */

  /* The engine honestly could not answer (fallback: true): offer
   * the question to the live model when the endpoint can run chat,
   * exactly as the widget always has — the reply is badged LIVE
   * MODEL; an unusable endpoint keeps the local answer, saying so
   * only when the reason is budget/kill-switch. Resolves when the
   * final answer has been handed to the host. */
  const resolveFallback = useCallback(
    (q: string, ans: AnswerResult, host: GuideFallbackHost): Promise<void> => {
      const finish = (view: AnswerResult) => {
        host.onAnswer(view);
        autoAction(q, view, host.onNote);
      };
      if (!liveBase()) {
        finish(ans);
        return Promise.resolve();
      }
      return checkLive().then((h) => {
        if (!liveUsable(h)) {
          /* Endpoint configured but not usable: say so only when
           * the reason is budget/kill-switch (a plain note under
           * the local answer); a silent endpoint keeps the plain
           * local behavior. */
          if (h && h.ok && (h.mode === "off" || (h.budget && h.budget.exhausted))) {
            finish({
              html:
                ans.html +
                '<p class="fc-live-note">The live model is ' +
                (h.mode === "off"
                  ? "switched off at the endpoint"
                  : "out of budget for today") +
                ", so this answer is from the recorded data only.</p>",
              chips: ans.chips,
            });
          } else {
            finish(ans);
          }
          return;
        }
        host.onLivePending();
        return liveChat(q)
          .then((answer) => {
            finish({
              html:
                '<p><span class="fc-live-badge">' +
                LIVE_BADGE +
                "</span></p><p>" +
                esc(answer).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") +
                "</p>",
              chips: ans.chips,
            });
          })
          .catch((e: Error & { code?: string }) => {
            const note =
              e && e.code === "budget_exhausted"
                ? "The live model&rsquo;s budget for today is used up, so " +
                  "this answer is from the recorded data only."
                : "The live endpoint isn&rsquo;t answering, so this answer " +
                  "is from the recorded data only.";
            finish({
              html: ans.html + '<p class="fc-live-note">' + note + "</p>",
              chips: ans.chips,
            });
          });
      });
    },
    [autoAction, checkLive, liveBase, liveChat]
  );

  /* ---------------- asking ---------------- */

  /* The full ask: pending state, engine first (deferred one tick
   * so the pending state paints, as the widget always did), then
   * the fallback routing. The caller presents the user message
   * itself before calling. */
  const ask = useCallback(
    (question: string, host: GuideHost) => {
      const q = String(question || "").trim();
      if (!q) return;
      host.onPending();
      /* The vanilla widget answers inside its data-load promise, so
       * the "Checking…" bubble paints first; the data here is a
       * static import, so defer one tick to keep the same rhythm. */
      window.setTimeout(() => {
        const ans = engine.answer(q);
        /* Recorded answers stay the default and stay instant: only
         * the engine's honest fallback may go live. */
        if (!ans.fallback) {
          host.onAnswer(ans);
          autoAction(q, ans, host.onNote);
          return;
        }
        void resolveFallback(q, ans, host);
      }, 0);
    },
    [autoAction, engine, resolveFallback]
  );

  return { engine, ask, resolveFallback, checkLive, handleHit, autoAction };
}
