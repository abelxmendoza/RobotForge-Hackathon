"use client";
/* Dedicated Chat page: the Forge Guide conversation on its own route,
 * driven by the same useForgeAssistant engine as the Workspace thread —
 * same recorded answers, same live-model fallback, same validated
 * operation proposals (assistant.actions). The Workspace keeps its
 * design/uploads thread; this page is just the conversation, full-size. */
import { useEffect, useRef, useState } from "react";
import { useForgeAssistant } from "./ChatDock";
import ChatMessages from "./ChatMessages";

export default function ChatPage() {
  const assistant = useForgeAssistant();
  const [text, setText] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);

  /* Keep the newest message in view, like a chat app. */
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistant.messages]);

  const send = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setText("");
    assistant.ask(q);
  };

  return (
    <div className="chat-page">
      <div className="fc-head chat-page-head">
        <div>
          <strong>Forge Guide</strong>
          <span className="fc-sub">{assistant.subText}</span>
        </div>
      </div>

      <div className="fc-msgs chat-page-msgs" ref={msgsRef} aria-live="polite">
        <ChatMessages messages={assistant.messages} onHitClick={assistant.onHitClick} />
      </div>

      {assistant.actions}

      <div className="fc-chips chat-page-chips" aria-label="Suggested questions">
        {assistant.chips.map((c) => (
          <button
            type="button"
            className="fc-hit"
            key={c}
            onClick={() => send(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <form
        className="forge-composer chat-page-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label className="faint" htmlFor="chat-input" style={{ fontSize: "var(--fs-xs)" }}>
          Message the Forge Guide
        </label>
        <textarea
          id="chat-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          placeholder="Ask about a robot, a part, or the evidence… or type Operations"
        />
        <div className="composer-row">
          <p className="composer-note faint">
            Enter to send, Shift+Enter for a new line. Design a robot or add
            attachments in the Workspace.
          </p>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
