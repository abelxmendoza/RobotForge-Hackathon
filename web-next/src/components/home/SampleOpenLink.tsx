"use client";
/* A link that opens the Omega1 sample in the Workshop from outside
 * the app (the landing). Visitors with no session go through the
 * demo first, like RunDemoLink; a signed-in visitor stays signed in
 * and Omega1 lands in their own Workshop. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { isDemoMode, setDemoMode } from "@/lib/demoMode";
import { loadSession } from "@/lib/auth";
import { seedDemoStores } from "@/lib/demoSeed";
import { SAMPLE_OPEN_HREF } from "@/lib/sampleRobot";

export default function SampleOpenLink({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (isDemoMode() || loadSession()) return;
    e.preventDefault();
    try {
      await seedDemoStores();
    } catch {
      /* seeding is best-effort; the demo still opens */
    }
    setDemoMode(true);
    router.push(SAMPLE_OPEN_HREF);
  };
  return <Link className={className} href={SAMPLE_OPEN_HREF} onClick={onClick}>{children}</Link>;
}
