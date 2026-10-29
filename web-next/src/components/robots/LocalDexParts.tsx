"use client";

import { useEffect, useState } from "react";
import { loadPartsFinds } from "@/lib/intake";
import type { StoredPartsFind } from "@/lib/intake";

/* Parts finds saved in THIS browser (Forge photo runs classified
 * as PARTS -> "Save this parts find"). The parts side of the
 * per-browser dex: rendered client-side only, under the catalogue,
 * because the data lives in localStorage (robotforge.dex.parts.v1)
 * and there is nothing to static-export. */
export default function LocalDexParts() {
  const [saved, setSaved] = useState<StoredPartsFind[] | null>(null);

  useEffect(() => {
    setSaved(loadPartsFinds());
  }, []);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="eyebrow">Parts finds saved in this browser</div>
      <p className="sub">
        Photos the Forge classified as parts (not a whole robot) and matched
        against the catalogue above. Stored only in this browser in v1.
      </p>
      {saved === null ? (
        <p className="faint">Checking this browser&rsquo;s parts finds…</p>
      ) : saved.length === 0 ? (
        <p className="faint">
          No parts finds saved in this browser yet — photograph a parts
          spread in the Forge and save the match from its card.
        </p>
      ) : (
        <ul className="items rows">
          {saved.map((find) => (
            <li key={find.id}>
              <div className="spot-head">
                {find.photo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="spot-thumb"
                    src={find.photo}
                    alt="The parts photo this find was matched from"
                    loading="lazy"
                  />
                ) : null}
                <div>
                  <strong>
                    {find.items.reduce((a, it) => a + it.count, 0)} items
                  </strong>{" "}
                  <span className="spotting-badge">PARTS FIND</span>
                  {find.found_at ? (
                    <span className="faint"> — {find.found_at}</span>
                  ) : null}
                  <ul className="items rows" style={{ marginTop: 6 }}>
                    {find.items.map((it, i) => (
                      <li key={i}>
                        {it.label} ×{it.count}{" "}
                        {it.matched_part_id ? (
                          <span className="faint">
                            → {it.matched_part_id} ({it.catalog_name}) ·
                            match: {it.level}
                          </span>
                        ) : (
                          <span className="faint">→ no catalogue match</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {find.inference ? (
                    <p className="faint" style={{ marginTop: 4 }}>
                      Inference: {find.inference}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
