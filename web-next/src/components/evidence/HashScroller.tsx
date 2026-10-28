"use client";
/* Port of the tail of evidence.js's boot(): when the page is opened
   with a fragment (e.g. a report chip or a link to #run-<id> from a
   robot page), scroll that report into view once on mount. */

import { useEffect } from "react";

export default function HashScroller() {
  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView();
    }
  }, []);
  return null;
}
