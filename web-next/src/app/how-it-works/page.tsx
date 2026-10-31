import type { Metadata } from "next";
import HowItWorks from "@/components/home/HowItWorks";
import AppShell from "@/components/shell/AppShell";
import AiInside from "@/components/home/AiInside";
import { Glossary } from "@/components/shell/Term";

/**
 * How it works — the fine-print page: what a PASS proves and what it
 * doesn't, the AI-inside table, and the plain-English glossary.
 *
 * The test itself is explained once, on the landing page's #workflow
 * band (the canonical explanation). This page used to restate the
 * whole mechanism via the HowItWorks component; that copy was cut on
 * 2026-10-29 at Abel's direction (declutter: one explanation, links
 * instead of copies). The AI-inside table and the glossary live here;
 * the landing keeps only a short version of the table.
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "How it works",
  description:
    "What a RobotForge PASS proves, what it doesn't, where Muse Spark works, and a plain-English glossary.",
};

export default function HowItWorksPage() {
  return (
    <AppShell active="how" crumbs={[{ label: "App", href: "/garage/" }, { label: "How it works" }]}>
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
