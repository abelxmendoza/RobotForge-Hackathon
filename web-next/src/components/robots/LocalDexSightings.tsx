"use client";

import { useEffect, useState } from "react";
import { loadSightings } from "@/lib/grouping";
import type { StoredDexSighting } from "@/lib/grouping";

/* Sightings saved in THIS browser (Forge photo runs -> "Add this
 * sighting to my dex"). Rendered client-side only: the data lives
 * in localStorage, so there is nothing to static-export. */
export default function LocalDexSightings() {
  const [saved, setSaved] = useState<StoredDexSighting[] | null>(null);

  useEffect(() => {
    setSaved(loadSightings());
  }, []);

  const groups = new Map<string, Map<string, StoredDexSighting[]>>();
  for (const entry of saved ?? []) {
    const fam = entry.grouping.familyName;
    const label = entry.grouping.variantLabel;
    if (!groups.has(fam)) groups.set(fam, new Map());
    const byVariant = groups.get(fam) as Map<string, StoredDexSighting[]>;
    byVariant.set(label, [...(byVariant.get(label) ?? []), entry]);
  }

  return (
    <div className="card">
      <div className="eyebrow">Saved in this browser</div>
      <p className="sub">
        Sightings you add are stored only in this browser in v1; the shared
        dex sync is the live endpoint&rsquo;s job once deployed.
      </p>
      {saved === null ? (
        <p className="faint">Checking this browser&rsquo;s dex…</p>
      ) : saved.length === 0 ? (
        <p className="faint">
          No sightings saved in this browser yet — add one from a photo run
          in the Forge.
        </p>
      ) : (
        [...groups.entries()].map(([familyName, byVariant]) => (
          <div key={familyName} style={{ marginBottom: 12 }}>
            <h4 style={{ margin: "10px 0 4px" }}>{familyName}</h4>
            {[...byVariant.entries()].map(([label, entries]) => (
              <div key={label} style={{ marginLeft: 12, marginBottom: 8 }}>
                <div>
                  <strong>{label}</strong>{" "}
                  <span className="faint">({entries.length} saved)</span>
                </div>
                <ul className="items rows">
                  {entries.map((e) => (
                    <li key={e.sighting.id}>
                      <div className="spot-head">
                        {e.sighting.photo ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            className="spot-thumb"
                            src={e.sighting.photo}
                            alt={`Your photo of ${e.sighting.identity}`}
                            loading="lazy"
                          />
                        ) : null}
                        <div>
                          <strong>{e.sighting.identity}</strong>{" "}
                          <span className="spotting-badge">USER SPOTTING</span>
                          {e.sighting.spotted_at ? (
                            <span className="faint"> — {e.sighting.spotted_at}</span>
                          ) : null}{" "}
                          <span className="faint">[{e.grouping.outcome}]</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
