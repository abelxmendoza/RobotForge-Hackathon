"use client";

import { useRef, useState } from "react";

/**
 * The quickstart codeblock's Copy button — a port of the vanilla
 * landing's [data-copy] handler: copy the sibling <code> text, show
 * "Copied" for 1.5 s, or "Select & copy" when the clipboard is
 * unavailable. This is the one interactive element in the ported
 * how-it-works content, hence the lone client component.
 */
export default function CopyButton() {
  const [label, setLabel] = useState("Copy");
  const ref = useRef<HTMLButtonElement>(null);

  async function onCopy() {
    const code =
      ref.current?.parentElement?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
      setLabel("Copied");
    } catch {
      setLabel("Select & copy");
    }
    setTimeout(() => setLabel("Copy"), 1500);
  }

  return (
    <button
      ref={ref}
      className="btn btn-sm copy"
      type="button"
      onClick={onCopy}
    >
      {label}
    </button>
  );
}
