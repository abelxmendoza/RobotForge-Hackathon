"use client";
/* "Try the demo" — the LoreBook entry point (Abel, 2026-11-01):
 * one tap, no account, no Worker call. Seeds the demo sandbox
 * (lib/demoSeed.ts), flips the demo flag (lib/demoMode.ts) and
 * lands the visitor in the Workshop, where the seeded demo robot
 * is waiting. Renders nothing while demo mode is already on —
 * the DemoBar owns that state. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setDemoMode, useDemoMode } from "@/lib/demoMode";
import { seedDemoStores } from "@/lib/demoSeed";

export default function DemoEntryButton({
  className = "btn",
  label = "Try the demo",
  to = "/garage/",
}: {
  className?: string;
  label?: string;
  /* Where the visitor lands once demo mode is on. */
  to?: string;
}) {
  const demo = useDemoMode();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (demo) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await seedDemoStores();
        } catch {
          /* seeding is best-effort; the demo still opens */
        }
        setDemoMode(true);
        router.push(to);
      }}
    >
      {label}
    </button>
  );
}
