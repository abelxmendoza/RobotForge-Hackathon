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
          <h1>Talk to the forge</h1>
          <p className="lede">
            One conversation: describe a robot in words, or attach a photo, a
            parts list, a spec file, or a 3D scan. A photo of a spec sheet or
            blueprint is read as a document — printed values transcribed, never
            inferred from drawing scale — and a scan (.ply) is measured right
            in your browser. Every stage of every run wears the badge it
            earned — <strong>LIVE</strong> (a real model call through the live
            endpoint), <strong>LOCAL</strong> (real computation in your
            browser) or <strong>RECORDED</strong> (a replayed run, labeled with
            its date). Nothing wears a badge it didn’t earn.
          </p>
        </div>
      </div>
      <ForgeThread />
    </AppShell>
  );
}
