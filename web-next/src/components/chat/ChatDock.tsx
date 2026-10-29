"use client";
/* Forge Guide widget — the chat UI (React port of assets/js/chat.js).
 *
 * The ask/live/health logic lives in ./useGuide.ts (extracted for
 * the One Forge merge, plan §1): the engine in ./engine.ts answers
 * from the site's recorded data, and the local recorded answer is
 * ALWAYS the default — instant, and the only answer whenever no
 * live endpoint is configured. A question the local engine
 * honestly cannot answer (its `fallback: true` result) is offered
 * to the live model; the reply is rendered escaped and badged
 * "LIVE MODEL — not from recorded RobotForge data". If the
 * endpoint errors or is over budget, the Guide says so plainly
 * and keeps the local answer. No API keys ever live in this file
 * or any page: the endpoint holds them server-side.
 *
 * This file is now the widget shell: message list, chips, panel
 * open/close behaviour for the floating (landing) and docked
 * frames. On app routes the shell no longer mounts the docked
 * rail — the Forge thread consumes the same hook instead.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Hit } from "./engine";
import {
  DEFAULT_CHIPS,
  LIVE_PENDING_HTML,
  PENDING_HTML,
  SUB_LIVE,
  SUB_RECORDED,
  useGuide,
} from "./useGuide";

interface Msg {
  id: number;
  who: "bot" | "user";
  html?: string;
  text?: string;
  hits?: Hit[];
}

let nextId = 1;

export function ChatWidget({ docked }: { docked: boolean }) {
  const {
    engine,
    ask: guideAsk,
    checkLive,
    handleHit,
  } = useGuide();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChipsState] = useState<string[]>(DEFAULT_CHIPS);
  const [inputValue, setInputValue] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [subText, setSubText] = useState(SUB_RECORDED);

  const msgsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const greetedRef = useRef(false);

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
    /* Updates the header disclosure when live is on. */
    void checkLive().then((h) => {
      if (h && h.ok && h.mode === "live" && h.routes && h.routes.chat) {
        setSubText(SUB_LIVE);
      }
    });
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

  /* ---------------- asking ---------------- */

  const ask = useCallback(
    (question: string) => {
      const q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: q });
      setInputValue("");
      let waitId = -1;
      guideAsk(q, {
        onPending: () => {
          waitId = appendMsg({ who: "bot", html: PENDING_HTML });
        },
        onLivePending: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === waitId ? { ...m, html: LIVE_PENDING_HTML } : m
            )
          );
        },
        onAnswer: (view) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === waitId ? { ...m, html: view.html, hits: view.hits } : m
            )
          );
          setChips(view.chips || engine.suggestions);
        },
        onNote: noteBubble,
      });
    },
    [appendMsg, engine, guideAsk, noteBubble, setChips]
  );

  const onHitClick = (h: Hit) => {
    handleHit(h, noteBubble);
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
 * toggleable panel, mirroring the vanilla media query. No app
 * route mounts it since the One Forge merge — the Forge thread
 * hosts the Guide there; this stays for the shell's record. */
export default function ChatDock() {
  return <ChatWidget docked />;
}
