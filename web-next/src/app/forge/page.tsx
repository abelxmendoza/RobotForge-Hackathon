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
      crumbs={[{ label: "Forge" }]}
    >
      <div className="page-head">
        <div>
          <div className="eyebrow">Forge</div>
          <h1>Talk to the forge</h1>
          <p className="lede">
            Describe a robot in words, or attach a photo, a parts list, a spec
            file or a 3D scan. Every step is labelled <strong>LIVE</strong>,{" "}
            <strong>LOCAL</strong> or <strong>RECORDED</strong>, so you always
            know what produced it.
          </p>
        </div>
      </div>
      <ForgeThread />
    </AppShell>
  );
}
