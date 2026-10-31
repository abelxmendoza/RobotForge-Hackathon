/* Workshop — your robots and Wrench on one page: bring a robot in, edit
 * it, keep every upgrade as a version, and ask Wrench beside it. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Workshop from "@/components/garage/Workshop";

export const metadata: Metadata = {
  title: "Workshop",
  description: "Your robots and Wrench in one place: bring a robot in from a photo or a spec, plan upgrades, and check each one before you buy parts.",
};

export default function WorkshopPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop" }]}>
      <div className="page-head">
        <div>
          <h1>Workshop</h1>
          <p className="lede">
            Your robots, and Wrench beside them. Bring in the robot you have,
            even a broken one, try upgrades before you buy parts, or ask Wrench
            to check, change or design one. Every change is checked and saved
            as a version.
          </p>
        </div>
      </div>
      <Workshop />
    </AppShell>
  );
}
