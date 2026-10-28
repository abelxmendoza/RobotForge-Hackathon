"use client";

import { useRef, useState } from "react";

/* common.js wireCopy: copies the block's code, flips the label to
   "Copied" for 1.5 s, or "Select & copy" when the clipboard refuses. */
export default function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClick = () => {
    const done = (next: string) => {
      setLabel(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setLabel("Copy"), 1500);
    };
    if (!navigator.clipboard) {
      done("Select & copy");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => done("Copied"),
      () => done("Select & copy"),
    );
  };
  return (
    <button className="btn btn-sm copy" type="button" data-copy onClick={onClick}>
      {label}
    </button>
  );
}
