/* Parts sourcing: vendor SEARCH links, built from a part's name and
 * recorded specs. Abel's standing rule for this feature: search
 * links only — this module builds query URLs and nothing else.
 * Nothing here fetches, scrapes, or carries a price, a stock level
 * or an availability claim, and the UI copy says the same. */

export interface Vendor {
  id: string;
  label: string;
}

export const VENDORS: Vendor[] = [
  { id: "octopart", label: "Octopart" },
  { id: "digikey", label: "Digi-Key" },
  { id: "mcmaster", label: "McMaster-Carr" },
  { id: "amazon", label: "Amazon" },
  { id: "aliexpress", label: "AliExpress" },
];

const SEARCH_URL: Record<string, (q: string) => string> = {
  octopart: (q) => `https://octopart.com/search?q=${encodeURIComponent(q)}`,
  digikey: (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}`,
  mcmaster: (q) => `https://www.mcmaster.com/${encodeURIComponent(q)}/`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  aliexpress: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
};

export interface SourceLink {
  vendor: string;
  label: string;
  url: string;
}

/** Collapse a free-form query (name + spec fragments) to a clean
 *  search phrase: single spaces, no catalogue punctuation noise. */
export function cleanQuery(raw: string): string {
  return raw
    .replace(/×/g, "x")
    .replace(/[,;()[\]{}"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the vendor search links for one part. `query` is the full
 *  search phrase (callers compose name + the spec fragments worth
 *  searching on); it is used verbatim apart from whitespace cleanup. */
export function sourcingLinks(query: string): SourceLink[] {
  const q = cleanQuery(query);
  if (!q) return [];
  return VENDORS.map((v) => ({
    vendor: v.id,
    label: v.label,
    url: SEARCH_URL[v.id](q),
  }));
}

/* Spec fragments worth searching on, from a catalogue part's
 * recorded specs: the values a buyer would type (a voltage, a
 * capacity, a connector, a size in mm). Keys are read in a fixed
 * order so the query is stable; units the key already implies are
 * added back as plain text. */
const SPEC_KEYS: [string, string][] = [
  ["voltage_v", "V"],
  ["capacity_mah", "mAh"],
  ["connector", ""],
  ["diameter_mm", "mm"],
  ["size_mm", "mm"],
  ["kv", "KV"],
  ["teeth", "T"],
];

export function partSearchQuery(part: {
  name: string;
  specs?: Record<string, unknown>;
}): string {
  const bits: string[] = [part.name];
  const specs = part.specs ?? {};
  for (const [key, unit] of SPEC_KEYS) {
    const v = specs[key];
    if (typeof v === "number" && Number.isFinite(v)) bits.push(`${v}${unit}`);
    else if (typeof v === "string" && v.length <= 24) bits.push(v);
  }
  return cleanQuery(bits.join(" "));
}
