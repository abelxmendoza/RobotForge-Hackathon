/* Shop links for parts — the ONE place that knows the stores.
 *
 * Abel's model (2026-11-04): every part carries links to shops, the
 * links are saved WITH the part (catalogue record, library item, web
 * find), and there are two kinds:
 *
 *   (a) "search" — a vendor SEARCH url built deterministically from
 *       the part's name (e.g. DigiKey's results page for the name).
 *       Constructed, stable, no affiliate tags.
 *   (b) "found" — a REAL product-page url, found via search (the web
 *       knowledge loop's page, classified here by vendor domain).
 *       `via` names how it was found ('firecrawl' for the loop's
 *       Worker-backed fetches). A found link displays FIRST.
 *
 * Links only, ever: this module never carries a price, a stock level
 * or an availability claim, and neither may anything built on it —
 * Abel's standing sourcing rule. The endpoint can reuse
 * PREFERRED_STORES later; nothing here talks to the endpoint.
 *
 * Zero imports, no DOM: a node-driven pin test compiles this module
 * standalone, same convention as lib/webParts.ts. The URL patterns
 * below are the same ones baked into catalog/parts.json's `shops`
 * fields — keep them in step. */

export interface ShopLink {
  vendor: string; // registry id ('digikey'), or 'web' for an unlisted store
  label: string; // display name ('Digi-Key')
  url: string;
  kind: 'search' | 'found';
  via?: string; // found links only: how the page was found
}

export interface ShopVendor {
  id: string;
  label: string;
  domains: string[];
  search: (query: string) => string;
}

const enc = encodeURIComponent;

export const SHOP_VENDORS: ShopVendor[] = [
  { id: 'digikey', label: 'Digi-Key', domains: ['digikey.com'], search: (q) => `https://www.digikey.com/en/products/result?keywords=${enc(q)}` },
  { id: 'mouser', label: 'Mouser', domains: ['mouser.com'], search: (q) => `https://www.mouser.com/c/?q=${enc(q)}` },
  { id: 'adafruit', label: 'Adafruit', domains: ['adafruit.com'], search: (q) => `https://www.adafruit.com/search?q=${enc(q)}` },
  { id: 'sparkfun', label: 'SparkFun', domains: ['sparkfun.com'], search: (q) => `https://www.sparkfun.com/search/results?term=${enc(q)}` },
  { id: 'pololu', label: 'Pololu', domains: ['pololu.com'], search: (q) => `https://www.pololu.com/search?query=${enc(q)}` },
  { id: 'robotshop', label: 'RobotShop', domains: ['robotshop.com'], search: (q) => `https://www.robotshop.com/search?q=${enc(q)}` },
  { id: 'amazon', label: 'Amazon', domains: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.co.jp'], search: (q) => `https://www.amazon.com/s?k=${enc(q)}` },
  { id: 'mcmaster', label: 'McMaster-Carr', domains: ['mcmaster.com'], search: (q) => `https://www.mcmaster.com/${enc(q)}/` },
  { id: 'servocity', label: 'ServoCity', domains: ['servocity.com'], search: (q) => `https://www.servocity.com/search.php?search_query=${enc(q)}` },
  { id: 'gobilda', label: 'goBILDA', domains: ['gobilda.com'], search: (q) => `https://www.gobilda.com/search?q=${enc(q)}` },
];

export function shopVendor(id: string): ShopVendor | undefined {
  return SHOP_VENDORS.find((v) => v.id === id);
}

/* The registered vendor a page url belongs to, by hostname, or null
 * when the store is not in the registry. */
export function vendorForUrl(url: string): ShopVendor | null {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  for (const v of SHOP_VENDORS) {
    if (v.domains.some((d) => host === d || host.endsWith('.' + d))) return v;
  }
  return null;
}

/* Preferred stores per category, in display order. Keys are the
 * catalogue's part_class vocabulary (web finds classify into the
 * same vocabulary); 'tools' covers the web loop's tool records.
 * Anything unlisted falls back to DEFAULT_PREFERRED_STORES. */
export const PREFERRED_STORES: Record<string, string[]> = {
  power: ['digikey', 'mouser', 'amazon'],
  cables_connectors: ['digikey', 'mouser', 'adafruit'],
  drivers: ['pololu', 'digikey', 'adafruit'],
  microcontrollers: ['adafruit', 'sparkfun', 'digikey'],
  sbc: ['adafruit', 'amazon', 'digikey'],
  memory_storage: ['amazon', 'digikey', 'mouser'],
  comms: ['adafruit', 'sparkfun', 'digikey'],
  cameras_sensors: ['adafruit', 'sparkfun', 'digikey'],
  materials: ['amazon', 'pololu', 'mcmaster'],
  safety_protection: ['digikey', 'mcmaster', 'amazon'],
  custom_boards: ['digikey', 'mouser', 'sparkfun'],
  actuators: ['pololu', 'servocity', 'gobilda'],
  wheels: ['pololu', 'gobilda', 'robotshop'],
  propulsion_air: ['robotshop', 'amazon', 'gobilda'],
  flight_control: ['robotshop', 'amazon', 'digikey'],
  end_effectors: ['servocity', 'gobilda', 'robotshop'],
  structure: ['mcmaster', 'gobilda', 'amazon'],
  tools: ['mcmaster', 'amazon', 'digikey'],
};
export const DEFAULT_PREFERRED_STORES: string[] = ['digikey', 'mouser', 'amazon'];

export function preferredStoresFor(category: string): string[] {
  return PREFERRED_STORES[category] || DEFAULT_PREFERRED_STORES;
}

/* One constructed (kind 'search') link, or null for an unknown
 * vendor or an empty query. */
export function searchShopLink(vendorId: string, query: string): ShopLink | null {
  const v = shopVendor(vendorId);
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!v || !q) return null;
  return { vendor: v.id, label: v.label, url: v.search(q), kind: 'search' };
}

