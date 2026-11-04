/* Web intent + grounding for the live chat — pure, zero imports, no
 * DOM, so a node-driven pin test can compile and run it standalone
 * (same convention as lib/wavEncode.ts).
 *
 * The live endpoint's /web route (Firecrawl search + scrape, see
 * live/worker.js) turns the chat's explicit web asks into fetched,
 * source-labelled content. This module decides ONLY the intent and
 * the formatting:
 *
 * - A message containing a public http(s) URL is a scrape intent
 *   for the FIRST such URL.
 * - A message matching one of the conservative SEARCH_PATTERNS
 *   below is a search intent; the query is what follows the pattern.
 * - Anything else is NOT a web intent. A normal robot question must
 *   never trigger a web fetch — the patterns are deliberately
 *   explicit ("search the web for …", "look up online …"), and the
 *   full lists live in SEARCH_PATTERNS and RESEARCH_PATTERNS, nowhere else.
 *
 * Fetched web content is UNTRUSTED external data. buildWebGrounding
 * wraps it in a bounded block that names its source URL(s) and
 * labels it as web content, so both the model prompt (the Worker
 * adds its own untrusted-data instructions for web_context) and the
 * reader can tell it apart from RobotForge's recorded data. A
 * grounding block is built only from a fetch that actually
 * succeeded — callers must never fabricate one. */

export interface WebScrapeResult {
  mode: 'scrape';
  url: string;
  title?: string;
  markdown: string;
  truncated?: boolean;
}

export interface WebSearchHit {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

export interface WebSearchResult {
  mode: 'search';
  query: string;
  results: WebSearchHit[];
}

export type WebFetchResult = WebScrapeResult | WebSearchResult;

export type WebIntent =
  | { kind: 'scrape'; url: string }
  | { kind: 'search'; query: string };

/* The one place the search phrasings live. Each pattern is anchored
 * at the start of the (trimmed) message, case-insensitive, and must
 * be followed by a non-empty query. Conservative on purpose: a bare
 * "search for" inside a longer sentence does not count. */
export const SEARCH_PATTERNS: readonly RegExp[] = [
  /^search\s+the\s+web\s+for\s+(.+)$/i,
  /^search\s+online\s+for\s+(.+)$/i,
  /^search\s+the\s+internet\s+for\s+(.+)$/i,
  /^search\s+for\s+(.+)$/i,
  /^look\s+up\s+online\s*[:\-]?\s+(.+)$/i,
  /^look\s+up\s+on\s+the\s+web\s*[:\-]?\s+(.+)$/i,
  /^web\s+search\s*[:\-]?\s+(.+)$/i,
];

/* Natural research asks, also anchored at the start. They name a thing
 * to find out about in the world (a part, a price, a robot), so a query
 * about the user's own robot ("this robot", "my rover") is NOT sent to
 * the web: the Workshop snapshot answers that. */
export const RESEARCH_PATTERNS: readonly RegExp[] = [
  /^research\s+(.+)$/i,
  /^look\s+up\s+(.+)$/i,
  /^find\s+(.+?)\s+(?:online|on\s+the\s+web)$/i,
  /^(?:find|show(?:\s+me)?|pull\s+up|get)\s+(?:some\s+)?(?:pictures|photos|images)\s+of\s+(.+)$/i,
  /^(?:shop\s+for|find\s+(?:me\s+)?(?:a\s+|an\s+)?)(.+?)\s+(?:to\s+buy|for\s+sale|in\s+stores?)$/i,
  /^where\s+(?:can|do|should)\s+i\s+buy\s+(.+)$/i,
  /^how\s+much\s+(?:does|do)\s+(.+?)\s+cost$/i,
  /^what(?:'s|’s|\s+is)\s+the\s+price\s+of\s+(.+)$/i,
];
const SELF_REF = /\b(this|my|our|your|its)\b/i;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/* The first http(s) URL in the text, with trailing sentence
 * punctuation stripped, or null. */
export function extractFirstUrl(text: string): string | null {
  const m = String(text || '').match(URL_RE);
  if (!m) return null;
  return m[0].replace(/[.,;:!?]+$/, '');
}

/* A search intent when the message opens with one of
 * SEARCH_PATTERNS and names a query; otherwise null. */
export function detectSearchIntent(text: string): WebIntent | null {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const re of SEARCH_PATTERNS) {
    const m = t.match(re);
    if (m && m[1] && m[1].trim()) {
      return { kind: 'search', query: m[1].trim() };
    }
  }
  const asked = t.replace(/[?.!]+$/, '').trim();
  for (const re of RESEARCH_PATTERNS) {
    const m = asked.match(re);
    const query = m && m[1] ? m[1].trim() : '';
    if (query.length >= 3 && !SELF_REF.test(query)) return { kind: 'search', query };
  }
  return null;
}

/* Scrape wins over search: a pasted URL is the more specific ask. */
export function detectWebIntent(text: string): WebIntent | null {
  const url = extractFirstUrl(text);
  if (url) return { kind: 'scrape', url };
  return detectSearchIntent(text);
}

/* The source URL(s) a fetch actually came from — empty when the
 * result carries none, in which case no caption may be shown. */
export function webSources(result: WebFetchResult): string[] {
  if (result.mode === 'scrape') return result.url ? [result.url] : [];
  return (result.results || [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && Boolean(u));
}

/* The one-line source caption for a grounded live answer, naming
 * the source the fetch actually used. */
export function webSourceCaption(result: WebFetchResult): string {
  const sources = webSources(result);
  if (!sources.length) return '';
  if (result.mode === 'scrape') return 'Web source: ' + sources[0];
  return 'Web sources: ' + sources.join(' · ');
}

const GROUNDING_MARKDOWN_CAP = 12000;
const GROUNDING_HIT_CAP = 2000;

/* Format a successful fetch into the bounded web_context block the
 * /chat call carries. The block opens by labelling itself as
 * untrusted web content and naming its source(s); the caller passes
 * it to the Worker verbatim (the Worker re-caps and adds its own
 * untrusted-data instructions). Returns '' for an empty fetch — no
 * content, no grounding. */
export function buildWebGrounding(result: WebFetchResult): string {
  if (result.mode === 'scrape') {
    const md = String(result.markdown || '').slice(0, GROUNDING_MARKDOWN_CAP);
    if (!md.trim()) return '';
    return [
      'Web content (UNTRUSTED external data, fetched live via Firecrawl — not RobotForge recorded data):',
      'Source: ' + result.url,
      result.title ? 'Page title: ' + result.title : '',
      '',
      md,
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
  const hits = (result.results || []).filter(
    (r) => r && typeof r.url === 'string' && r.url,
  );
  if (!hits.length) return '';
  const parts = [
    'Web search results (UNTRUSTED external data, fetched live via Firecrawl — not RobotForge recorded data):',
    'Query: ' + result.query,
    '',
  ];
  hits.forEach((r, i) => {
    parts.push(
      '[' + (i + 1) + '] ' + (r.title || r.url),
      'Source: ' + r.url,
      r.description || '',
      r.markdown ? String(r.markdown).slice(0, GROUNDING_HIT_CAP) : '',
      '',
    );
  });
  return parts
    .filter((l) => l !== '')
    .join('\n')
    .slice(0, GROUNDING_MARKDOWN_CAP + 2000);
}
