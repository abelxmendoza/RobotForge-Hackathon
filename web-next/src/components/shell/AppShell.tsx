import Link from "next/link";
import type { ReactNode } from "react";
import RevealInit from "./RevealInit";
import AccountControl from "./AccountControl";
import DemoEntryButton from "./DemoEntryButton";
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

/* App navigation. `more` items fold into the phone bar's More menu;
 * every item shows in the desktop sidebar. */
const NAV = [
  { id: "home", label: "Home", href: "/", icon: (<><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>) },
  { id: "demo", label: "Demo", href: "/demo/", icon: (<><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" /></>) },
  { id: "workshop", label: "Workshop", href: "/garage/", icon: (<><path d="M3 10l9-6 9 6v10H3z" /><path d="M7 20v-6h10v6" /></>) },
  { id: "inventory", label: "My parts", href: "/inventory/", icon: (<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>) },
  { id: "robots", more: true, label: "Robots", href: "/robots/", icon: (<><rect x="4" y="7" width="16" height="9" rx="2" /><circle cx="8" cy="18.5" r="1.8" /><circle cx="16" cy="18.5" r="1.8" /><path d="M12 7V4" /></>) },
  { id: "bom", more: true, label: "BOM wizard", href: "/bom/", icon: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>) },
  { id: "evidence", more: true, label: "Evidence", href: "/evidence/", icon: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>) },
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
            <Link key={n.id} href={n.href} className={n.more ? "nav-more-item" : undefined}
              aria-current={n.id === active ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{n.icon}</svg>
              <span>{n.label}</span>
            </Link>
          ))}
          <details className="nav-more">
            <summary aria-label="More pages">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
              <span>More</span>
            </summary>
            <div className="nav-more-menu">
              {NAV.filter((n) => n.more).map((n) => (
                <Link key={n.id} href={n.href} aria-current={n.id === active ? "page" : undefined}>{n.label}</Link>
              ))}
              <Link href="/how-it-works/" aria-current={active === "how" ? "page" : undefined}>How it works</Link>
              <a href={REPO_URL}>GitHub</a>
            </div>
          </details>
        </nav>
        <div className="side-foot">
          <Link href="/how-it-works/" aria-current={active === "how" ? "page" : undefined}>How it works</Link>
          <a href={REPO_URL}>GitHub</a>
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
          <DemoEntryButton className="btn btn-sm" label="Try the demo" />
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
