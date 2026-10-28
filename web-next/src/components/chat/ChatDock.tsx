"use client";
/* Forge Guide widget — the chat UI (React port of assets/js/chat.js).
 *
 * Answering is done by ./engine.ts (the chat-engine.js port) from the
 * site's recorded data, and the local recorded answer is ALWAYS the
 * default: instant, and the only answer whenever no live endpoint is
 * configured.
 *
 * Live-model hook: when a deployment configures the live endpoint
 * (LIVE_ENDPOINT below — empty in the committed site, mirroring
 * assets/js/live-config.js) and /health answers, a question the local
 * engine honestly cannot answer (its `fallback: true` result) is
 * offered to the live model at POST /chat. The reply is rendered
 * escaped and badged "LIVE MODEL — not from recorded RobotForge
 * data". If the endpoint errors or is over budget, the Guide says
 * so plainly and keeps the local answer. No API keys ever live in
 * this file or any page: the endpoint holds them server-side.
 *
 * Data: the vanilla widget fetched catalog/*.json at runtime; here
 * the same JSON is statically imported (see @/lib/data and @/data),
 * so the engine is built synchronously and no fetching happens.
 *
 * Routes: the engine already returns Next routes (/robots/<slug>/,
 * /evidence/, /forge/). Robot/kind/route hits navigate with the Next
 * router; part hits dispatch a window CustomEvent "rf-focus-part"
 * (detail {id}) and land on /robots/?part=<id>#parts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const LIVE_ENDPOINT = "";

const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "What are the gate thresholds?",
  "Tell me about Andino",
  "How does RobotForge work?",
];

const SUB_RECORDED =
  "Answers from RobotForge's recorded data (not a live AI) — the Robodex, the parts catalogue and the recorded gate reports.";
const SUB_LIVE =
  "Recorded data first — the Robodex, the parts catalogue and the recorded gate reports. Questions they can’t answer go to a live model, badged LIVE MODEL.";

const LIVE_BADGE =
  "LIVE MODEL — not from recorded RobotForge data; check numbers on the Evidence page";

function buildEngine(): Engine {
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

interface LiveHealth {
  ok?: boolean;
  mode?: string;
  routes?: { chat?: boolean };
  budget?: { exhausted?: boolean };
  [key: string]: unknown;
}

interface Msg {
  id: number;
  who: "bot" | "user";
  html?: string;
  text?: string;
  hits?: Hit[];
}

let nextId = 1;

export function ChatWidget({ docked }: { docked: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildEngine, []);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChipsState] = useState<string[]>(DEFAULT_CHIPS);
  const [inputValue, setInputValue] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [subText, setSubText] = useState(SUB_RECORDED);

  const msgsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const greetedRef = useRef(false);
  const healthRef = useRef<Promise<LiveHealth | null> | null>(null);

  /* Docked mode (app pages, wide screens): the panel is a fixed
   * left rail and is simply open — there is nothing to toggle. The
   * media query mirrors the one in chat.css / app.css. */
  const dockedWide = docked && wide;
  const open = docked ? dockedWide || manualOpen : manualOpen;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    setWide(mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setWide(ev.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const setChips = useCallback(
    (list: string[] | undefined | null) => {
      setChipsState(list && list.length ? list : DEFAULT_CHIPS);
    },
    []
  );

  const appendMsg = useCallback((msg: Omit<Msg, "id">): number => {
    const id = nextId++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const noteBubble = useCallback(
    (text: string) => {
      appendMsg({ who: "bot", text });
    },
    [appendMsg]
  );

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
        .then((h) => {
          if (h && h.ok && h.mode === "live" && h.routes && h.routes.chat) {
            setSubText(SUB_LIVE);
          }
          return h;
        })
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

  /* ---------------- greeting ---------------- */

  const greet = useCallback(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    appendMsg({
      who: "bot",
      html:
        "<p>Hello — I&rsquo;m the <strong>Forge Guide</strong>. I answer " +
        "from RobotForge&rsquo;s recorded data (the Robodex, the parts catalogue " +
        "and the recorded gate reports), not from a live AI.</p>" +
        "<p>Ask about a robot by name or number, a catalogue part, or how the " +
        "gate works — or tap a suggestion.</p>",
    });
    setChips(engine.suggestions);
  }, [appendMsg, engine, setChips]);

  useEffect(() => {
    if (!open) return;
    greet();
    void checkLive(); // updates the header disclosure when live is on
    /* Auto-focus only with a fine pointer: on touch devices the
     * keyboard would immediately cover the panel the user just
     * opened. */
    if (!dockedWide && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [open, dockedWide, greet, checkLive]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && open && !dockedWide) setManualOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dockedWide]);

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
    (hit: Hit) => {
      if (!hit.id) return;
      dispatchFocusPart(hit.id);
      const url = "/robots/?part=" + encodeURIComponent(hit.id) + "#parts";
      if (onRobotsPage) {
        noteBubble(
          "I highlighted “" + hit.label + "” in the parts catalogue on this page."
        );
        router.replace(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [dispatchFocusPart, noteBubble, onRobotsPage, router]
  );

  /* A real in-page action, not just an answer: on a page with the
   * catalogue's own search box, "find lidar" / "show servos" drives
   * that box, so the page itself responds to the conversation. */
  const filterPartsHere = useCallback(
    (q: string) => {
      const ps = document.getElementById("part-search") as HTMLInputElement | null;
      if (!ps) return;
      const m = q.match(/^(?:find|search|show(?: me)?|filter)\s+(.+)$/i);
      if (!m) return;
      ps.value = m[1].trim();
      ps.dispatchEvent(new Event("input", { bubbles: true }));
      noteBubble(
        "I filtered the parts catalogue on this page for “" +
          m[1].trim() +
          "” — it is just below."
      );
      const sec = document.getElementById("parts");
      if (sec) sec.scrollIntoView({ behavior: "smooth" });
    },
    [noteBubble]
  );

  /* After an answer, act on a find/show question: highlight the
   * first part hit in the catalogue when this page has one. Falls
   * back to the original search-box behaviour when there are no
   * structured hits to act on. */
  const autoAction = useCallback(
    (q: string, ans: AnswerResult) => {
      if (/^(find|search|show|filter)\b/i.test(q) && ans.hits) {
        const partHits = ans.hits.filter((h) => h.kind === "part");
        if (partHits.length && onRobotsPage && partHits[0].id) {
          dispatchFocusPart(partHits[0].id);
          noteBubble(
            "I highlighted the first match, “" +
              partHits[0].label +
              "”, in the catalogue on this page — tap any result " +
              "button to pop another one up."
          );
          return;
        }
      }
      filterPartsHere(q);
    },
    [dispatchFocusPart, filterPartsHere, noteBubble, onRobotsPage]
  );

  /* ---------------- asking ---------------- */

  const ask = useCallback(
    (question: string) => {
      const q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: q });
      setInputValue("");
      const waitId = appendMsg({
        who: "bot",
        html: '<p class="fc-dim">Checking the recorded data&hellip;</p>',
      });
      const done = (ans: AnswerResult) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === waitId ? { ...m, html: ans.html, hits: ans.hits } : m
          )
        );
        setChips(ans.chips || engine.suggestions);
        autoAction(q, ans);
      };
      /* The vanilla widget answers inside its data-load promise, so
       * the "Checking…" bubble paints first; the data here is a
       * static import, so defer one tick to keep the same rhythm. */
      window.setTimeout(() => {
        const ans = engine.answer(q);
        /* Recorded answers stay the default and stay instant: only
         * the engine's honest fallback may go live. */
        if (!ans.fallback || !liveBase()) {
          done(ans);
          return;
        }
        void checkLive().then((h) => {
          if (!liveUsable(h)) {
            /* Endpoint configured but not usable: say so only when
             * the reason is budget/kill-switch (a plain note under
             * the local answer); a silent endpoint keeps the plain
             * local behavior. */
            if (h && h.ok && (h.mode === "off" || (h.budget && h.budget.exhausted))) {
              done({
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
              done(ans);
            }
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === waitId
                ? {
                    ...m,
                    html:
                      '<p class="fc-dim">The recorded data ' +
                      "doesn&rsquo;t have that &mdash; asking the live model&hellip;</p>",
                  }
                : m
            )
          );
          liveChat(q)
            .then((answer) => {
              done({
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
              done({
                html: ans.html + '<p class="fc-live-note">' + note + "</p>",
                chips: ans.chips,
              });
            });
        });
      }, 0);
    },
    [appendMsg, autoAction, checkLive, engine, liveBase, liveChat, setChips]
  );

  const onHitClick = (h: Hit) => {
    if (h.kind === "part") focusPartHit(h);
    else if (h.route) router.push(h.route);
  };

  const toggle = () => {
    if (!dockedWide) setManualOpen((v) => !v);
  };
  const close = () => {
    if (!dockedWide) setManualOpen(false);
  };

  return (
    <div className={docked ? "forge-chat docked" : "forge-chat"} id="forge-chat">
      <button
        className="fc-launcher"
        id="fc-launcher"
        type="button"
        aria-expanded={open ? "true" : "false"}
        aria-controls="fc-panel"
        onClick={toggle}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z" />
          <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
        </svg>
        <span>Forge Guide</span>
      </button>
      <section
        className="fc-panel"
        id="fc-panel"
        hidden={!open}
        role="dialog"
        aria-label="Forge Guide chat"
      >
        <header className="fc-head">
          <div>
            <strong>Forge Guide</strong>
            <span className="fc-sub">{subText}</span>
          </div>
          <button
            className="fc-close"
            id="fc-close"
            type="button"
            aria-label="Close chat"
            onClick={close}
          >
            &times;
          </button>
        </header>
        <div className="fc-msgs" id="fc-msgs" role="log" aria-live="polite" ref={msgsRef}>
          {messages.map((m) =>
            m.who === "user" ? (
              <div className="fc-msg user" key={m.id}>
                {m.text}
              </div>
            ) : (
              <div className="fc-msg bot" key={m.id}>
                <div dangerouslySetInnerHTML={{ __html: m.html || "" }} />
                {m.text ? <p>{m.text}</p> : null}
                {m.hits && m.hits.length ? (
                  <div className="fc-hits">
                    {m.hits.slice(0, 6).map((h, i) => (
                      <button
                        type="button"
                        className="fc-hit"
                        data-kind={h.kind || ""}
                        key={i}
                        onClick={() => onHitClick(h)}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          )}
        </div>
        <div className="fc-chips" id="fc-chips" aria-label="Suggested questions">
          {chips.map((q, i) => (
            <button
              type="button"
              className="chip"
              key={i}
              onClick={() => ask(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="fc-form"
          id="fc-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            ask(inputValue);
          }}
        >
          <input
            id="fc-input"
            type="text"
            autoComplete="off"
            placeholder="Ask about a robot, a part, or the gate…"
            aria-label="Your question"
            ref={inputRef}
            value={inputValue}
            onChange={(ev) => setInputValue(ev.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit">
            Ask
          </button>
        </form>
      </section>
    </div>
  );
}

/* Docked variant: the same chat as a persistent left rail inside
 * the app shell (site.py chat_widget(docked=True)). At min-width
 * 1280px the panel is simply open; below that it behaves as the
 * toggleable panel, mirroring the vanilla media query. */
export default function ChatDock() {
  return <ChatWidget docked />;
}
