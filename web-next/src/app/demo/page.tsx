/* The one-click demo: a broken robot, a Muse Spark fix the checks
 * have to accept, and the simulation evidence, in one page. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Demo from "@/components/demo/Demo";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Demo",
  description: "One click: a broken robot, the engineering checks that catch it, a Muse Spark fix the checks must accept, and the simulation evidence.",
};

export default function DemoPage() {
  return (
    <AppShell active="demo" crumbs={[{ label: "Demo" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">One-click demo</div>
          <h1>Fix a robot before you spend a dollar</h1>
          <p className="lede">
            A broken robot goes in. The engineering checks find what’s wrong, Muse
            Spark proposes a fix, the checks decide whether it holds, and the
            simulation evidence shows the result. Press the button and watch.
          </p>
        </div>
      </div>
      <Demo />
      <p className="section-more">
        <Link href="/how-it-works/#ai-inside">Where else Muse Spark works in RobotForge, and whether it is live now →</Link>
      </p>
    </AppShell>
  );
}
