import { sourcingLinks } from "@/lib/sourcing";

/* Vendor search links for one part (lib/sourcing.ts). Search links
 * only — the site never shows a price, a stock level or an
 * availability claim for a part, and the sections that render this
 * say so in their own copy. Links open the vendor's own search for
 * the part's name and recorded specs. */
export default function SourcingLinks({ query }: { query: string }) {
  const links = sourcingLinks(query);
  if (!links.length) return null;
  return (
    <p className="prov" style={{ marginTop: 8 }}>
      <span>
        <strong>Search:</strong>{" "}
        {links.map((l, i) => (
          <span key={l.vendor}>
            {i > 0 ? " · " : ""}
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          </span>
        ))}
      </span>
    </p>
  );
}
