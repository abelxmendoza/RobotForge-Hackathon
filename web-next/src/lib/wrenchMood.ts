/* Wrench's mood in the chat composer, read from the conversation
 * itself (no new state in the assistant):
 *   thinking  — his last bubble is still a "Thinking…" placeholder
 *   pass/fail — a reply just landed with a grounded verdict
 *   ready     — any other reply just landed (a short smile)
 *   listening — you're typing
 *   idle      — otherwise */
import { useEffect, useRef, useState } from "react";
import type { WrenchMood } from "@/components/chat/WrenchBot";

export type MoodMsg = { id: number; who: string; html?: string; grounding?: { failing: boolean } };

const PLACEHOLDER = /class="fc-dim"[^>]*>[^<]*(?:&hellip;|…)\s*<\/p>\s*$/;

export function isWrenchThinking(messages: readonly MoodMsg[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.who === "bot" && PLACEHOLDER.test(last.html || "");
}

/* The flash a newly landed reply earns, or null. */
export function landedMood(last: MoodMsg | undefined, wasThinking: boolean): WrenchMood | null {
  if (!last || last.who !== "bot") return null;
  if (last.grounding) return last.grounding.failing ? "fail" : "pass";
  return wasThinking ? "ready" : null;
}

export function useWrenchMood(messages: readonly MoodMsg[], typing: boolean): WrenchMood {
  const thinking = isWrenchThinking(messages);
  const last = messages[messages.length - 1];
  const key = last ? `${last.id}|${(last.html || "").length}|${last.grounding ? (last.grounding.failing ? "f" : "p") : ""}` : "";
  const seen = useRef(key);
  const wasThinking = useRef(thinking);
  const lastRef = useRef(last);
  lastRef.current = last;
  const timer = useRef(0);
  const [flash, setFlash] = useState<WrenchMood | null>(null);

  useEffect(() => {
    if (thinking) {
      wasThinking.current = true;
      seen.current = key;
      return;
    }
    if (key === seen.current) return;
    seen.current = key;
    const m = landedMood(lastRef.current, wasThinking.current);
    wasThinking.current = false;
    window.clearTimeout(timer.current);
    /* set from a timer, never synchronously in the effect body */
    timer.current = window.setTimeout(() => {
      setFlash(m);
      if (m) timer.current = window.setTimeout(() => setFlash(null), m === "ready" ? 2400 : 5000);
    }, 0);
  }, [key, thinking]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (thinking) return "thinking";
  if (flash) return flash;
  return typing ? "listening" : "idle";
}
