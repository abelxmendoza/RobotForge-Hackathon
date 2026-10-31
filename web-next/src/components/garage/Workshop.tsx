"use client";
/* The Workshop: your robots and Wrench on one page.
 *
 * Wide screens: robots (list + editor) on the left, Wrench docked on the
 * right, sharing the same saved data, so a robot Wrench saves or edits
 * appears in the list at once. Narrow screens: one pane at a time with a
 * toggle. There is one Wrench thread on the page either way; the bottom
 * chat bar is not mounted here. */
import { useEffect, useState } from "react";
import Garage from "./Garage";
import ForgeThread from "@/components/forge/ForgeThread";
import { ASSISTANT_NAME } from "@/lib/handoff";

export default function Workshop() {
  const [pane, setPane] = useState<"robots" | "wrench">("robots");
  useEffect(() => {
    /* #wrench (from the chat bar or an old /chat/ link), a sample deep
     * link, or a file handed over from another page opens Wrench; any
     * other anchor opens the pane that contains it (e.g. #assembly from
     * an assembly proposal in Wrench lives under My robots). */
    const paneFor = (hash: string): "robots" | "wrench" | null => {
      if (/^#(wrench|words|photo|list|document)\b/.test(hash)) return "wrench";
      const id = hash.slice(1);
      const el = id ? document.getElementById(decodeURIComponent(id)) : null;
      if (el?.closest(".workshop-robots")) return "robots";
      if (el?.closest(".workshop-wrench")) return "wrench";
      return null;
    };
    const apply = (hash: string) => {
      const p = paneFor(hash);
      if (!p) return;
      setPane(p);
      /* The target may have been hidden until the pane switched. */
      const id = hash.slice(1);
      if (id && id !== "wrench") requestAnimationFrame(() => document.getElementById(decodeURIComponent(id))?.scrollIntoView({ block: "start" }));
    };
    apply(window.location.hash);
    const onHash = () => apply(window.location.hash);
    /* Same-page links go through the router's pushState, which fires no
     * hashchange, so read the link's hash on click as well. */
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname.replace(/\/$/, "") !== window.location.pathname.replace(/\/$/, "")) return;
      apply(a.hash);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return (
    <div className="workshop" data-pane={pane}>
      <div className="workshop-toggle" role="tablist" aria-label="Workshop">
        <button type="button" role="tab" aria-selected={pane === "robots"} onClick={() => setPane("robots")}>My robots</button>
        <button type="button" role="tab" aria-selected={pane === "wrench"} onClick={() => setPane("wrench")}>{ASSISTANT_NAME}</button>
      </div>
      <section className="workshop-robots" aria-label="My robots">
        <Garage />
      </section>
      <aside className="workshop-wrench" id="wrench" aria-label={ASSISTANT_NAME}>
        <h2 className="workshop-wrench-title">{ASSISTANT_NAME}</h2>
        <ForgeThread />
      </aside>
    </div>
  );
}
