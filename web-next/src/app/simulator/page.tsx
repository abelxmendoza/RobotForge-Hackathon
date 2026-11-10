/* The Omega1 simulator: drive Omega1's 3D twin on real-time physics,
 * with live motor and sensor gauges and a self-running tour. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Omega1Simulator from "@/components/simulator/Omega1Simulator";

export const metadata: Metadata = {
  title: "Omega1 simulator",
  description: "Drive Omega1's 3D twin on real-time physics. Live gauges show which motor channels light up and what its ultrasonic sensor reads, and a self-running tour explains how it drives.",
};

export default function SimulatorPage() {
  return (
    <AppShell active="workshop" wide crumbs={[{ label: "Workshop", href: "/garage/" }, { label: "Omega1 simulator" }]}>
      <Omega1Simulator />
    </AppShell>
  );
}
