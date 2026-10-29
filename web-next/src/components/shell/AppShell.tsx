import Link from "next/link";
import type { ReactNode } from "react";
import ChatDock from "@/components/chat/ChatDock";
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
  { id: "forge", label: "Forge", href: "/forge/", icon: (<><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="16" r="3" /></>) },
  { id: "garage", label: "Garage", href: "/garage/", icon: (<><path d="M3 10l9-6 9 6v10H3z" /><path d="M7 20v-6h10v6" /></>) },
  { id: "inventory", label: "Parts", href: "/inventory/", icon: (<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>) },
  { id: "robots", label: "Robots", href: "/robots/", icon: (<><rect x="4" y="7" width="16" height="9" rx="2" /><circle cx="8" cy="18.5" r="1.8" /><circle cx="16" cy="18.5" r="1.8" /><path d="M12 7V4" /></>) },
  { id: "evidence", label: "Evidence", href: "/evidence/", icon: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) },
];

export interface Crumb { label: string; href?: string }

export default function AppShell({ active, crumbs = [], children }:
  { active: string; crumbs?: Crumb[]; children: ReactNode }) {
  return (
    <div className="shell">
      <ChatDock />
      <aside className="sidebar">
        <Link className="brand" href="/">
          <BrandMark /><span>RobotForge<small>App</small></span>
        </Link>
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
          <span className="recorded" title="This static site replays recorded runs. Nothing here calls a model or a simulator live.">Recorded runs</span>
          <a className="gh-link" href={REPO_URL}>GitHub</a>
        </header>
        <main className="content" id="content">{children}</main>
      </div>
      <RevealInit />
    </div>
  );
}
