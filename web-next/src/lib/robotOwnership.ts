/* Which robots are the owner's: the ONE rule, for the Robodex and for
 * Wrench (Abel, 2026-11-04). A robot is yours when it is in your
 * Workshop (rf.garage.v1). Catalog robots, sightings and Omega1 until
 * you add a copy are records you can read, not robots you own, and
 * they can't be deleted. Pure: callers pass in the store contents. */
import type { GarageRobot } from './garage';

export const workshopDraftKey = (id: string) => `robotforge.workshop.draft.${id}`;

/* A record the Robodex knows that is not in the Workshop. */
export interface RobotRecord { name: string; tab: string }

/* How far a name may stretch. A question or a command that says "robot"
 * can be loose ("Spot" finds "Boston Dynamics Spot"). "delete X" needs a
 * whole word, and a bare "remove X" the exact name, because "remove arm"
 * usually means a part. */
export type NameMatch = 'exact' | 'word' | 'loose';

export type OwnershipAsk =
  | { kind: 'delete'; name: string; explicit: boolean; match: NameMatch }
  | { kind: 'whose'; name: string };

export type Ownership =
  | { kind: 'mine'; robots: GarageRobot[] }
  | { kind: 'archived'; robots: GarageRobot[] }
  | { kind: 'record'; record: RobotRecord }
  | { kind: 'omega1' }
  | { kind: 'unknown' };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, '').trim();

/* "it" and "this robot" mean the robot open in the Workshop. */
export function isCurrentRobotName(name: string): boolean {
  return /^(?:it|this|this one|this robot)$/i.test(name.trim());
}

/* Only a whole command matches: "remove the battery from Omega1" is an
 * assembly edit, so a name holding from/on/to/in is never a robot here
 * unless the "from" names a robots list. */
export function parseOwnershipAsk(text: string): OwnershipAsk | null {
  const q = text.trim().replace(/[.!?]+$/, '');
  const whose = q.match(/^(?:is|are)\s+(.+?)\s+(?:mine|my robots?|one of my robots|in my workshop)$/i)
    ?? q.match(/^do i own\s+(.+)$/i)
    ?? q.match(/^whose robot is\s+(.+)$/i);
  if (whose) return { kind: 'whose', name: clean(whose[1]) };
  const del = q.match(/^(?:please\s+)?(?:delete|remove|get rid of)\s+(.+)$/i);
  if (!del) return null;
  let rest = del[1];
  const list = /\s+from\s+(?:my robots|my workshop|the workshop|the robodex|robodex|my garage)$/i;
  let explicit = list.test(rest);
  rest = rest.replace(list, '');
  if (/^(?:my robot|the robot|robot)\s+/i.test(rest)) explicit = true;
  rest = rest.replace(/^(?:my robot|the robot|robot|my|the)\s+/i, '');
  const name = clean(rest);
  if (!name || /\s(?:from|on|to|in|of)\s/i.test(name)) return null;
  const match: NameMatch = explicit ? 'loose' : /^delete/i.test(del[0].replace(/^please\s+/i, '')) ? 'word' : 'exact';
  return { kind: 'delete', name, explicit, match };
}

function matching<T extends { name: string }>(name: string, items: T[], match: NameMatch): T[] {
  const n = norm(name);
  if (!n) return [];
  const exact = items.filter((x) => norm(x.name) === n);
  if (exact.length || match === 'exact' || n.length < 3) return exact;
  const word = items.filter((x) => ` ${norm(x.name)} `.includes(` ${n} `));
  if (word.length || match === 'word') return word;
  return items.filter((x) => norm(x.name).includes(n));
}

/* Workshop first: a robot you brought in from the catalog is yours,
 * even though the catalog keeps its own record of the same name. */
export function classifyRobot(name: string, input: {
  active: GarageRobot[];
  archived: GarageRobot[];
  records: RobotRecord[];
  match: NameMatch;
}): Ownership {
  const robots = matching(name, input.active, input.match);
  if (robots.length) return { kind: 'mine', robots };
  const archived = matching(name, input.archived, input.match);
  if (archived.length) return { kind: 'archived', robots: archived };
  const records = matching(name, input.records, input.match);
  if (records.length) return { kind: 'record', record: records[0] };
  return norm(name) === 'omega1' || norm(name) === 'omega 1' ? { kind: 'omega1' } : { kind: 'unknown' };
}

const versions = (r: GarageRobot) => `${r.versions.length} version${r.versions.length === 1 ? '' : 's'}`;

export function ownershipAnswer(name: string, o: Ownership): string {
  switch (o.kind) {
    case 'mine':
      return `Yes. ${o.robots[0].name} is yours: it's in your Workshop with ${versions(o.robots[0])}, and it shows under My robots in the Robodex.`;
    case 'archived':
      return `${o.robots[0].name} is yours, but it's archived, so it isn't listed under My robots. You can restore it or delete it from Archived robots in the Workshop.`;
    case 'record':
      return `No. ${o.record.name} isn't yours: it's a ${o.record.tab} record in the Robodex. You can bring a copy into your Workshop, and that copy would be yours.`;
    case 'omega1':
      return `No, not right now. Omega1 is RobotForge's own robot and it isn't in your Workshop, so it isn't listed under My robots. Ask me about Omega1 and I'll give you a link to add a copy.`;
    default:
      return `I can't find “${name}” in your Workshop or the Robodex, so it isn't one of your robots.`;
  }
}

/* Why a delete was refused, or null when it can go ahead. */
export function deleteRefusal(name: string, o: Ownership): string | null {
  switch (o.kind) {
    case 'mine':
    case 'archived':
      return o.robots.length > 1
        ? `You have ${o.robots.length} robots called “${o.robots[0].name}”, so I won't guess. Delete the one you mean in the Workshop.`
        : null;
    case 'record':
      return `I can't delete ${o.record.name}: it isn't yours. It's a ${o.record.tab} record in the Robodex, and you can only delete your own robots. Nothing changed.`;
    case 'omega1':
      return `There's nothing to delete. Omega1 is RobotForge's own robot and it isn't in your Workshop, so it isn't one of your robots. Nothing changed.`;
    default:
      return `I can't find “${name}” in your Workshop, so nothing was deleted.`;
  }
}

export function deleteWarning(r: GarageRobot): string {
  return `Delete ${r.name} and its ${versions(r)} for good? This can't be undone. If you saved it to your account, press Save afterwards to remove it there too.`;
}

export function ownedRobotsText(active: GarageRobot[]): string {
  if (!active.length) return "You don't have any robots of your own yet. Everything in the Robodex is a record you can read. Bring one into your Workshop and it's yours.";
  return `Your robots, from your Workshop:\n${active.map((r) => `${r.name} — ${versions(r)}`).join('\n')}\nEverything else in the Robodex is a record, not yours.`;
}
