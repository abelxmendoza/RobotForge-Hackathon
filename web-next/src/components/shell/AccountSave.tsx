"use client";
/* The top bar's Save button: shown when signed in (never in the
 * demo). It saves this browser's robots, parts and BOM prices to the
 * account (lib/accountSync.ts) and shows whether anything changed
 * since the last save. */
import { useCallback, useEffect, useState } from "react";
import { AUTH_EVENT, loadSession, type AuthSession } from "@/lib/auth";
import { useDemoMode } from "@/lib/demoMode";
import {
  ACCOUNT_DATA_KEYS, ACCOUNT_SAVE_EVENT, collectLocalData, hashData, readSavedMark, saveToAccount,
} from "@/lib/accountSync";

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export default function AccountSave() {
  const inDemo = useDemoMode();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [state, setState] = useState<"saved" | "changed" | "never" | "saving">("never");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setSession(loadSession());
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(AUTH_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const email = session?.user.email ?? null;
  const refresh = useCallback(() => {
    if (!email) return;
    const mark = readSavedMark(email);
    setSavedAt(mark?.savedAt ?? null);
    setState((s) => (s === "saving" ? s : !mark ? "never" : mark.hash === hashData(collectLocalData()) ? "saved" : "changed"));
  }, [email]);

  /* Re-check after any store write (debounced: the Build bench can
   * write often) and after a save or load elsewhere. */
  useEffect(() => {
    refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onStore = (e: Event) => {
      const k = (e as CustomEvent).detail ?? (e as StorageEvent).key;
      if (k && !ACCOUNT_DATA_KEYS.includes(k)) return;
      clearTimeout(t);
      t = setTimeout(refresh, 400);
    };
    window.addEventListener("rf-store", onStore);
    window.addEventListener("storage", onStore);
    window.addEventListener(ACCOUNT_SAVE_EVENT, refresh);
    return () => {
      clearTimeout(t);
      window.removeEventListener("rf-store", onStore);
      window.removeEventListener("storage", onStore);
      window.removeEventListener(ACCOUNT_SAVE_EVENT, refresh);
    };
  }, [refresh]);

  if (!session || inDemo) return null;

  const save = async () => {
    setError(null);
    setState("saving");
    try {
      const mark = await saveToAccount(session.token, session.user.email);
      setSavedAt(mark.savedAt);
      setState("saved");
    } catch (e) {
      setError((e as Error).message);
      setState("changed");
    }
  };

  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save";
  const hint = state === "saved" && savedAt
    ? `Saved to your account at ${timeOf(savedAt)}`
    : state === "changed" && savedAt
      ? `Changes since your last save at ${timeOf(savedAt)}`
      : "Save your robots and parts to your account";

  return (
    <span className="acct-save">
      <button
        type="button"
        className={"btn btn-sm acct-save-btn" + (state === "changed" || state === "never" ? " btn-primary" : "")}
        onClick={save}
        disabled={state === "saving"}
        title={hint}
        aria-label={hint}
      >
        {state === "changed" && <i className="acct-save-dot" aria-hidden="true" />}
        {label}
      </button>
      {error && <span className="acct-save-err" role="alert">{error}</span>}
    </span>
  );
}