/* A real product page as a (kind 'found') link: classified by vendor
 * domain when the store is registered, else labelled by hostname. */
export function foundShopLink(url: string, via: string): ShopLink | null {
  if (!/^https?:\/\//i.test(String(url || ''))) return null;
  const v = vendorForUrl(url);
  if (v) return { vendor: v.id, label: v.label, url, kind: 'found', via };
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  return { vendor: 'web', label: host, url, kind: 'found', via };
}

/* The links a catalogue record carries (catalog/parts.json `shops`,
 * plus the found-page slot `found_url` / `found_via` / `found_store`
 * when a search has filled it): the found page first, then the
 * record's constructed search links in their stored order. */
export function cataloguePartLinks(part: {
  shops?: { vendor: string; url: string }[];
  found_url?: string | null;
  found_via?: string | null;
  found_store?: string | null;
}): ShopLink[] {
  const out: ShopLink[] = [];
  if (part.found_url && /^https?:\/\//i.test(part.found_url)) {
    const found = foundShopLink(part.found_url, part.found_via || 'search');
    if (found) out.push(part.found_store ? { ...found, label: part.found_store } : found);
  }
  for (const s of part.shops || []) {
    if (!s || !/^https?:\/\//i.test(String(s.url || ''))) continue;
    if (out.some((l) => l.vendor === s.vendor)) continue;
    const v = shopVendor(s.vendor);
    out.push({ vendor: s.vendor, label: v ? v.label : s.vendor, url: s.url, kind: 'search' });
  }
  return out;
}

/* The links saved WITH a web-found part (Wrench/web knowledge loop):
 * the source page it was found on, classified by vendor domain and
 * marked via 'firecrawl' (the loop's fetches ride the Worker's
 * Firecrawl-backed /web route), then constructed search links for
 * the OTHER preferred stores of the part's category. */
export function webPartShopLinks(part: {
  name: string;
  category: string;
  sourceUrl: string;
}): ShopLink[] {
  const out: ShopLink[] = [];
  const found = foundShopLink(part.sourceUrl, 'firecrawl');
  if (found) out.push(found);
  for (const id of preferredStoresFor(part.category)) {
    if (out.some((l) => l.vendor === id)) continue;
    const link = searchShopLink(id, part.name);
    if (link) out.push(link);
  }
  return out;
}
