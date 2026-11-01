/* The BOM wizard was retired on 2026-11-01: the Workshop's BOM tab
 * does the same job for the robot on the bench. Old links land here
 * and are sent on to that tab. */
import type { Metadata } from "next";
import BomRedirect from "./BomRedirect";

export const metadata: Metadata = { title: "BOM", robots: { index: false } };

export default function BomPage() {
  return <BomRedirect />;
}
