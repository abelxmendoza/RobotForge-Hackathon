import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Providers from "@/store/Providers";
import DemoBar from "@/components/shell/DemoBar";
import "@/styles/tokens.css";
import "@/styles/app.css";
import "@/styles/site.css";
import "@/styles/chat.css";
import "@/styles/anim.css";

export const metadata: Metadata = {
  title: { default: "RobotForge", template: "%s · RobotForge" },
  description: "Check a robot before you build it — describe it, spec it, gate its simulated twin against ground truth.",
  // Browser-tab logo on every route: the SVG logo where supported,
  // emblem-crop PNGs (scripts/make-favicon.mjs) everywhere else.
  icons: {
    icon: [
      { url: "/assets/img/logo.svg", type: "image/svg+xml" },
      { url: "/assets/img/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/assets/img/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/img/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/assets/img/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/assets/img/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/assets/img/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export const viewport: Viewport = { themeColor: "#0b1420" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* robot-forge.vercel.app can't reach the live Worker (its CORS
         * list only has robot-forge-hackathon*), and the vercel.json
         * host redirect didn't take effect there, so send visitors on
         * before anything renders. Remove once the Worker allows it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(location.hostname==='robot-forge.vercel.app'){location.replace('https://robot-forge-hackathon.vercel.app'+location.pathname+location.search+location.hash)}",
          }}
        />
      </head>
      <body>
        <Providers>
          <DemoBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
