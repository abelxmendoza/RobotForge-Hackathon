"use client";
/* Collapsible chat rail (Abel, 2026-10-30: "make it collapsible so I
 * can still see the contents of the screen and chat at the same
 * time"). Mounted by AppShell on app pages: on wide screens it is a
 * real column between the nav sidebar and the content — the shell
 * grid gives it 340px and the page stays fully visible beside it.
 * Collapse it and the column shrinks to a slim strip; the choice is
 * remembered (localStorage). On narrow screens it overlays instead
 * of squeezing the page, which keeps its full width.
 *
 * Same useForgeAssistant engine as the Chat page and the Workspace
 * thread. Not mounted on /chat (the page IS the chat) or /forge (the
 * Workspace thread is already the conversation there). */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useForgeAssistant } from "./ChatDock";
import ChatMessages from "./ChatMessages";

const STORE_KEY = "rf-chat-rail";

export default function ChatRail() {
  const pathname = usePathname();
  const assistant = useForgeAssistant();
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);

  /* First visit: open on wide screens, closed on narrow. A stored
   * choice always wins. */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      if (saved === "open") setOpen(true);
      else if (saved === "closed") setOpen(false);
      else if (window.innerWidth < 1100) setOpen(false);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistant.messages]);

  if (pathname === "/chat" || pathname === "/chat/" || pathname === "/forge" || pathname === "/forge/") {
    return null;
  }

  const toggle = () => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(STORE_KEY, was ? "closed" : "open");
      } catch {
        /* ignore */
      }
      return !was;
    });
  };

  const send = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setText("");
    assistant.ask(q);
  };

  if (!open) {
    return (
      <div className="chat-rail closed">
        <button
          type="button"
          className="chat-rail-open"
          onClick={toggle}
          aria-label="Open chat"
          title="Open chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z" />
            <path d="M8 9h8M8 12.5h5" />
          </svg>
          <span>Chat</span>
        </button>
      </div>
    );
  }

  return (
    <div className="chat-rail open">
      <section className="chat-rail-panel" aria-label="Chat">
        <div className="fc-head">
          <div>
            <strong>Forge Guide</strong>
            <span className="fc-sub">{assistant.subText}</span>
          </div>
          <button
            type="button"
            className="fc-close"
            onClick={toggle}
            aria-label="Collapse chat"
            title="Collapse chat"
          >
            «
          </button>
        </div>

        <div className="fc-msgs" ref={msgsRef} aria-live="polite">
          <ChatMessages messages={assistant.messages} onHitClick={assistant.onHitClick} />
        </div>

        <div className="chat-rail-actions">{assistant.actions}</div>

        <div className="fc-chips">
          {assistant.chips.map((c) => (
            <button type="button" className="fc-hit" key={c} onClick={() => send(c)}>
              {c}
            </button>
          ))}
        </div>

        <form
          className="fc-form"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask, or type Operations…"
            aria-label="Message the Forge Guide"
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
