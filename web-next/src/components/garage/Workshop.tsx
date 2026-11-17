"use client";
/* Shared project workspace and one contextual Wrench composer. Wrench
 * sits bottom centre over everything, like on every other app page
 * (WrenchLayer). */
import WorkshopStudio from "./WorkshopStudio";
import ForgeThread from "@/components/forge/ForgeThread";
import WrenchLayer from "@/components/chat/WrenchLayer";
import { ASSISTANT_NAME } from "@/lib/handoff";


export default function Workshop() {
  return <div className="studio-shell workshop"><WorkshopStudio/><WrenchLayer><div className="studio-wrench workshop-wrench chat-bar" id="wrench" aria-label={ASSISTANT_NAME}><ForgeThread docked compact/></div></WrenchLayer></div>;
}
