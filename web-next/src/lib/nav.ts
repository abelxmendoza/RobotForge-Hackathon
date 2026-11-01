/* Tier-0 navigation commands for Wrench: "open X", "go to wiring",
 * "show the legged robots". Pure parser — the caller supplies the names
 * it can resolve (saved robots, Robodex robots, mobility classes) and
 * performs the actual routing. No state is touched here; navigation is
 * the one chat action that needs no preview because it changes nothing. */

export type NavAction =
  | { kind: 'page'; route: string; label: string }
  | { kind: 'dex-robot'; slug: string; name: string }
  | { kind: 'saved-robot'; id: string; name: string }
  | { kind: 'tab'; tab: string }
  | { kind: 'group'; cls: string; slug: string };

export interface NavContext {
  saved: { id: string; name: string }[];
  dex: { slug: string; name: string }[];
  groups: { cls: string; slug: string }[];
}

export const WORKSHOP_TABS = ['overview', 'build', 'wiring', 'specs', 'checks'] as const;

const PAGES: { match: string[]; route: string; label: string }[] = [
  { match: ['robodex', 'robots', 'robot index', 'catalogue of robots'], route: '/robots/', label: 'the Robodex' },
  { match: ['parts', 'parts catalogue', 'parts catalog', 'kit', 'components catalogue'], route: '/kit/', label: 'the parts catalogue' },
  { match: ['evidence'], route: '/evidence/', label: 'the Evidence page' },
  { match: ['demo'], route: '/demo/', label: 'the Demo' },
  { match: ['my parts', 'inventory', 'stock'], route: '/inventory/', label: 'My parts' },
  { match: ['workshop', 'my robots', 'garage', 'workspace'], route: '/garage/', label: 'the Workshop' },
  { match: ['home', 'landing', 'front page'], route: '/', label: 'the home page' },
];

const GROUP_WORDS: Record<string, string[]> = {
  wheeled: ['wheeled', 'wheel', 'wheels'],
  legged: ['legged', 'leg', 'legs', 'quadruped', 'quadrupeds'],
  aerial: ['aerial', 'flying', 'air', 'drone', 'drones'],
  tracked: ['tracked', 'track', 'tracks', 'tank'],
  marine: ['marine', 'water', 'boat', 'boats'],
  stationary: ['stationary', 'fixed', 'arm', 'arms'],
};

function cleanTarget(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+(?:page|tab|view|section)$/i, '')
    .replace(/[".!?]+$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase();
}

/* Returns a NavAction or null when the text is not a navigation command.
 * Resolution order matters: tabs and pages first (a robot is unlikely to
 * be named "wiring"), then Robodex groups, then saved robots (the user's
 * own robots win over catalogue entries of the same name), then dex. */
export function parseNavCommand(text: string, ctx: NavContext): NavAction | null {
  const m = text.trim().match(/^(?:open|show(?: me)?|go to|take me to|view)\s+(.+)$/i);
  if (!m) return null;
  /* "my parts" is the inventory page while bare "parts" is the catalogue,
   * so page phrases are matched once against the unstripped target
   * before cleanTarget removes a leading "my"/"the". */
  const rawTarget = m[1].trim().replace(/[".!?]+$/g, '').replace(/^["']|["']$/g, '').trim().toLowerCase();
  for (const p of PAGES) {
    if (p.match.includes(rawTarget)) return { kind: 'page', route: p.route, label: p.label };
  }
  const target = cleanTarget(m[1]);
  if (!target) return null;

  if ((WORKSHOP_TABS as readonly string[]).includes(target)) {
    return { kind: 'tab', tab: target };
  }
  for (const p of PAGES) {
    if (p.match.includes(target)) return { kind: 'page', route: p.route, label: p.label };
  }
  /* "wheeled robots" / "legged group" — a group word, optionally trailed
   * by robots/group/class. Match against the caller's class list so the
   * taxonomy stays defined in one place (MOBILITY_CLASSES). */
  const groupWord = target.replace(/\s+(?:robots?|group|class)$/i, '');
  for (const [key, words] of Object.entries(GROUP_WORDS)) {
    if (!words.includes(groupWord)) continue;
    const g = ctx.groups.find((x) => x.cls.toLowerCase().includes(key));
    if (g) return { kind: 'group', cls: g.cls, slug: g.slug };
  }
  const saved = ctx.saved.filter((r) => r.name.toLowerCase() === target);
  if (saved.length === 1) return { kind: 'saved-robot', id: saved[0].id, name: saved[0].name };
  const dex = ctx.dex.filter((r) => r.name.toLowerCase() === target);
  if (dex.length === 1) return { kind: 'dex-robot', slug: dex[0].slug, name: dex[0].name };
  return null;
}
