/* Verified part photos: the pure lookups behind every surface that
 * shows one (Workshop BOM tab, parts palette).
 *
 * A photo is shown only when the catalogue record carries a complete
 * web-gathered record — url, source page, credit, fetched-at, trust
 * state. Anything incomplete resolves to null and the caller renders
 * the honest placeholder instead. The catalogue's `image` field (AI
 * illustrations) is never consulted here, by construction: this
 * module reads `photo` and nothing else. */
import type { Part, PartPhoto } from "./types";
import type { BomLine } from "./bom";

export function verifiedPhoto(part: Part | undefined | null): PartPhoto | null {
  const ph = part?.photo;
  if (!ph) return null;
  if (ph.state !== "web_gathered") return null;
  if (!ph.url || !ph.source_page || !ph.credit || !ph.fetched_at) return null;
  if (ph.kind !== "photo" && ph.kind !== "render") return null;
  return ph;
}

/** The verified photo for a BOM line, via its catalogue part id.
 *  Kit lines and prop lines carry no catalogue id — they get null
 *  (placeholder), never a guessed match by name. */
export function photoForLine(
  line: BomLine,
  partsById: Map<string, Part>,
): PartPhoto | null {
  if (!line.partId) return null;
  return verifiedPhoto(partsById.get(line.partId));
}
