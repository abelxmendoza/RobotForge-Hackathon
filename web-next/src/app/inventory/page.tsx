/* Parts inventory — photograph parts, Muse Spark identifies them,
 * confirm each in a short chat. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import Inventory from "@/components/inventory/Inventory";

export const metadata: Metadata = {
  title: "Parts inventory",
  description: "Photograph the robot parts you own, let Muse Spark identify them, and confirm each one in chat.",
};

export default function InventoryPage() {
  return (
    <AppShell active="inventory" crumbs={[{ label: "App", href: "/forge/" }, { label: "Parts inventory" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Parts inventory</div>
          <h1>What’s on your shelf</h1>
          <p className="lede">
            Photograph your parts. Muse Spark reads the labels and asks one question
            to confirm each part; you answer in the chat or fix the fields yourself.
            Nothing counts as confirmed until you say so.
          </p>
        </div>
      </div>
      <Inventory />
    </AppShell>
  );
}
