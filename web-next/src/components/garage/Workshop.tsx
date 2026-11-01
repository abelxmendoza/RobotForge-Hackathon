"use client";
/* The Workshop: your robots, with Wrench at the bottom of the page.
 *
 * The robots (list + editor) take the full width. Wrench is the same
 * oval composer as the bar on other pages, pinned at the bottom centre;
 * its conversation opens above it. It shares the saved data, so a robot
 * Wrench saves or edits appears in the list at once. The bottom chat bar
 * is not mounted here, so there is one Wrench on the page. */
import { useEffect } from "react";
import Garage from "./Garage";
import ForgeThread from "@/components/forge/ForgeThread";
import { ASSISTANT_NAME } from "@/lib/handoff";

export default function Workshop() {
  useEffect(() => {
    /* An anchor into My robots (e.g. #assembly from an assembly proposal
     * in Wrench) scrolls there; same-page links go through the router's
     * pushState, which fires no hashchange, so read clicks too. */
    const go = (hash: string) => {
      const id = hash.slice(1);
      if (!id || /^(wrench|words|photo|list|document)\b/.test(id)) return;
      requestAnimationFrame(() => document.getElementById(decodeURIComponent(id))?.scrollIntoView({ block: "start" }));
    };
    const onHash = () => go(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname.replace(/\/$/, "") !== window.location.pathname.replace(/\/$/, "")) return;
      go(a.hash);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return (
    <div className="workshop">
      <section className="workshop-robots" aria-label="My robots">
        <Garage />
      </section>
      <div className="workshop-wrench chat-bar" id="wrench" aria-label={ASSISTANT_NAME}>
        <ForgeThread docked />
      </div>
    </div>
  );
}
