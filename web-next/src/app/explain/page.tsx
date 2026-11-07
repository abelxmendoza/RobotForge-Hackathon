/* "How does my robot work?" — a step-through explainer generated from a
 * robot's own record. ?robot=<id> picks a Workshop robot (Omega1 by
 * default) or a Robodex robot by slug. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ExplainPage from "@/components/explain/ExplainPage";

export const metadata: Metadata = {
  title: "How it works",
  description: "Press through how a robot works, step by step: power, brain, motor driver, wheels and sensors, drawn from the robot's own wiring record.",
};

export default function HowItWorksPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "How it works" }]}>
      <ExplainPage />
    </AppShell>
  );
}
