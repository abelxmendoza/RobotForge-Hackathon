"use client";
/* The Omega1 sample card: heading, blurb and repo link from the
 * single source (lib/sampleRobot.ts), a Copy button for the link,
 * and "Send it to Wrench", which sends the sample prompt — its
 * repo link opens the importer, same as pasting it by hand. */
import {
  SAMPLE_BLURB,
  SAMPLE_HEADING,
  SAMPLE_PROMPT,
  SAMPLE_REPO_URL,
} from "@/lib/sampleRobot";
import { promptWrench } from "@/lib/wrenchPrompt";
import CopyButton from "@/components/chat/CopyButton";

export default function SampleRobotCard() {
  return (
    <section className="sample-card" aria-label={SAMPLE_HEADING}>
      <h3>{SAMPLE_HEADING}</h3>
      <p>{SAMPLE_BLURB}</p>
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
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => promptWrench({ mode: "chat", text: SAMPLE_PROMPT, send: true })}
      >
        Send it to Wrench
      </button>
    </section>
  );
}
