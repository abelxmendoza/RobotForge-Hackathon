"use client";

/* The PARTS route of the photo intake (Wave 5): the capture was
 * classified as individual parts or a parts spread, not a whole
 * robot, so it is matched against the parts catalogue instead of
 * being identified as a robot. Matching is the deterministic local
 * token matcher in lib/intake.ts (the web mirror of the Spotter
 * dossier's kind-token guesses); an item with no match says so.
 * Saving files the find to the PARTS side of this browser's dex
 * (robotforge.dex.parts.v1, rendered under /robots → Parts) —
 * never as a robot sighting. */
import { useMemo, useState } from "react";
import { parts } from "@/lib/data";
import {
  buildPartsFind,
  inferAssembly,
  matchPartsToCatalog,
  savePartsFind,
} from "@/lib/intake";
import type { PhotoDraft } from "./model";

export default function PartsMatchCard({
  draft,
  photoThumb,
}: {
  draft: PhotoDraft;
  photoThumb?: string | null;
}) {
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const matches = useMemo(
    () => matchPartsToCatalog(draft.visible_parts ?? [], parts),
    [draft],
  );
  const inference = useMemo(() => inferAssembly(matches), [matches]);

  const onSave = () => {
    const entry = buildPartsFind(matches, inference, photoThumb ?? null);
    const next = savePartsFind(entry);
    setSavedCount(next.length);
    // Confirm only if the find is actually in the store.
    setConfirmed(next.some((e) => e.id === entry.id));
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="eyebrow">Parts — catalogue match</div>
      <p className="intro" style={{ marginTop: 0 }}>
        This capture was classified as <strong>parts, not a whole robot</strong>,
        so each visible item is matched against the site&rsquo;s parts
        catalogue by token overlap (a local match — the same kind-token
        method the Spotter dossiers use). An item with no match says so.
      </p>
      {matches.length ? (
        <ul className="items rows">
          {matches.map((m, i) => (
            <li key={i}>
              <span className="title">
                <strong>{m.label}</strong> ×{m.count}
              </span>{" "}
              {m.part ? (
                <>
                  → <span className="slotname">{m.part.id}</span>{" "}
                  <span className="faint">
                    ({m.part.name}) · match: {m.level} · {m.matchBasis}
                  </span>
                </>
              ) : (
                <span className="faint">
                  → no catalogue match · {m.matchBasis}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="intro">
          The draft listed no visible parts, so there is nothing to match.
        </p>
      )}
      {inference ? (
        <div className="callout">
          <span>
            <strong>Inference</strong> (from catalogue classes only, not an
            identification): {inference}
          </span>
        </div>
      ) : null}
      {confirmed ? (
        <p className="intro">
          <strong>Saved to this browser&rsquo;s parts finds.</strong> It
          renders under Robots → Parts, next to the catalogue — parts finds
          are stored only in this browser in v1.
          {savedCount !== null ? ` (${savedCount} saved here.)` : null}
        </p>
      ) : (
        <p>
          <button className="btn btn-sm" type="button" onClick={onSave}>
            Save this parts find (this browser)
          </button>
        </p>
      )}
    </div>
  );
}
