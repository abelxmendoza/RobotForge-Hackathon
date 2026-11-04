"use client";
/* Open the populated, isolated demo Workshop without requiring an account. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { isDemoMode, setDemoMode } from "@/lib/demoMode";
import { saveSession } from "@/lib/auth";
import { seedDemoStores } from "@/lib/demoSeed";

/* `to` sends the click somewhere other than /garage/ (the landing's
 * Build / Fix / Modify / Upgrade / Simulate cards deep-link into the Workshop);
 * visitors with no session still get demo mode turned on first. */
export default function RunDemoLink({ className, style, children, to = "/garage/" }: { className?: string; style?: CSSProperties; children: ReactNode; to?: string }) {
  const router = useRouter();
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (isDemoMode()) return;
    e.preventDefault();
    try {
      await seedDemoStores();
    } catch {
      /* seeding is best-effort; the demo still opens */
    }
    setDemoMode(true);
    saveSession(null);
    router.push(to);
  };
  return <Link className={className} style={style} href={to} onClick={onClick}>{children}</Link>;
}
