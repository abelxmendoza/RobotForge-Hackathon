"use client";
/* Port of the tail of evidence.js's boot(): when the page is opened
   with a fragment (e.g. a report chip or a link to #run-<id> from a
   robot page), scroll that report into view once on mount. */

import { useEffect } from "react";

export default function HashScroller() {
  useEffect(() => {
    /* Reports 2+ start folded: open the one a link points at. */
    const go = () => {
      if (!location.hash) return;
      const el = document.querySelector(location.hash);
      if (!el) return;
      el.querySelector("details.report-more")?.setAttribute("open", "");
      el.scrollIntoView();
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
