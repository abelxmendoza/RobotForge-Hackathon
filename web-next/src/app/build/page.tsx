/* The build guide: a four-wheel starter rover built one step at a time
 * for an Arduino UNO or an ESP32, then driven in a simulated arena with
 * an Auto mode and a code walkthrough. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import BuildGuide from "@/components/buildguide/BuildGuide";

export const metadata: Metadata = {
  title: "Build a rover, step by step",
  description: "Build a four-wheel rover with an Arduino UNO or ESP32 one step at a time in 3D, then drive it in a simulated arena you can rearrange, with a flowchart that follows its code.",
};

export default function BuildPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "Build guide" }]}>
      <BuildGuide />
    </AppShell>
  );
}
