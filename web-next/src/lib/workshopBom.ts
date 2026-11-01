/* Price-estimate states for the Workshop BOM tab.
 *
 * The price model belongs to the build-plan work (Forge Engine §2/§8):
 * a line's price is either absent, user-entered, a sourced estimate
 * (supplier + link + fetched-at), or a web-gathered estimate (Muse
 * extraction with its receipt + verification state). That store is
 * NOT part of this build, so this module reads it defensively: it
 * looks for per-line records under the build-plan store's shape and
 * renders exactly what it finds — and when it finds nothing, the
 * tab says no estimates are recorded. It never invents a figure,
 * and a record it cannot parse is treated as absent, not repaired.
 *
 * Shapes accepted (all fields validated before use):
 *   { kind: "user_entered", amount: number, currency?: string }
 *   { kind: "sourced", amount, currency?, supplier, source_url, fetched_at }
 *   { kind: "web_gathered", amount, currency?, source_url, fetched_at,
 *     verification: "web_gathered" | "cross_checked" | "confirmed" }
 */
import type { BomLine } from "./bom";

export type LinePrice =
  | { kind: "user_entered"; amount: number; currency: string }
  | {
      kind: "sourced";
      amount: number;
      currency: string;
      supplier: string;
      sourceUrl: string;
      fetchedAt: string;
    }
  | {
      kind: "web_gathered";
      amount: number;
      currency: string;
      sourceUrl: string;
      fetchedAt: string;
      verification: "web_gathered" | "cross_checked" | "confirmed";
    };

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseLinePrice(raw: unknown): LinePrice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.amount)) return null;
  const currency = isStr(r.currency) ? (r.currency as string) : "USD";
  if (r.kind === "user_entered") {
    return { kind: "user_entered", amount: r.amount, currency };
  }
  if (r.kind === "sourced" && isStr(r.supplier) && isStr(r.source_url) && isStr(r.fetched_at)) {
    return {
      kind: "sourced",
      amount: r.amount,
      currency,
      supplier: r.supplier as string,
      sourceUrl: r.source_url as string,
      fetchedAt: r.fetched_at as string,
    };
  }
  if (
    r.kind === "web_gathered" &&
    isStr(r.source_url) &&
    isStr(r.fetched_at) &&
    (r.verification === "web_gathered" ||
      r.verification === "cross_checked" ||
      r.verification === "confirmed")
  ) {
    return {
      kind: "web_gathered",
      amount: r.amount,
      currency,
      sourceUrl: r.source_url as string,
      fetchedAt: r.fetched_at as string,
      verification: r.verification,
    };
  }
  return null;
}

/** Per-line prices from a build-plan-shaped store object, keyed by
 *  BomLine key. Accepts the store being absent or malformed. */
export function pricesByLineKey(store: unknown): Map<string, LinePrice> {
  const out = new Map<string, LinePrice>();
  if (!store || typeof store !== "object") return out;
  const lines = (store as Record<string, unknown>).lines;
  if (!lines || typeof lines !== "object") return out;
  for (const [key, raw] of Object.entries(lines as Record<string, unknown>)) {
    const rec =
      raw && typeof raw === "object"
        ? ((raw as Record<string, unknown>).price_estimate ?? raw)
        : raw;
    const price = parseLinePrice(rec);
    if (price) out.set(key, price);
  }
  return out;
}

export interface BomTotals {
  /** Sum of priced lines (line amount × qty), one currency at a
   *  time — mixed currencies are never added together. */
  byCurrency: Map<string, number>;
  /** Of the priced total, how much rests on UNVERIFIED web-gathered
   *  data (verification still "web_gathered"), per currency. */
  unverifiedByCurrency: Map<string, number>;
  pricedLines: number;
  unpricedLines: number;
}

export function bomTotals(
  lines: BomLine[],
  prices: Map<string, LinePrice>,
): BomTotals {
  const byCurrency = new Map<string, number>();
  const unverifiedByCurrency = new Map<string, number>();
  let pricedLines = 0;
  for (const line of lines) {
    const p = prices.get(line.key);
    if (!p) continue;
    pricedLines += 1;
    const sum = p.amount * line.qty;
    byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + sum);
    if (p.kind === "web_gathered" && p.verification === "web_gathered") {
      unverifiedByCurrency.set(
        p.currency,
        (unverifiedByCurrency.get(p.currency) ?? 0) + sum,
      );
    }
  }
  return {
    byCurrency,
    unverifiedByCurrency,
    pricedLines,
    unpricedLines: lines.length - pricedLines,
  };
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency === "USD" ? "$" : currency + " "}${amount.toFixed(2)}`;
}
