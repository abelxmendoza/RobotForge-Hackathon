import { sourcingLinks } from "@/lib/sourcing";
import type { ShopLink } from "@/lib/shopLinks";

/* Vendor search links for one part (lib/sourcing.ts), or — when the
 * part's catalogue record carries its own saved shop links
 * (lib/shopLinks.ts) — those: a found product page first, then the
 * record's store searches. Search links only — the site never shows
 * a price, a stock level or an availability claim for a part, and
 * the sections that render this say so in their own copy. Links
 * open the vendor's own search for the part's name and recorded
 * specs. */
export default function SourcingLinks({ query, links }: { query: string; links?: ShopLink[] }) {
  const found = links?.find((l) => l.kind === "found");
  const searches = links ? links.filter((l) => l.kind === "search") : sourcingLinks(query);
  if (!found && !searches.length) return null;
  return (
    <p className="prov" style={{ marginTop: 8 }}>
      {found ? (
        <span>
          <strong>Found:</strong>{" "}
          <a href={found.url} target="_blank" rel="noreferrer">
            {found.label}
          </a>
          {searches.length ? " · " : ""}
        </span>
      ) : null}
      {searches.length ? (
        <span>
          <strong>Search:</strong>{" "}
          {searches.map((l, i) => (
            <span key={l.vendor}>
              {i > 0 ? " · " : ""}
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
