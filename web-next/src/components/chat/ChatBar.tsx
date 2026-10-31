"use client";
/* Bottom chat bar (Abel, 2026-10-30, superseding the side rail from
 * PR #33): the chat lives at the BOTTOM of the screen. What you see
 * is an oval composer — one line that grows as a message wraps onto
 * more lines. The conversation opens upward from it and collapses
 * back down, so the page underneath stays visible and usable either
 * way (collapsed = just the pill; expanded = a floating sheet that
 * never takes the whole screen).
 *
 * Same useForgeAssistant engine as the Workspace thread. Not mounted
 * on /forge, where the Workspace thread is the full-size Wrench. */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useForgeAssistant } from "./ChatDock";
import ChatMessages from "./ChatMessages";
import AttachButton from "./AttachButton";
import CopyButton from "./CopyButton";
import { transcript } from "@/lib/copytext";
import { ASSISTANT_NAME } from "@/lib/handoff";

const STORE_KEY = "rf-chat-bar";

export default function ChatBar() {
  const pathname = usePathname();
  const assistant = useForgeAssistant();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* Remember whether the conversation was left open. */
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORE_KEY) === "open") setOpen(true);
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistant.messages, open]);

  if (pathname === "/forge" || pathname === "/forge/" || pathname === "/chat" || pathname === "/chat/") {
    return null;
  }

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try {
      window.localStorage.setItem(STORE_KEY, v ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };

  /* The oval grows with the message: one line, wrapping to more
   * lines as needed, capped — past the cap the field scrolls. */
  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const send = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setText("");
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = "auto";
    });
    assistant.ask(q);
    setOpenPersist(true); // sending opens the conversation so the reply is visible
  };

  return (
    <div className="chat-bar">
      {open && (
        <section className="chat-bar-panel" aria-label="Chat conversation">
          <div className="fc-head">
            <div>
              <strong>{ASSISTANT_NAME}</strong>
              <span className="fc-sub">{assistant.subText}</span>
            </div>
            {assistant.messages.length > 0 && (
              <CopyButton
                className="copy-btn copy-all"
                label="Copy all"
                title="Copy the whole conversation"
                getText={() => transcript(assistant.messages)}
              />
            )}
            <Link className="chat-bar-full" href="/forge/" title="Open Wrench full size">
              Full size
            </Link>
            <button
              type="button"
              className="fc-close"
              onClick={() => setOpenPersist(false)}
              aria-label="Collapse conversation"
              title="Collapse conversation"
            >
              ▾
            </button>
          </div>
          <div className="fc-msgs" ref={msgsRef} aria-live="polite">
            <ChatMessages messages={assistant.messages} onHitClick={assistant.onHitClick} />
          </div>
          <div className="chat-bar-actions">{assistant.actions}</div>
          <div className="fc-chips">
            {assistant.chips.map((c) => (
              <button type="button" className="fc-hit" key={c} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
        </section>
      )}

      <form
        className="chat-bar-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <button
          type="button"
          className="chat-bar-toggle"
          onClick={() => setOpenPersist(!open)}
          aria-expanded={open}
          aria-label={open ? "Collapse conversation" : "Open conversation"}
          title={open ? "Collapse conversation" : "Open conversation"}
        >
          {open ? "▾" : "▴"}
        </button>
        <AttachButton text={text} onSent={() => setText("")} />
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
            if (e.key === "Escape") setOpenPersist(false);
          }}
          placeholder={`Message ${ASSISTANT_NAME}, or attach a photo or file…`}
          aria-label={`Message ${ASSISTANT_NAME}`}
        />
        <button
          type="submit"
          className="chat-bar-send"
          disabled={!text.trim()}
          aria-label="Send message"
          title="Send"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
