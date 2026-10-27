import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import RobotsIndex from "@/components/robots/RobotsIndex";

export const metadata: Metadata = {
  title: "Robots",
  description: "The Robodex: every robot RobotForge knows, with gate verdicts from recorded runs.",
};

export default function RobotsPage() {
  return (
    <AppShell
      active="robots"
      crumbs={[{ label: "App", href: "/forge/" }, { label: "Robots" }]}
    >
      <RobotsIndex />
    </AppShell>
  );
}
