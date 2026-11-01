/* The BOM wizard: assemble a bill of materials from a robot's
 * take-apart kit or a catalogue build template, configure what the
 * data supports (with one badged AI suggestion step), and export it
 * with vendor search links — never prices. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import BomWizard from "@/components/bom/BomWizard";

export const metadata: Metadata = {
  title: "BOM wizard",
  description:
    "Assemble a bill of materials from RobotForge's real parts data — a robot's take-apart kit or a build template — and export it with vendor search links.",
};

export default function BomPage() {
  return (
    <AppShell
      active="robots"
      crumbs={[
        { label: "Robots", href: "/robots/" },
        { label: "BOM wizard" },
      ]}
    >
      <section className="section">
        <h1>Bill of materials wizard</h1>
        <p className="sub">
          Three steps: start from recorded parts data, configure what the
          data supports, review and export. Every line carries its source,
          and the vendor links are searches — this site never displays a
          price, a stock level or an availability claim.
        </p>
      </section>
      <BomWizard />
    </AppShell>
  );
}
