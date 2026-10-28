"use client";
/* Forge Guide — floating variant (site.py chat_widget(docked=False)).
 *
 * Used on the landing page: the launcher button floats and toggles
 * the panel at every width. This is the exact same widget as the
 * docked app-shell rail in ./ChatDock.tsx — same engine, same
 * markup contract (div.forge-chat > button.fc-launcher +
 * section.fc-panel), same honesty behaviours — only the frame
 * differs: no "docked" class, so the panel is never pinned open
 * by the min-width: 1280px media query.
 */
import { ChatWidget } from "./ChatDock";

export default function ChatLauncher() {
  return <ChatWidget docked={false} />;
}
