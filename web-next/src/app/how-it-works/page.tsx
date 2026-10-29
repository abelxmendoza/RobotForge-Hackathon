import type { Metadata } from "next";
import HowItWorks from "@/components/home/HowItWorks";
import AppShell from "@/components/shell/AppShell";
import AiInside from "@/components/home/AiInside";
import { Glossary } from "@/components/shell/Term";

/**
 * How it works — the landing's "How RobotForge decides" section as a
 * standalone page.
 *
 * Provenance, stated plainly: the vanilla site has NO standalone
 * how-it-works page and no generator for one (src/robotforge/site.py's
 * app pages are Forge, Robots and Evidence only, and the app nav links
 * nothing else). The content below is therefore the landing #how
 * section, ported verbatim via the shared HowItWorks component — same
 * words, same classes, same locked-threshold table, same quickstart.
 * Nothing was written for this page that the vanilla site doesn't say.
 * The AI-inside table and the glossary moved here from the landing
 * page (2026-10-29), which now keeps only a short version of each.
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "How it works",
  description:
    "How RobotForge decides: Muse Spark drafts the spec, engineering checks validate it, and a Gazebo twin is graded against ground truth — what a PASS proves, and what it doesn't.",
};

export default function HowItWorksPage() {
  return (
    <AppShell active="how" crumbs={[{ label: "App", href: "/forge/" }, { label: "How it works" }]}>
      <section className="band">
        <div className="wrap">
          <HowItWorks />
        </div>
      </section>
      <section className="section" id="ai-inside">
        <h2>AI inside: where Muse Spark works</h2>
        <p className="sub">Each place a Meta model works, which model it is, and whether that step is live right now.</p>
        <AiInside />
      </section>
      <section className="section" id="glossary">
        <h2>Plain English</h2>
        <p className="sub">The words on this site, without the jargon. Dotted words anywhere on the site show the same meaning on hover or tap.</p>
        <Glossary />
      </section>
    </AppShell>
  );
}
