"use client";
import { useEffect } from "react";
import Link from "next/link";
import ChatLauncher from "@/components/chat/ChatLauncher";
import RevealInit from "@/components/shell/RevealInit";
import { BrandMark, REPO_URL } from "@/components/shell/AppShell";

// The vanilla landing's chrome (index.html): site header with the
// scrolled shadow toggle, footer, floating Forge Guide, motion pack.
export function LandingHeader() {
  useEffect(() => {
    const h = document.querySelector(".site-header");
    if (!h) return;
    const on = () => h.classList.toggle("scrolled", window.scrollY > 8);
    addEventListener("scroll", on, { passive: true });
    on();
    return () => removeEventListener("scroll", on);
  }, []);
  return (
    <header className="site-header" id="top">
      <div className="wrap">
        <Link className="brand" href="/">
          <BrandMark />
          RobotForge
        </Link>
        <nav className="site-nav" aria-label="Page sections">
          <a href="/RobotForge-Hackathon/problem-space.html#odometry">Problem space</a>
          <a href="#workflow">How it works</a>
          <a href="#proof">Evidence</a>
          <a href="#robots">Robots</a>
          <a href={REPO_URL}>GitHub</a>
        </nav>
        <Link className="btn btn-primary" href="/forge/">Open the app &rarr;</Link>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <p>Built Oct 26 – Nov 4, 2026 for the Meta Global AI Developer Hackathon, Indie track, “Push the Frontier.” Earlier design exploration informed the project and is disclosed in the repository.</p>
        <p>By Abel Mendoza · <a href={REPO_URL}>GitHub</a> · Apache-2.0</p>
      </div>
    </footer>
  );
}

export default function LandingChrome() {
  return (<><ChatLauncher /><RevealInit /></>);
}
