/* Unified workspace: questions, actions, uploads, and robot design share ForgeThread. */
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
          <h1>Your robot workspace</h1>
          <p className="lede">
            Ask questions, manage your parts, edit saved robots, or design a new one. Attach a photo, a parts list, a spec
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
