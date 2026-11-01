"use client";
/**
 * Demo video card — the landing hero's secondary slot, beside the
 * "Try the demo" CTA (simulated-demo-video-plan-2026-11-01 §6).
 *
 * The landing has ONE video player: the #trailer band below the
 * hero, which plays the approved in-repo trailer render. This card
 * keeps its poster thumbnail in the hero and acts as the signpost:
 * its play overlay is an anchor that scrolls to #trailer. It never
 * renders a second player or an embed placeholder.
 *
 * The poster is a screenshot of the current build's demo Workshop,
 * stored base64 in assets/img/demo-poster.jpg.b64 and decoded at
 * prebuild by scripts/make-demo-poster.mjs (same pattern as the
 * app icon), so what the card shows is the app as it actually is.
 */
import { assetPath } from "@/components/home/asset";

const POSTER = "assets/img/demo-poster.jpg";
const RUNTIME = "0:56";
const LABEL =
  "Recorded walkthrough · demo data · everything shown is the live app";

export default function DemoVideoCard() {
  return (
    <figure className="demo-video">
      <div className="demo-video-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetPath(POSTER)}
          width={1280}
          height={720}
          alt="The RobotForge demo Workshop: the seeded TurtleBot3 Burger build, mid-session"
        />
        <a
          className="demo-video-play"
          href="#trailer"
          aria-label={`Watch the trailer (${RUNTIME})`}
        >
          <span className="demo-video-btn" aria-hidden="true">▶</span>
          <span className="demo-video-cta">
            Watch the trailer ({RUNTIME})
          </span>
        </a>
      </div>
      <figcaption>
        {LABEL} · {RUNTIME}
      </figcaption>
    </figure>
  );
}
