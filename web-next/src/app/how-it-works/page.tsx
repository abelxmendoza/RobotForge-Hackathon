import type { Metadata } from "next";
import HowItWorks from "@/components/home/HowItWorks";
import AppShell from "@/components/shell/AppShell";
import AiInside from "@/components/home/AiInside";
import { Glossary } from "@/components/shell/Term";
import DrivingTest from "@/components/home/DrivingTest";
import CapabilityCards from "@/components/home/Capabilities";
import StatusCards from "@/components/home/StatusCards";

/**
 * How it works — the one detail page: the driving test and its
 * recorded runs, what a PASS proves and what it doesn't, what the
 * app does, what's live, the AI-inside table and the glossary.
 *
 * 2026-11-17 simplify pass: the landing keeps one path for a new
 * visitor (try it, watch it, meet Wrench); the driving test, the
 * recorded runs, the capability list and the status cards moved here
 * from the landing, so each is still explained exactly once.
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
      <div className="page-head">
        <div>
          <div className="eyebrow">Fine print</div>
          <h1>How it works</h1>
          <p className="lede">
            The driving test, what a PASS proves, and what&apos;s live.
          </p>
        </div>
      </div>
      <DrivingTest />
      <section className="band">
        <div className="wrap">
          <HowItWorks />
        </div>
      </section>
      <section className="band" id="capabilities">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">In plain terms</div>
            <h2>What RobotForge does</h2>
          </div>
          <CapabilityCards />
          <p className="section-more muted">
            Still to come: shopping links with sourced prices, and
            manufacturing-ready wire harnesses.
          </p>
        </div>
      </section>
      <section className="band" id="status">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Status</div>
            <h2>What&apos;s live right now.</h2>
            <p>Checked on the served site, Nov 1, 2026.</p>
          </div>
          <StatusCards />
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
