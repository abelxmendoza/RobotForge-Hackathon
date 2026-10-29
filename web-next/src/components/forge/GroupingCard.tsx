"use client";

/* Robodex grouping block for a live photo draft: which family and
 * variant this sighting belongs to, computed in the browser with
 * src/lib/grouping.ts over the synced families plus any families
 * implied by sightings already saved in this browser. Saving is
 * per-browser localStorage in v1 (see grouping.ts for the stated
 * persistence limit) — the shared dex sync is the live endpoint's
 * job once deployed. */
import { useEffect, useMemo, useState } from "react";
import { families } from "@/lib/data";
import {
  buildStoredSighting,
  describeSignature,
  groupSpotting,
  loadSightings,
  saveSighting,
  signatureFromDraft,
  withLocalFamilies,
} from "@/lib/grouping";
import type { GroupingResult } from "@/lib/grouping";
import type { PhotoDraft } from "./model";

const OUTCOME_WORDS: Record<GroupingResult["outcome"], string> = {
  "existing-variant": "matches an existing variant",
  "new-variant": "a new variant",
  "new-family": "a new family",
};

export default function GroupingCard({
  draft,
  photoThumb,
}: {
  draft: PhotoDraft;
  /* Small (<=320px) data-URL thumbnail of the captured photo, when
   * the draft came from one in this session. Rendered next to the
   * proposed family/variant and stored with the sighting so it can
   * render on /robots; the full photo itself is never stored. */
  photoThumb?: string | null;
}) {
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const signature = useMemo(() => signatureFromDraft(draft), [draft]);
  const [grouping, setGrouping] = useState<GroupingResult>(() =>
    groupSpotting(draft.identity_guess || "", signature, families),
  );

  // Local sightings only exist client-side; fold them in after mount.
  useEffect(() => {
    const local = loadSightings();
    setSavedCount(local.length);
    setGrouping(
      groupSpotting(
        draft.identity_guess || "",
        signature,
        withLocalFamilies(families, local),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outcomeText =
    grouping.outcome === "new-variant" && grouping.family
      ? `a new variant under ${grouping.family.name}`
      : OUTCOME_WORDS[grouping.outcome];

  const onSave = () => {
    const entry = buildStoredSighting(draft, grouping, photoThumb ?? null);
    const next = saveSighting(entry);
    setSavedCount(next.length);
    // Confirm inline only if the sighting is actually in the store.
    setConfirmed(next.some((e) => e.sighting.id === entry.sighting.id));
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="eyebrow">Robodex grouping</div>
      <div className="spot-head">
        {photoThumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className="spot-thumb"
            src={photoThumb}
            alt="The photo this sighting was drafted from"
          />
        ) : null}
        <div className="spot-proposal">
          <p className="intro" style={{ marginTop: 0 }}>
            {grouping.family ? (
              <>
                Family: <strong>{grouping.family.name}</strong> — this sighting{" "}
                <strong>{outcomeText}</strong>.
              </>
            ) : (
              <>
                <strong>Not in the dex yet — this would start a new family</strong>{" "}
                ({outcomeText}).
              </>
            )}
          </p>
          <table className="kv">
            <tbody>
              <tr>
                <th>Variant for this signature</th>
                <td>{grouping.variantLabel}</td>
              </tr>
              <tr>
                <th>Signature</th>
                <td>{describeSignature(signature)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {grouping.family && grouping.siblingVariantLabels.length ? (
        <p className="faint">
          Also in the dex: {grouping.siblingVariantLabels.join(" · ")}
        </p>
      ) : null}
      {confirmed ? (
        <p className="intro">
          <strong>Saved to this browser&rsquo;s dex.</strong> Sightings you
          add are stored only in this browser in v1; the shared dex sync is
          the live endpoint&rsquo;s job once deployed.
          {savedCount !== null ? ` (${savedCount} saved here.)` : null}
        </p>
      ) : (
        <p>
          <button className="btn btn-sm" type="button" onClick={onSave}>
            Add this sighting to my dex (this browser)
          </button>
        </p>
      )}
    </div>
  );
}
