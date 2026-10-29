/* Garage — bring your own robot in, edit it, and keep every hardware
 * upgrade as a version you can compare. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Garage from "@/components/garage/Garage";

export const metadata: Metadata = {
  title: "My robots",
  description: "Bring your robot in from a photo or a spec, plan hardware upgrades, and check each one before you buy parts.",
};

export default function GaragePage() {
  return (
    <AppShell active="garage" crumbs={[{ label: "My robots" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">My robots</div>
          <h1>Your robots, and every upgrade you plan</h1>
          <p className="lede">
            Bring in the robot you have, even a broken one, and try upgrades before
            you buy parts. Every change is checked and saved as a version.
          </p>
        </div>
      </div>
      <Garage />
    </AppShell>
  );
}
