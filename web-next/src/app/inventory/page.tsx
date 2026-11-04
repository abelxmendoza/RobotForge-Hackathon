/* Parts inventory — photograph parts, Muse Spark identifies them,
 * confirm each in a short chat. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import PartsLibrary from "@/components/inventory/PartsLibrary";

export const metadata: Metadata = {
  title: "My Parts and Tools",
  description: "Photograph the robot parts you own, let Muse Spark identify them, and confirm each one in chat.",
};

export default function InventoryPage() {
  return (
    <AppShell active="inventory" crumbs={[{ label: "My Parts and Tools" }]}>
      <div className="page-head">
        <div>
          <h1>My Parts and Tools</h1>
          <p className="lede">
            Parts, tools and custom designs, organized for your robots.
          </p>
        </div>
      </div>
      <PartsLibrary />
    </AppShell>
  );
}
