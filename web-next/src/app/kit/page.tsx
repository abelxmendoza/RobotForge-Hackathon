/* Parts Kit 3D — port of the hand-maintained kit.html, hosted at
 * /kit/ (the robots index links here). The page body is
 * components/kit/KitViewer: the generated Burger kit in 3D with
 * orbit/zoom, auto-rotate, the explode slider, CAD blueprint mode,
 * parametric OpenSCAD generation + download, the Real model
 * (ROBOTIS specimen) mode, and the 2D fallback if WebGL fails —
 * plus the full catalogue and the spec-driven take-apart viewer
 * for the same Burger. kit.html's own top nav is not reproduced:
 * the app shell provides navigation on this route. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import KitViewer from "@/components/kit/KitViewer";

export const metadata: Metadata = {
  title: "Parts Kit 3D",
  description:
    "The RobotForge take-apart kit in 3D: orbit, explode and export the TurtleBot3 Burger kit as parametric OpenSCAD.",
};

export default function KitPage() {
  return (
    <AppShell
      active="robots"
      crumbs={[
        { label: "App", href: "/forge/" },
        { label: "Robots", href: "/robots/" },
        { label: "Parts Kit 3D" },
      ]}
    >
      <KitViewer />
    </AppShell>
  );
}
