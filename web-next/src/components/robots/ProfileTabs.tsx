"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* The robot profile's tab bar (2026-11-23 redesign). The page used to
 * be one ~9,000 px scroll of ten sections; each section now lives in
 * one of five tabs. A pane mounts the first time it is opened and
 * then stays mounted (hidden), so the 3D viewers keep their state when
 * you switch away and back.
 *
 * Old deep links keep working: `#gate`, `#physics`, `#parts-kit`,
 * `#take-apart` … open the tab that now holds that section and scroll
 * to it. Links elsewhere in the app (Evidence, the landing page, the
 * Workshop's Simulate tab, Wrench) use those anchors. */

export interface ProfilePane {
  id: string;
  label: string;
  /* Section anchors that live inside this pane. */
  anchors?: string[];
  content: ReactNode;
}

function paneFor(hash: string, panes: ProfilePane[]): ProfilePane | undefined {
  const h = hash.replace(/^#/, "");
  if (!h) return undefined;
  return panes.find((p) => p.id === h || `tab-${p.id}` === h || p.anchors?.includes(h));
}

export default function ProfileTabs({ panes, name }: { panes: ProfilePane[]; name: string }) {
  const [active, setActive] = useState(panes[0]?.id ?? "");
  const [seen, setSeen] = useState<Set<string>>(() => new Set([panes[0]?.id ?? ""]));
  const barRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const open = (id: string, scrollTo?: string) => {
    setActive(id);
    setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
    if (scrollTo) {
      /* Wait for the pane to mount before looking for the anchor. */
      const go = () => document.getElementById(scrollTo)?.scrollIntoView({ block: "start" });
      requestAnimationFrame(() => requestAnimationFrame(go));
      /* …and once more after the pane's own content (3D viewers,
         fetched specs) has had a moment to lay out. */
      window.setTimeout(go, 400);
    }
  };

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      const pane = paneFor(h, panes);
      if (!pane) return;
      const anchor = pane.id === h || `tab-${pane.id}` === h ? `profile-tabs` : h;
      open(pane.id, anchor);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (id: string) => {
    open(id);
    try {
      history.replaceState(null, "", `#tab-${id}`);
    } catch {
      /* history blocked: the tab still switches */
    }
    /* The bar is sticky, so its own position never says how far down
       the reader is. Use the tab container instead: once its top has
       scrolled under the sticky bar, bring the new pane's start into
       view (scroll-margin-top keeps it clear of the topbar). */
    const wrap = rootRef.current;
    const bar = barRef.current;
    if (wrap && bar) {
      const pinnedAt = bar.getBoundingClientRect().top;
      if (wrap.getBoundingClientRect().top < pinnedAt - 1) {
        wrap.scrollIntoView({ block: "start" });
      }
    }
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % panes.length;
    if (e.key === "ArrowLeft") next = (i - 1 + panes.length) % panes.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = panes.length - 1;
    if (next < 0) return;
    e.preventDefault();
    choose(panes[next].id);
    document.getElementById(`ptab-${panes[next].id}`)?.focus();
  };

  return (
    <div className="profile-tabs" id="profile-tabs" ref={rootRef}>
      <div className="ptab-bar" ref={barRef}>
        <span className="ptab-context" aria-hidden="true">{name}</span>
        <div className="ptab-list" role="tablist" aria-label={`${name} profile`}>
          {panes.map((p, i) => (
            <button
              key={p.id}
              id={`ptab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={active === p.id}
              aria-controls={`ppane-${p.id}`}
              tabIndex={active === p.id ? 0 : -1}
              className="ptab"
              onClick={() => choose(p.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {panes.map((p) =>
        seen.has(p.id) ? (
          <div
            key={p.id}
            id={`ppane-${p.id}`}
            role="tabpanel"
            aria-labelledby={`ptab-${p.id}`}
            className="ppane"
            hidden={active !== p.id}
          >
            {p.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

/* A small "How this works" fold for the long honesty notes that used
 * to open every section. The words are kept; they just stop sitting
 * in front of the result. */
export function InfoTip({ children, label = "How this works" }: { children: ReactNode; label?: string }) {
  return (
    <details className="info-tip">
      <summary><span aria-hidden="true">ⓘ</span> {label}</summary>
      <div className="info-tip-body">{children}</div>
    </details>
  );
}
