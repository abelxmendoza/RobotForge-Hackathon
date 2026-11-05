/* The landing's Omega1 spotlight (Abel, 2026-11-05: make the Omega1
 * sample prominent so new users, judges, recruiters and testers
 * always have a robot to try). One card under the hero buttons: the
 * real photo, plain words, and one click that opens Omega1 in the
 * Workshop. Visitors with no account land in the demo; signed-in
 * visitors stay signed in (SampleOpenLink). Words and the
 * target live in lib/sampleRobot.ts. */
import SampleOpenLink from "@/components/home/SampleOpenLink";
import { assetPath } from "@/components/home/asset";
import { OMEGA1_PHOTO } from "@/lib/omega1Twin";
import {
  SAMPLE_OPEN_LABEL,
  SAMPLE_REPO_REF,
  SAMPLE_REPO_URL,
  SAMPLE_SPOTLIGHT_BODY,
  SAMPLE_SPOTLIGHT_EYEBROW,
  SAMPLE_SPOTLIGHT_TITLE,
} from "@/lib/sampleRobot";

export default function SampleSpotlight() {
  return (
    <section className="sample-spotlight" aria-labelledby="sample-spotlight-title">
      <SampleOpenLink className="sample-spotlight-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetPath(OMEGA1_PHOTO.url)}
          alt="The real Omega1 rover on its workbench, wired to a monitor showing the Omega1 logo"
        />
        <span className="sample-spotlight-tag">Real robot · real photo</span>
      </SampleOpenLink>
      <div className="sample-spotlight-body">
        <div className="sample-spotlight-eyebrow">{SAMPLE_SPOTLIGHT_EYEBROW}</div>
        <h2 id="sample-spotlight-title">{SAMPLE_SPOTLIGHT_TITLE}</h2>
        <p>{SAMPLE_SPOTLIGHT_BODY}</p>
        <div className="sample-spotlight-ctas">
          <SampleOpenLink className="btn btn-primary">
            {SAMPLE_OPEN_LABEL} →
          </SampleOpenLink>
          <a className="btn" href={SAMPLE_REPO_URL} target="_blank" rel="noreferrer">
            Its code: {SAMPLE_REPO_REF}
          </a>
        </div>
      </div>
    </section>
  );
}
