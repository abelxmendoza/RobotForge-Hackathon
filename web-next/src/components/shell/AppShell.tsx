import Link from "next/link";
import type { ReactNode } from "react";
import RevealInit from "./RevealInit";
import AccountControl from "./AccountControl";
import AccountSave from "./AccountSave";
import { DemoPill } from "./DemoBar";
import DemoIdentity from "./DemoIdentity";
import AppGate, { GateProvider, GatedChatBar } from "./AppGate";
import { assetPath } from "@/components/home/asset";

export const REPO_URL = "https://github.com/abelxmendoza/RobotForge-Hackathon";

export function BrandMark() {
  return (
    <span className="brand-mark brand-mark--logo" aria-hidden="true">
      {/* Abel's logo (assets/img/logo.svg). The CSS geometry on
          .brand-mark--logo crops the emblem out of the full lockup;
          the landing hero shows the whole lockup. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetPath("assets/img/logo.svg")} alt="" />
    </span>
  );
}

/* App navigation: Workshop, Library, Robots (2026-11-12 simplify).
 * Home is the logo. `more` items would fold into the phone bar's
 * More menu; none do now. */
const NAV = [
  { id: "workshop", label: "Workshop", href: "/garage/", icon: (<><path d="M3 10l9-6 9 6v10H3z" /><path d="M7 20v-6h10v6" /></>) },
  { id: "inventory", label: "Library", href: "/inventory/", icon: (<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>) },
  { id: "robots", label: "Robots", href: "/robots/", icon: (<><rect x="4" y="7" width="16" height="9" rx="2" /><circle cx="8" cy="18.5" r="1.8" /><circle cx="16" cy="18.5" r="1.8" /><path d="M12 7V4" /></>) },
];

export interface Crumb { label: string; href?: string }

export default function AppShell({ active, crumbs = [], wide = false, gate = true, children }:
  { active: string; crumbs?: Crumb[]; wide?: boolean; gate?: boolean; children: ReactNode }) {
  /* Every trail starts at Home; pages still passing the old "App"
   * root crumb get it replaced. */
  const trail: Crumb[] = [{ label: "Home", href: "/" }, ...crumbs.filter((c) => c.label !== "App")];
  return (
    <div className="shell">
      <a className="skip-link" href="#content">Skip to content</a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <BrandMark /><span>RobotForge<small>App</small></span>
        </Link>
        <nav className="side-nav" aria-label="App">
          {NAV.map((n) => (
            <Link key={n.id} href={n.href}
              aria-current={n.id === active ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{n.icon}</svg>
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <Link href="/how-it-works/" aria-current={active === "how" ? "page" : undefined}>How it works</Link>
          <a href={REPO_URL}>GitHub</a>
          <Link href="/credits/" aria-current={active === "credits" ? "page" : undefined}>Credits</Link>
        </div>
      </aside>
      <GateProvider enabled={gate}>
      <GatedChatBar />
      <div className="main">
        <header className="topbar">
          <Link className="mobile-brand" href="/" aria-label="RobotForge home"><BrandMark /></Link>
          <nav className="crumbs" aria-label="Breadcrumb">
            {trail.map((c, i) => {
              const last = i === trail.length - 1;
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
          <DemoIdentity />
          <DemoPill />
          <AccountSave />
          <AccountControl />
          <a className="gh-link" href={REPO_URL}>GitHub</a>
        </header>
        <main className={wide ? "content content--wide" : "content"} id="content">
          {gate ? <AppGate>{children}</AppGate> : children}
        </main>
      </div>
      </GateProvider>
      <RevealInit />
    </div>
  );
}
