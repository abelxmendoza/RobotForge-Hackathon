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
import { saveSession } from "@/lib/auth";
import { seedDemoStores } from "@/lib/demoSeed";

export default function DemoEntryButton({
  className = "btn",
  label = "Try the demo",
  to = "/garage/",
  onBeforeEnter,
}: {
  className?: string;
  label?: string;
  /* Where the visitor lands once demo mode is on. */
  to?: string;
  /* Runs first on click, e.g. to queue the Omega1 sample (AppGate). */
  onBeforeEnter?: () => void;
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
        onBeforeEnter?.();
        try {
          await seedDemoStores();
        } catch {
          /* seeding is best-effort; the demo still opens */
        }
        setDemoMode(true);
        saveSession(null);
        router.push(to);
      }}
    >
      {label}
    </button>
  );
}
