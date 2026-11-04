/* Scan Studio — scan a real robot with an Intel RealSense depth
 * camera through the local bridge (tools/scan_bridge.py). */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ScanStudio from "@/components/scan/ScanStudio";

export const metadata: Metadata = {
  title: "Scan Studio",
  description: "Scan a real robot with an Intel RealSense: live colour, depth and 3D points, record a walk-around, and get a fused scan with sizes measured from real depth.",
};

export default function ScanPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "Scan Studio" }]}>
      <div className="page-head">
        <div>
          <h1>Scan Studio</h1>
          <p className="lede">
            Walk a RealSense depth camera around your robot. You get a colour 3D scan and its
            length, width and height measured from real depth, ready to add to the robot in
            your Workshop. Everything stays on your computer.
          </p>
        </div>
      </div>
      <ScanStudio />
    </AppShell>
  );
}
