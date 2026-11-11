/* The Omega1 teardown film: its 3D twin coming apart piece by piece,
 * rendered live from the script in lib/omega1Film.ts. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Omega1Film from "@/components/film/Omega1Film";

export const metadata: Metadata = {
  title: "Omega1 teardown film",
  description: "Watch Omega1's 3D twin take itself apart one piece at a time, each with its own camera, then snap back together and drive off. Rendered live in your browser.",
};

export default function FilmPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "Omega1 teardown film" }]}>
      <Omega1Film />
    </AppShell>
  );
}
