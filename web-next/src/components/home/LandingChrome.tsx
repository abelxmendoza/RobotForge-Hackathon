"use client";
import { useEffect } from "react";
import Link from "next/link";
import RevealInit from "@/components/shell/RevealInit";
import AccountControl from "@/components/shell/AccountControl";
import { BrandMark, REPO_URL } from "@/components/shell/AppShell";

/* One set of names, each always the same page (see AppShell's NAV).
 * The demo and the app are the two buttons on the right, so they are
 * not repeated as links here: one way in to each (Abel, 2026-11-01). */
const SITE_NAV = [
  { label: "Home", href: "/" },
  { label: "Robots", href: "/robots/" },
  { label: "Evidence", href: "/evidence/" },
  { label: "How it works", href: "/how-it-works/" },
];

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
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="wrap">
        <Link className="brand" href="/">
          <BrandMark />
          RobotForge
        </Link>
        <nav className="site-nav" aria-label="Site">
          {SITE_NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.href === "/" ? "page" : undefined}>{n.label}</Link>
          ))}
        </nav>
        <nav className="site-nav site-nav-aside" aria-label="More">
          <a href={REPO_URL}>GitHub</a>
          <AccountControl />
        </nav>
        <Link className="btn btn-app" href="/garage/">Open the app</Link>
        <Link className="btn btn-primary" href="/demo/">Run the demo &rarr;</Link>
        <details className="site-menu">
          <summary aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </summary>
          <div className="site-menu-panel">
            {SITE_NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={n.href === "/" ? "page" : undefined}>{n.label}</Link>
            ))}
            <Link href="/garage/">Open the app</Link>
            <a href={REPO_URL}>GitHub</a>
          </div>
        </details>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-brand-wrap">
        <Link className="brand" href="/">
          <BrandMark />
          RobotForge
        </Link>
      </div>
      <div className="wrap">
        <p>Built Oct 26 – Nov 4, 2026 for the Meta Global AI Developer Hackathon, Indie track, “Push the Frontier.” Earlier design exploration informed the project and is disclosed in the repository.</p>
        <p>By Abel Mendoza · <Link href="/how-it-works/">How it works</Link> · <a href={REPO_URL}>GitHub</a> · Apache-2.0</p>
      </div>
    </footer>
  );
}

export default function LandingChrome() {
  return (<><RevealInit /></>);
}
