"use client";
/**
 * Demo video card — the landing hero's secondary slot, beside the
 * "Try the demo" CTA (simulated-demo-video-plan-2026-11-01 §6).
 *
 * THE one place the demo video lives on the site. To light the
 * player up: upload the current render (masters live in the
 * workspace, hackathon/trailer/) to YouTube as unlisted and set
 * DEMO_VIDEO_EMBED_URL + DEMO_VIDEO_RUNTIME below — one constant,
 * one string. Until then the card is a poster of the real app that
 * sends the visitor into the interactive demo itself; it never
 * renders a dead or black player.
 *
 * The poster is a screenshot of the current build's demo Workshop,
 * stored base64 in assets/img/demo-poster.jpg.b64 and decoded at
 * prebuild by scripts/make-demo-poster.mjs (same pattern as the
 * app icon), so what the card shows is the app as it actually is.
 */
import { useState } from "react";
import Link from "next/link";
import { assetPath } from "@/components/home/asset";

/* YouTube embed URL of the current approved render, e.g.
 * "https://www.youtube-nocookie.com/embed/<id>". Empty = no public
 * upload yet, poster mode (see the header comment). */
export const DEMO_VIDEO_EMBED_URL = "";
/* Runtime of that render, e.g. "2:47". Shown only when known —
 * the plan's label carries the runtime "once known", never a guess. */
export const DEMO_VIDEO_RUNTIME = "";

const POSTER = "assets/img/demo-poster.jpg";
const LABEL =
  "Recorded walkthrough · demo data · everything shown is the live app";

export default function DemoVideoCard() {
  const [playing, setPlaying] = useState(false);
  const hasVideo = DEMO_VIDEO_EMBED_URL !== "";
  return (
    <figure className="demo-video">
      <div className="demo-video-frame">
        {hasVideo && playing ? (
          <iframe
            src={`${DEMO_VIDEO_EMBED_URL}?autoplay=1&rel=0`}
            title="RobotForge demo — recorded walkthrough"
            loading="lazy"
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetPath(POSTER)}
              width={1280}
              height={720}
              alt="The RobotForge demo Workshop: the seeded TurtleBot3 Burger build, mid-session"
            />
            {hasVideo ? (
              <button
                type="button"
                className="demo-video-play"
                onClick={() => setPlaying(true)}
                aria-label={`Play the demo video${DEMO_VIDEO_RUNTIME ? ` (${DEMO_VIDEO_RUNTIME})` : ""}`}
              >
                <span className="demo-video-btn" aria-hidden="true">▶</span>
                <span className="demo-video-cta">
                  Watch the demo{DEMO_VIDEO_RUNTIME ? ` (${DEMO_VIDEO_RUNTIME})` : ""}
                </span>
              </button>
            ) : (
              <Link className="demo-video-play" href="/demo/">
                <span className="demo-video-btn" aria-hidden="true">▶</span>
                <span className="demo-video-cta">Watch it in the demo</span>
              </Link>
            )}
          </>
        )}
      </div>
      <figcaption>
        {LABEL}
        {hasVideo && DEMO_VIDEO_RUNTIME ? ` · ${DEMO_VIDEO_RUNTIME}` : ""}
      </figcaption>
    </figure>
  );
}
