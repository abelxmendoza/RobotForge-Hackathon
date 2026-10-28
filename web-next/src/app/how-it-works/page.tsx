import type { Metadata } from "next";
import HowItWorks from "@/components/home/HowItWorks";
import AppShell from "@/components/shell/AppShell";

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
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "How it works",
  description:
    "How RobotForge decides: Muse Spark drafts the spec, engineering checks validate it, and a Gazebo twin is graded against ground truth — what a PASS proves, and what it doesn't.",
};

export default function HowItWorksPage() {
  return (
    <AppShell active="" crumbs={[{ label: "App", href: "/forge/" }, { label: "How it works" }]}>
      <section className="band">
        <div className="wrap">
          <HowItWorks />
        </div>
      </section>
    </AppShell>
  );
}
