"use client";
/* "Run the demo" — the one demo entry on the landing page (Abel,
 * 2026-11-01: "make sure there's only one"). It is a plain link to
 * /demo/. The app is behind the login-or-demo gate, so a visitor
 * with no account session and demo mode off would hit the sign-in
 * screen instead of the demo; for them the click first seeds the
 * demo sandbox and turns demo mode on (as DemoEntryButton does),
 * then opens /demo/. Signed-in visitors and visitors already in
 * demo mode just follow the link. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { loadSession } from "@/lib/auth";
import { isDemoMode, setDemoMode } from "@/lib/demoMode";
import { seedDemoStores } from "@/lib/demoSeed";

/* `to` sends the click somewhere other than /demo/ (the landing's
 * Build / Fix / Modify / Upgrade / Simulate cards deep-link into the Workshop);
 * visitors with no session still get demo mode turned on first. */
export default function RunDemoLink({ className, style, children, to = "/demo/" }: { className?: string; style?: CSSProperties; children: ReactNode; to?: string }) {
  const router = useRouter();
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (loadSession() || isDemoMode()) return;
    e.preventDefault();
    try {
      await seedDemoStores();
    } catch {
      /* seeding is best-effort; the demo still opens */
    }
    setDemoMode(true);
    router.push(to);
  };
  return <Link className={className} style={style} href={to} onClick={onClick}>{children}</Link>;
}
