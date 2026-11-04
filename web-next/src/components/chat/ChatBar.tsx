"use client";
/* Bottom chat bar (Abel, 2026-10-30, superseding the side rail from
 * PR #33): the chat lives at the BOTTOM of the screen. What you see
 * is an oval composer — one line that grows as a message wraps onto
 * more lines. The conversation opens upward from it and collapses
 * back down, so the page underneath stays visible and usable either
 * way (collapsed = just the pill; expanded = a floating sheet that
 * never takes the whole screen).
 *
 * Same useForgeAssistant engine as the Workshop's Wrench thread. Not
 * mounted on /garage/ (the Workshop), where Wrench is docked beside
 * your robots. */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useForgeAssistant } from "./ChatDock";
import ChatMessages from "./ChatMessages";
import { promptWrench, takeWrenchPrompt, WRENCH_PROMPT_EVENT, type WrenchPrompt } from "@/lib/wrenchPrompt";
import AttachButton from "./AttachButton";
import VoiceButton from "./VoiceButton";
import CopyButton from "./CopyButton";
import { transcript } from "@/lib/copytext";
import { ASSISTANT_NAME } from "@/lib/handoff";

export default function ChatBar() {
  const pathname = usePathname();
  const router = useRouter();
  const assistant = useForgeAssistant();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [attachRequest,setAttachRequest]=useState(0);
  useEffect(()=>{
    if(['/garage','/garage/','/forge','/forge/','/chat','/chat/'].includes(pathname))return;
    const prepare=(p:WrenchPrompt)=>{
      if(p.mode==='design')return;
      takeWrenchPrompt();setOpen(true);
      if(typeof p.text==='string')setText(p.text);
      if(p.attach)setAttachRequest(n=>n+1);
      else requestAnimationFrame(()=>taRef.current?.focus());
    };
    const onPrompt=(e:Event)=>prepare((e as CustomEvent<WrenchPrompt>).detail);
    window.addEventListener(WRENCH_PROMPT_EVENT,onPrompt);
    return()=>window.removeEventListener(WRENCH_PROMPT_EVENT,onPrompt);
  },[pathname]);

  /* Every page starts with the conversation collapsed (Abel,
   * 2026-11-01): it opens only when the person sends a message or
   * presses the toggle, never by itself on arrival. */

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [assistant.messages, open]);

  if (["/garage", "/garage/", "/forge", "/forge/", "/chat", "/chat/"].includes(pathname)) {
    return null;
  }

  const setOpenPersist = (v: boolean) => setOpen(v);

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
            {assistant.messages.length > 0 && (
              <button
                type="button"
                className="chat-bar-full"
                onClick={assistant.resetConversation}
                title="Clear this conversation and Wrench's memory of it"
              >
                New conversation
              </button>
            )}
            <Link className="chat-bar-full" href="/garage/#wrench" title="Open Wrench in the Workshop">
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
            <ChatMessages messages={assistant.messages} onHitClick={assistant.onHitClick} onFixClick={assistant.fixGroundedAnswer} onOpenRobot={(a) => assistant.openRobot(a.robotId, a.tab)} />
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
        <button
          type="button"
          className="chat-bar-create"
          onClick={() => { promptWrench({mode:'design',text:'Generate a robot '}); router.push('/garage/#wrench'); }}
          aria-label="Create: generate a robot, acceptance tests, or a modification"
          title="Create — generate a robot, acceptance tests, or a modification (Forge Engine, right here)"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
          </svg>
          Create
        </button>
        <AttachButton request={attachRequest} text={text} onSent={() => setText("")} />
        <VoiceButton
          onText={(t) => {
            /* The transcript joins what's already typed (same
             * append semantics as the ForgeThread composer) and
             * waits in the box for review — never auto-sent. */
            setText((prev) => (prev.trim() ? prev.replace(/\s+$/, "") + " " + t : t));
            const ta = taRef.current;
            if (ta) {
              ta.focus();
              requestAnimationFrame(grow);
            }
          }}
        />
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
