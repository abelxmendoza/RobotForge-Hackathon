"use client";
/* Wrench's web pictures and shoppable finds.
 * - WebPics: the product pictures a fetched page states (a proposal
 *   to save a part shows them before you say yes).
 * - WebFindCards: one card per web search result, with its first
 *   picture, store and stated price; "Add to My Parts" reads that
 *   page and proposes it like a pasted link, so nothing is saved
 *   until you confirm. */
import type { WebFind } from "@/lib/webParts";

export function WebPics({ images }: { images: string[] }) {
  if (!images.length) return null;
  return (
    <div className="fc-pics" aria-label="Pictures from the page">
      {images.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" title="Open the picture">
          <img src={u} alt="Product picture from the page" loading="lazy" referrerPolicy="no-referrer"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
        </a>
      ))}
    </div>
  );
}

export function WebFindCards({ finds, onAsk }: { finds: WebFind[]; onAsk?: (text: string) => void }) {
  if (!finds.length) return null;
  return (
    <div className="fc-finds" aria-label="Parts found on the web">
      {finds.map((f) => (
        <div className="fc-find" key={f.url}>
          <a className="fc-find-pic" href={f.url} target="_blank" rel="noreferrer">
            {f.image
              ? <img src={f.image} alt={f.title} loading="lazy" referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement("span"), { className: "fc-find-none", textContent: "No picture" })); }} />
              : <span className="fc-find-none">No picture on this result</span>}
          </a>
          <div className="fc-find-body">
            <strong title={f.title}>{f.title}</strong>
            <span className="faint">{f.store}{f.price ? <> · <span className="fc-find-price">{f.price}</span></> : null}</span>
            {onAsk && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onAsk("Add this part to my parts " + f.url)}>
                Add to My Parts
              </button>
            )}
            <a className="btn btn-sm" href={f.url} target="_blank" rel="noreferrer">Open store page ↗</a>
          </div>
        </div>
      ))}
    </div>
  );
}
