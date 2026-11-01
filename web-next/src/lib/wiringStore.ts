'use client';
/* The build list's wiring, stored in this browser under
 * rf.wiring.v1 — the sibling of rf.build.v1 (lib/buildList.ts),
 * read and written through lib/store.ts so every mounted reader
 * stays in sync via the rf-store event. The connections, ports,
 * checks and grammar are lib/buildWiring.ts's — pure and
 * node-tested.
 *
 * Demo isolation: the demo mode (lib/demoMode.ts — "rf.demo.v1 →
 * <key>.demo storage twins") redirects the visitor-data stores to
 * ".demo" twins so a demo visitor's wiring never touches their
 * real build's. This module resolves the same twin itself: while
 * the demo flag is set, reads and writes land on
 * "rf.wiring.v1.demo". (On branches where the demo flag is never
 * set, the key is always the plain one.) */
import { useEffect, useState } from "react";
import { readStore, useStore, writeStore } from "./store";
import type { BuildWiring } from "./buildWiring";

export const WIRING_KEY = "rf.wiring.v1";

/* The demo mode's flag key (lib/demoMode.ts owns it; mirrored
 * here so this module resolves its twin without an import cycle
 * through the shell). */
const DEMO_FLAG_KEY = "rf.demo.v1";
const DEMO_EVENT = "rf-demo-change";

/* Pure key resolution, node-tested: the twin when demo is on. */
export function resolveWiringKey(demoOn: boolean): string {
  return demoOn ? `${WIRING_KEY}.demo` : WIRING_KEY;
}

function demoOnNow(): boolean {
  try {
    return Boolean(window.localStorage.getItem(DEMO_FLAG_KEY));
  } catch {
    return false;
  }
}

export function useBuildWiring(): [
  BuildWiring,
  (next: BuildWiring) => string | null,
  boolean,
] {
  const [key, setKey] = useState<string>(WIRING_KEY);
  useEffect(() => {
    const read = () => setKey(resolveWiringKey(demoOnNow()));
    read();
    window.addEventListener(DEMO_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(DEMO_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return useStore<BuildWiring>(key, { connections: [] });
}

/* One-shot read/write against the resolved key — the chat's
 * command path uses these, the same way it reads rf.build.v1
 * through lib/store.ts directly. */
export function readBuildWiring(): BuildWiring {
  return readStore<BuildWiring>(resolveWiringKey(demoOnNow()), {
    connections: [],
  });
}

export function writeBuildWiring(next: BuildWiring): string | null {
  return writeStore(resolveWiringKey(demoOnNow()), next);
}
