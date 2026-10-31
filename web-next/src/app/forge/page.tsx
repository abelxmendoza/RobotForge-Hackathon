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
      crumbs={[{ label: "Wrench" }]}
    >
      <div className="page-head">
        <div>
          <h1>Ask, fix, or design a robot</h1>
          <p className="lede">
            Wrench full size: ask questions, change your saved robots and
            parts, or design a new robot. Attach a photo, a parts list, a spec
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
