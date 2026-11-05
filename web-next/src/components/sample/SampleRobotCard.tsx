"use client";
/* The Omega1 sample card: a real photo, heading, blurb and repo link
 * from the single source (lib/sampleRobot.ts), and two ways in:
 *  - "Open Omega1 now" (primary): one click, Omega1 lands in the
 *    Workshop from its records — no AI or GitHub call, so it works
 *    the same in demo mode and signed in;
 *  - "Send it to Wrench": sends the sample prompt, whose repo link
 *    opens the importer, same as pasting it by hand.
 * Shown on the Workshop's first run and in the Robodex's empty
 * My robots tab. */
import { useRouter } from "next/navigation";
import {
  SAMPLE_BLURB,
  SAMPLE_HEADING,
  SAMPLE_OPEN_LABEL,
  SAMPLE_OPEN_NOTE,
  SAMPLE_PROMPT,
  SAMPLE_REPO_URL,
  openSampleInWorkshop,
} from "@/lib/sampleRobot";
import { OMEGA1_PHOTO } from "@/lib/omega1Twin";
import { promptWrench } from "@/lib/wrenchPrompt";
import { assetPath } from "@/components/home/asset";
import CopyButton from "@/components/chat/CopyButton";

export default function SampleRobotCard() {
  const router = useRouter();
  return (
    <section className="sample-card" aria-label={SAMPLE_HEADING}>
      <span className="sample-card-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetPath(OMEGA1_PHOTO.url)}
          alt="The real Omega1 rover on its workbench"
          loading="lazy"
        />
      </span>
      <div className="sample-card-body">
        <span className="sample-card-badge">Sample robot</span>
        <h3>{SAMPLE_HEADING}</h3>
        <p>{SAMPLE_BLURB}</p>
        <div className="sample-card-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openSampleInWorkshop((href) => router.push(href))}
          >
            {SAMPLE_OPEN_LABEL}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => promptWrench({ mode: "chat", text: SAMPLE_PROMPT, send: true })}
          >
            Send it to Wrench
          </button>
        </div>
        <p className="faint sample-card-note">{SAMPLE_OPEN_NOTE}</p>
        <p className="sample-card-link">
          <a href={SAMPLE_REPO_URL} target="_blank" rel="noreferrer">
            {SAMPLE_REPO_URL}
          </a>{" "}
          <CopyButton
            getText={() => SAMPLE_REPO_URL}
            label="Copy"
            title="Copy the Omega1 sample repo link"
          />
        </p>
      </div>
    </section>
  );
}
