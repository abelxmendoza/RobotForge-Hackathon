/* /chat/ used to be a second, full-page copy of the chat. Wrench now
 * lives in the bottom bar on every page, and its full-size view is the
 * Workspace, so old links land there. */
import type { Metadata } from "next";
import Redirect from "./Redirect";

export const metadata: Metadata = {
  title: "Wrench",
  robots: { index: false },
  other: { refresh: "0; url=/forge/" },
};

export default function ChatRoute() {
  return <Redirect />;
}
