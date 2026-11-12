"use client";
/* The Workshop: your robots, with Wrench at the bottom of the page.
 *
 * The robots (list + editor) take the full width. Wrench is the same
 * oval composer as the bar on other pages, pinned at the bottom centre;
 * its conversation opens above it. It shares the saved data, so a robot
 * Wrench saves or edits appears in the list at once. The bottom chat bar
 * is not mounted here, so there is one Wrench on the page. */
import WorkshopStudio from "./WorkshopStudio";
import ForgeThread from "@/components/forge/ForgeThread";
import { ASSISTANT_NAME } from "@/lib/handoff";


export default function Workshop() {
  return <div className="studio-shell workshop"><WorkshopStudio/><div className="studio-wrench workshop-wrench chat-bar" id="wrench" aria-label={ASSISTANT_NAME}><ForgeThread docked/></div></div>;
}
