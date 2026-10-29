import Link from "next/link";
import type { ReactNode } from "react";
import RevealInit from "./RevealInit";

export const REPO_URL = "https://github.com/abelxmendoza/RobotForge-Hackathon";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#1a1204" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="6" width="16" height="9" rx="2" />
        <circle cx="8" cy="17.5" r="2" /><circle cx="16" cy="17.5" r="2" />
      </svg>
    </span>
  );
}

const NAV = [
  {id:"notebook",label:"My workshop",href:"/notebook/",icon:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></>},
  {id:"data",label:"Data",href:"/data/",icon:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M3 15h18"/></>},
  {id:"research",label:"Research",href:"/research/",icon:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>},
  { id: "forge", label: "Forge chat", href: "/forge/", icon: (<><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="16" r="3" /></>) },
  { id: "robots", label: "Robot library", href: "/robots/", icon: (<><rect x="4" y="7" width="16" height="9" rx="2" /><circle cx="8" cy="18.5" r="1.8" /><circle cx="16" cy="18.5" r="1.8" /><path d="M12 7V4" /></>) },
  { id: "evidence", label: "Evidence", href: "/evidence/", icon: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) },
];

export interface Crumb { label: string; href?: string }

export default function AppShell({ active, crumbs = [], children }:
  { active: string; crumbs?: Crumb[]; children: ReactNode }) {
  return (
    <div className="shell">
      <a className="workshop-skip" href="#content">Skip to workspace</a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <BrandMark /><span>RobotForge<small>IDEAS INTO MACHINES</small></span>
        </Link>
        <Link className="btn btn-primary workshop-new" href="/forge/#forge-input">+ Create a robot</Link>
        <p className="workshop-nav-label">Your workspace</p>
        <nav className="side-nav" aria-label="App">
          {NAV.map((n) => (
            <Link key={n.id} href={n.href} aria-current={n.id === active ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{n.icon}</svg>
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <div className="workshop-tip"><strong>A little idea. A real robot.</strong><p>Build your spec, check the details, and explore what comes next.</p></div>
          <Link href="/">&larr; RobotForge site</Link>
          <a href={REPO_URL}>GitHub</a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link className="mobile-brand" href="/" aria-label="RobotForge site"><BrandMark /></Link>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return last || !c.href ? (
                <span key={i} className="here" aria-current="page">{c.label}</span>
              ) : (
                <span key={i}>
                  <Link href={c.href}>{c.label}</Link>
                  <span className="sep" aria-hidden="true">/</span>
                </span>
              );
            })}
          </nav>
          <span className="recorded" title="Simulation evidence is recorded. Photo analysis and sourced research use the configured live service.">Recorded simulation</span>
          {active !== "forge" && <Link className="btn btn-sm unified-chat-link" href="/forge/#ask">Ask Forge ↗</Link>}
        </header>
        <main className="content" id="content">{children}</main>
      </div>
      <RevealInit />
    </div>
  );
}
