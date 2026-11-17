/* The take-apart kit in 3D (KitViewer: the generated Burger kit with orbit, explode,
 * CAD mode and OpenSCAD download). The parts catalogue moved to
 * My Parts and Tools (/inventory/?scope=catalogue) on 2026-11-17.
 * The take-apart viewer for a robot's own spec lives on each robot
 * page. kit.html's own top nav is not reproduced: the app shell
 * provides navigation on this route. */
import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "@/components/shell/AppShell";
import KitViewer from "@/components/kit/KitViewer";
import { parts } from "@/lib/data";

export const metadata: Metadata = {
  title: "Parts kit in 3D",
  description:
    "Every real part RobotForge builds robots from, with datasheet specs, and the TurtleBot3 Burger kit in 3D with parametric OpenSCAD export.",
};

export default function KitPage() {
  return (
    <AppShell
      active="robots"
      crumbs={[
        { label: "Robodex", href: "/robots/" },
        { label: "Parts kit in 3D" },
      ]}
    >
      <KitViewer />
      {/* The catalogue's one home is My Parts and Tools now (simplify
       * pass, 2026-11-17); it showed the same parts twice. */}
      <section className="section" id="parts">
        <p className="section-more">
          <Link href="/inventory/?scope=catalogue">Browse all {parts.length} parts in My Parts and Tools →</Link>
        </p>
      </section>
    </AppShell>
  );
}
