/* Chat: the Forge Guide conversation as its own page, so it has a tab
 * in the side nav next to the Workspace instead of living only inside
 * the Workspace thread. Same assistant engine, dedicated route. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ChatPage from "@/components/chat/ChatPage";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chat",
  description:
    "Talk to the Forge Guide: ask about the Robodex, the parts catalogue and the recorded gate evidence, or run validated operations on your saved robots and parts.",
};

export default function ChatRoute() {
  return (
    <AppShell active="chat" crumbs={[{ label: "Chat" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Chat</div>
          <h1>Talk to RobotForge</h1>
          <p className="lede">
            The Forge Guide, full-size. Ask questions, look up robots and
            parts, check the evidence, or ask it to change a saved robot —
            every change is previewed before it applies. To design a new
            robot or attach a photo, list, spec or scan, use the{" "}
            <Link href="/forge/">Workspace</Link>.
          </p>
        </div>
      </div>
      <ChatPage />
    </AppShell>
  );
}
