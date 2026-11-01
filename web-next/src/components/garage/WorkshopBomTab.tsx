"use client";

import { useMemo } from "react";
import Link from "next/link";
import { parts, simReadyProps } from "@/lib/data";
import type { Part, SimReadyPropEntry } from "@/lib/types";
import { useBuildList } from "@/lib/buildList";
import { useStore } from "@/lib/store";
import { buildListToBomLines } from "@/lib/palette";
import { bomToCsv, type BomLine } from "@/lib/bom";
import { photoForLine } from "@/lib/partPhoto";
import {
  bomTotals, formatMoney, pricesByLineKey, type LinePrice,
} from "@/lib/workshopBom";
import PartPhoto from "@/components/parts/PartPhoto";
import SourcingLinks from "@/components/robots/SourcingLinks";

/* The Workshop's BOM tab: the current build's bill of materials,
 * live from the shared build list (rf.build.v1) — the same lines
 * the BOM wizard assembles from it, with verified part photos and
 * the build-plan price model's states where records exist.
 *
 * Demo-safe by construction: everything here is local data (the
 * catalogue, the build list, any locally stored price records).
 * Nothing calls the Worker. Prices are shown only when a record
 * exists — user-entered, sourced, or web-gathered — and the tab
 * says which lines carry none. */

const partsById = new Map<string, Part>(parts.map((p) => [p.id, p]));
const propsById = new Map<string, SimReadyPropEntry>(
  simReadyProps.map((p) => [p.id, p]),
);

/* The build-plan store's key, read defensively (lib/workshopBom):
 * that feature is not part of this build, so its records are used
 * when present and their absence is a stated state, not an error. */
const BUILDPLAN_KEY = "rf.buildplan.v1";

function PriceCell({ price, qty }: { price: LinePrice | undefined; qty: number }) {
  if (!price) {
    return <span className="faint">no estimate recorded</span>;
  }
  const total = formatMoney(price.amount * qty, price.currency);
  if (price.kind === "user_entered") {
    return (
      <span className="price-badge user" title="A price you entered yourself.">
        Your price: {total}
      </span>
    );
  }
  if (price.kind === "sourced") {
    return (
      <span
        className="price-badge sourced"
        title={`Sourced estimate from ${price.supplier}, fetched ${price.fetchedAt}. Shipping, tax and stock are not included.`}
      >
        Estimate: {total} · {price.supplier}
      </span>
    );
  }
  return (
    <span
      className="price-badge gathered"
      title={`Web-gathered by Muse from the supplier page, fetched ${price.fetchedAt}. Verification: ${price.verification.replace(/_/g, " ")}. Shipping, tax and stock are not included.`}
    >
      Web-gathered estimate: {total} · {price.verification.replace(/_/g, " ")}
    </span>
  );
}

export default function WorkshopBomTab() {
  const [entries] = useBuildList();
  const [planStore] = useStore<unknown>(BUILDPLAN_KEY, null);
  const lines: BomLine[] = useMemo(
    () => buildListToBomLines(entries, partsById, propsById),
    [entries],
  );
  const prices = useMemo(() => pricesByLineKey(planStore), [planStore]);
  const totals = useMemo(() => bomTotals(lines, prices), [lines, prices]);

  const downloadCsv = () => {
    const blob = new Blob([bomToCsv(lines)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robotforge-workshop-bom.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!lines.length) {
    return (
      <section className="ws-pane" aria-label="Bill of materials">
        <div className="ws-empty">
          <p>
            <strong>Your build list is empty, so there is no BOM yet.</strong>{" "}
            Add parts from the Kit page&apos;s parts palette or ask Wrench in
            chat to add them — every line lands here, priced or not, with its
            sourcing links.
          </p>
          <p>
            <Link className="btn btn-sm" href="/kit/">
              Open the Kit stage →
            </Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="ws-pane" aria-label="Bill of materials">
      <div className="ws-bom-head">
        <p className="sub" style={{ margin: 0 }}>
          {lines.length} line{lines.length === 1 ? "" : "s"},{" "}
          {lines.reduce((s, l) => s + l.qty, 0)} items — live from your build
          list. Photos are verified manufacturer/supplier pictures,
          web-gathered with their source attached; a part without one keeps
          its placeholder rather than borrowing an illustration.
        </p>
        <p style={{ margin: 0 }}>
          <button type="button" className="btn btn-sm" onClick={downloadCsv}>
            Download CSV
          </button>{" "}
          <Link className="btn btn-sm" href="/bom/">
            Open the full BOM wizard →
          </Link>
        </p>
      </div>

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Search it</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td className="ws-bom-photo">
                  <PartPhoto photo={photoForLine(l, partsById)} name={l.name} />
                </td>
                <td>
                  {l.name}
                  {l.note ? <span className="faint"> — {l.note}</span> : null}
                  <br />
                  <span className="faint">{l.sourceLabel}</span>
                </td>
                <td className="num">{l.qty}</td>
                <td>
                  <PriceCell price={prices.get(l.key)} qty={l.qty} />
                </td>
                <td>
                  <SourcingLinks query={l.searchQuery} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals.pricedLines > 0 ? (
        <p className="sub" style={{ marginTop: 12 }}>
          {[...totals.byCurrency.entries()].map(([cur, sum]) => (
            <span key={cur}>
              Estimated total: <strong>{formatMoney(sum, cur)}</strong>
              {totals.unverifiedByCurrency.has(cur) ? (
                <>
                  {" "}— of which{" "}
                  {formatMoney(totals.unverifiedByCurrency.get(cur)!, cur)}{" "}
                  rests on unverified web-gathered data
                </>
              ) : null}
              .{" "}
            </span>
          ))}
          {totals.unpricedLines > 0
            ? `${totals.unpricedLines} line${totals.unpricedLines === 1 ? " has" : "s have"} no price record and are excluded. `
            : null}
          Shipping, tax and stock are never included in an estimate.
        </p>
      ) : (
        <p className="sub" style={{ marginTop: 12 }}>
          No price estimates are recorded for this build yet. RobotForge
          never guesses a price: an estimate appears here only when you
          enter one, or when a sourced or web-gathered record exists for
          the part.
        </p>
      )}
    </section>
  );
}
