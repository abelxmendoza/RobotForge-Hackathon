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
     * link, or a file handed over from another page opens Wrench. */
    if (/^#(wrench|words|photo|list|document)/.test(window.location.hash)) setPane("wrench");
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
