/* Parts catalogue — the 50-part catalogue (PartsCatalogue, searchable,
 * the Forge Guide's part links land on #parts) under the take-apart
 * kit in 3D (KitViewer: the generated Burger kit with orbit, explode,
 * CAD mode and OpenSCAD download). The catalogue used to be repeated
 * on /robots/ and inside KitViewer; this page is now its one home.
 * The take-apart viewer for a robot's own spec lives on each robot
 * page. kit.html's own top nav is not reproduced: the app shell
 * provides navigation on this route. */
import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "@/components/shell/AppShell";
import KitViewer from "@/components/kit/KitViewer";
import PartsCatalogue from "@/components/robots/PartsCatalogue";
import { parts } from "@/lib/data";

export const metadata: Metadata = {
  title: "Parts catalogue",
  description:
    "Every real part RobotForge builds robots from, with datasheet specs, and the TurtleBot3 Burger kit in 3D with parametric OpenSCAD export.",
};

export default function KitPage() {
  return (
    <AppShell
      active="robots"
      crumbs={[
        { label: "Robots", href: "/robots/" },
        { label: "Parts catalogue" },
      ]}
    >
      <KitViewer />
      <section className="section" id="parts">
        <h2>Parts catalogue</h2>
        <p className="sub">
          {parts.length} real parts with datasheet-sourced specs, grouped by
          class. These are what the forge assembles robots from and checks
          parts lists against. Every card carries vendor search links for
          the part — search links only, never a displayed price or stock
          claim. The <Link href="/garage/#tab=bom">BOM tab in the
          Workshop</Link> turns your robot into an exportable bill of
          materials.
        </p>
        <PartsCatalogue />
      </section>
    </AppShell>
  );
}
