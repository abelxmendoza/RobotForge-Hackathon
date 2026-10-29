/* Garage — bring your own robot in, edit it, and keep every hardware
 * upgrade as a version you can compare. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Garage from "@/components/garage/Garage";

export const metadata: Metadata = {
  title: "Garage",
  description: "Bring your robot in from a photo or a spec, plan hardware upgrades, and check each one before you buy parts.",
};

export default function GaragePage() {
  return (
    <AppShell active="garage" crumbs={[{ label: "App", href: "/forge/" }, { label: "Garage" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Garage</div>
          <h1>Your robots, and every upgrade you plan</h1>
          <p className="lede">
            Bring in the robot you have, even a broken one. Change a battery, a motor
            or the wheels in the editor and see what the change does before you spend
            money: the engineering checks, the rover field checks, and a Muse Spark
            fix when something doesn’t add up. Every upgrade is saved as a version,
            so you can compare any two.
          </p>
        </div>
      </div>
      <Garage />
    </AppShell>
  );
}
