"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { parts } from "@/lib/data";
import type { Part } from "@/lib/types";
import type { AppDispatch, RootState } from "@/store/store";
import { setQuery } from "@/store/catalogSlice";
import { imgSrc, partClassLabel, partHaystack, partSpecsText } from "./shared";

/* site.py _parts_catalog + the robots.js search: groups in
   (part_class, name) order; a part shows when the query is empty or
   appears in its recorded haystack (name, id, class, blurb, use) or
   in its rendered card text. A group with no hits hides; zero hits
   anywhere shows the state box. */

interface PartGroup { cls: string; label: string; items: Part[] }

function groupParts(): PartGroup[] {
  /* Python sorted(): plain codepoint order, not locale order */
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const sorted = [...parts].sort((a, b) =>
    cmp(a.part_class, b.part_class) || cmp(a.name, b.name));
  const groups: PartGroup[] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.cls === p.part_class) last.items.push(p);
    else groups.push({ cls: p.part_class, label: partClassLabel(p.part_class), items: [p] });
  }
  return groups;
}

function PartCard({ part, query, highlight, cardRef }: {
  part: Part;
  query: string;
  highlight: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const [imgGone, setImgGone] = useState(false);
  const specs = partSpecsText(part.specs);
  /* the vanilla hit test also searches the card's rendered text
     (figure caption + name + blurb + specs line) */
  const cardText = useMemo(
    () => `${part.image ? "AI illustration" : ""}${part.name}${part.blurb ?? ""}${specs}`.toLowerCase(),
    [part, specs]);
  const hit = !query || partHaystack(part).includes(query) || cardText.includes(query);
  return (
    <div
      className={highlight ? "part fc-highlight" : "part"}
      data-part-id={part.id}
      data-q={partHaystack(part)}
      hidden={!hit}
      ref={cardRef}
    >
      {part.image && !imgGone ? (
        <figure className="pfig">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc(part.image)}
            alt={`AI illustration of the ${part.name}`}
            loading="lazy"
            onError={() => setImgGone(true)}
          />
          <figcaption>AI illustration</figcaption>
        </figure>
      ) : null}
      <h4>{part.name}</h4>
      {part.blurb ? <p>{part.blurb}</p> : null}
      {specs ? <div className="specs">{specs}</div> : null}
    </div>
  );
}

export default function PartsCatalogue() {
  const dispatch = useDispatch<AppDispatch>();
  const query = useSelector((s: RootState) => s.catalog.query);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const groups = useMemo(groupParts, []);
  const q = query.trim().toLowerCase();

  /* robots.js rfFocusPart: the Forge Guide's part buttons and
     ?part=<id> deep links land here — set the search to the part's
     name (which unhides its group), highlight and scroll to it. */
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("part");
    if (!want) return;
    const part = parts.find((p) => p.id === want);
    if (!part) return;
    dispatch(setQuery(part.name));
    setHighlightId(part.id);
    const t = setTimeout(() => {
      cardRefs.current.get(part.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let shownTotal = 0;
  const rendered = groups.map((g) => {
    const visible = g.items.filter((p) => {
      const specs = partSpecsText(p.specs);
      const cardText = `${p.image ? "AI illustration" : ""}${p.name}${p.blurb ?? ""}${specs}`.toLowerCase();
      return !q || partHaystack(p).includes(q) || cardText.includes(q);
    });
    shownTotal += visible.length;
    return { g, any: visible.length > 0 };
  });

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          id="part-search"
          placeholder="Search parts, e.g. lidar, 12 V, ESP32"
          aria-label="Search parts"
          value={query}
          onChange={(e) => dispatch(setQuery(e.target.value))}
        />
      </div>
      <div id="parts-list">
        {rendered.map(({ g, any }) => (
          /* Groups fold to their name and count; a search or a deep
             link to one part opens the groups that hold a match. */
          <details className="parts-group fold" key={g.cls} hidden={!any}
            open={Boolean(q) || g.items.some((p) => p.id === highlightId)}>
            <summary><h3>{g.label} <span>({g.items.length})</span></h3></summary>
            <div className="part-list">
              {g.items.map((p) => (
                <PartCard
                  key={p.id}
                  part={p}
                  query={q}
                  highlight={highlightId === p.id}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(p.id, el);
                    else cardRefs.current.delete(p.id);
                  }}
                />
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="state-box" id="parts-empty" hidden={shownTotal > 0}>
        No parts match that search.
      </p>
    </>
  );
}
