/* /chat/ was a second, full-page copy of the chat. Wrench now lives in
 * the Workshop beside your robots (and in the bottom bar elsewhere). */
import type { Metadata } from "next";
import Redirect from "@/components/shell/Redirect";

export const metadata: Metadata = {
  title: "Wrench",
  robots: { index: false },
  other: { refresh: "0; url=/garage/#wrench" },
};

export default function ChatRoute() {
  return <Redirect to="/garage/#wrench" label="the Workshop" />;
}
