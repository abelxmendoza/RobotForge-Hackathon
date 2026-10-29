/* Forge — port of the generated app/forge/index.html.
 *
 * The page head is verbatim; the conversation (status line, thread,
 * recorded sample runs, composer) is components/forge/ForgeThread,
 * the React port of assets/js/forge.js. The Forge Guide widget is
 * NOT rendered here: the app shell mounts it globally as the docked
 * chat (components/chat/ChatDock in AppShell), exactly as the
 * vanilla app pages all carry the same docked widget.
 * components/forge/ForgeGuide + chatEngine are this scope's own
 * port of chat.js/chat-engine.js, kept for the parent's pick. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ForgeThread from "@/components/forge/ForgeThread";

export const metadata: Metadata = {
  title: "Forge",
  description:
    "Talk to the forge: describe a robot in words, or attach a photo, a parts list, a spec file, or a 3D scan.",
};

export default function ForgePage() {
  return (
    <AppShell
      active="forge"
      crumbs={[{ label: "App", href: "/forge/" }, { label: "Forge" }]}
    >
      <div className="page-head">
        <div>
          <div className="eyebrow">Forge</div>
          <h1>One chat. Every part of your build.</h1>
          <p className="lede">Describe an idea, ask about parts, or explore your data. Your robot work comes together in one conversation.</p>
          <details className="workshop-help"><summary>How your robot moves through the forge</summary>
            <p>Describe → Draft a spec → Check the numbers → Review simulation evidence → Explore outputs.</p>
            <p>Each result is labeled LIVE, LOCAL, or RECORDED. Photos use estimated dimensions; document photos use printed values. Simulation verdicts come from recorded runs.</p>
          </details>
        </div>
      </div>
      <ForgeThread />
    </AppShell>
  );
}
