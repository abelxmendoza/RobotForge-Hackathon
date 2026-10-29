import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Providers from "@/store/Providers";
import "@/styles/tokens.css";
import "@/styles/app.css";
import "@/styles/site.css";
import "@/styles/chat.css";
import "@/styles/anim.css";

export const metadata: Metadata = {
  title: { default: "RobotForge", template: "%s · RobotForge" },
  description: "Check a robot before you build it — describe it, spec it, gate its simulated twin against ground truth.",
};
export const viewport: Viewport = { themeColor: "#0b1420" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
