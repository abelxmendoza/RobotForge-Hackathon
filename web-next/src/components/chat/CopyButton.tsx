"use client";
/* Copy control for Wrench: one message, or the whole conversation. */
import { useEffect, useState } from "react";
import { copyText } from "@/lib/copytext";

export default function CopyButton({
  getText,
  label = "Copy",
  title = "Copy this response",
  className = "copy-btn",
}: {
  getText: () => string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={title}
      data-nocopy
      onClick={async () => setState((await copyText(getText())) ? "done" : "fail")}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === "done" ? <path d="M5 12.5 10 17l9-10" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>}
      </svg>
      <span>{state === "done" ? "Copied" : state === "fail" ? "Couldn’t copy" : label}</span>
      <span className="sr-only" role="status">{state === "done" ? "Copied to clipboard" : ""}</span>
    </button>
  );
}
