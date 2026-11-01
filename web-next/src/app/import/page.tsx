/* Import a repo — a public GitHub robot repo becomes a specimen in
 * your Garage: hardware story, parts, images and simulation, with
 * the repo attached. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import RepoImport from "@/components/import/RepoImport";

export const metadata: Metadata = {
  title: "Import a repo",
  description: "Paste a public GitHub robot repo and RobotForge reads it: hardware, parts, images and a simulation, saved as a specimen in your Garage with the repo attached.",
};

export default function ImportPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "Import a repo" }]}>
      <div className="page-head">
        <div>
          <h1>Import a repo</h1>
          <p className="lede">
            Paste a public GitHub repo for a robot project. RobotForge reads its hardware
            story, matches its parts against the catalogue, and simulates what its model
            supports — then saves it in your Garage with the repo attached.
          </p>
        </div>
      </div>
      <RepoImport />
    </AppShell>
  );
}
