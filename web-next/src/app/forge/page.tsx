/* The Workspace merged into the Workshop (/garage/): Wrench sits beside
 * your robots there. Old links, including sample deep links such as
 * /forge/#words, land on it with their hash. */
import type { Metadata } from "next";
import Redirect from "@/components/shell/Redirect";

export const metadata: Metadata = {
  title: "Workshop",
  robots: { index: false },
};

export default function ForgeRoute() {
  return <Redirect to="/garage/" label="the Workshop" />;
}
