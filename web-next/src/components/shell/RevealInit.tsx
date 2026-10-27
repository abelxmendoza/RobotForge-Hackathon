"use client";
import { useEffect } from "react";

// Port of assets/js/anim.js (motion pack): auto-tag scroll-reveal
// targets and reveal them as they enter the viewport.
export default function RevealInit() {
  useEffect(() => {
    const targets = document.querySelectorAll(
      ".robot-card, .step-card, .page-head, .dex-strip figure, main article, .report-card, .forge-top");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("in"));
      return;
    }
    targets.forEach((el, i) => {
      el.classList.add("rv");
      if (i % 4 === 1) el.classList.add("rv-d1");
      if (i % 4 === 2) el.classList.add("rv-d2");
      if (i % 4 === 3) el.classList.add("rv-d3");
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
