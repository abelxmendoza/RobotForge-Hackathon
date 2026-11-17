"use client";
/* Wrench always on top (Abel, 2026-11-17: "make sure wrench is always
 * bottom and center and can always overlay over everything").
 *
 * Wrench is rendered through a portal into its own layer on <body>, so
 * no page wrapper, 3D canvas or sticky bar can trap it under a lower
 * stacking context; .chat-bar's z-index then puts it over the rest.
 *
 * A native modal <dialog> (showModal) goes into the browser's top layer
 * and makes everything outside it inert, which no z-index can beat.
 * While one is open, the layer moves inside that dialog, so Wrench is
 * still drawn on top and still usable; it moves back to <body> when the
 * dialog closes. Moving the layer node does not remount Wrench, so the
 * conversation and a half-typed message survive. */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function topModalDialog(): Element | null {
  try {
    const open = document.querySelectorAll("dialog:modal");
    return open.length ? open[open.length - 1] : null;
  } catch {
    return null; // :modal unsupported: stay on <body>
  }
}

export default function WrenchLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.className = "wrench-layer";
    document.body.appendChild(el);
    setHost(el);

    const place = () => {
      const target = topModalDialog() ?? document.body;
      if (el.parentNode !== target) target.appendChild(el);
    };
    place();
    /* showModal()/close() toggle the dialog's `open` attribute; a
     * dialog removed while open shows up as a childList change. */
    const mo = new MutationObserver(place);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      mo.disconnect();
      el.remove();
    };
  }, []);

  return host ? createPortal(children, host) : null;
}
