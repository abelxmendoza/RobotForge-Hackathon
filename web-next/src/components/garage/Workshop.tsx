"use client";
/* Shared project workspace and one contextual Wrench composer. */
import WorkshopStudio from "./WorkshopStudio";
import ForgeThread from "@/components/forge/ForgeThread";
import { ASSISTANT_NAME } from "@/lib/handoff";


export default function Workshop() {
  return <div className="studio-shell workshop"><WorkshopStudio/><div className="studio-wrench workshop-wrench chat-bar" id="wrench" aria-label={ASSISTANT_NAME}><ForgeThread docked compact/></div></div>;
}
