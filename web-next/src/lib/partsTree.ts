/* My Parts as a tree: robot (or shared shelf / tools) → subsystem →
 * part → the parts mounted on it. Only the last level is stored
 * (InventoryPart.parent_id); robot and subsystem are worked out from
 * robot_id and category, so every saved shelf is a tree already.
 *
 * Rules: one parent at most, never a loop, a child lives on its
 * parent's robot, deleting a parent promotes its children one level,
 * and quantities are never added together. Nesting never changes a
 * part's Real / Sim only label. */
import { partSection, type InventoryPart } from './inventory';

export const SUBSYSTEMS = [
  { id: 'drive', label: 'Drive', categories: ['motor', 'motor_driver', 'wheel', 'servo'] },
  { id: 'power', label: 'Power', categories: ['battery', 'power'] },
  { id: 'compute', label: 'Compute', categories: ['controller', 'computer', 'radio'] },
  { id: 'sensing', label: 'Sensing', categories: ['sensor'] },
  { id: 'frame', label: 'Frame and wiring', categories: ['frame', 'cable', 'other'] },
] as const;
export type SubsystemId = (typeof SUBSYSTEMS)[number]['id'] | 'tools';

export function subsystemOf(p: Pick<InventoryPart, 'category' | 'section'>): SubsystemId {
  if (partSection(p) === 'tools') return 'tools';
  return SUBSYSTEMS.find((s) => (s.categories as readonly string[]).includes(p.category))?.id ?? 'frame';
}
export const SUBSYSTEM_LABEL: Record<SubsystemId, string> = {
  drive: 'Drive', power: 'Power', compute: 'Compute', sensing: 'Sensing', frame: 'Frame and wiring', tools: 'Tools',
};

/* The parent a part actually hangs under: a missing or looping
 * parent_id (an old import, a deleted part) reads as no parent. */
export function effectiveParent(parts: InventoryPart[], p: InventoryPart): string | null {
  const byId = new Map(parts.map((x) => [x.id, x]));
  const seen = new Set<string>([p.id]);
  let cur = p.parent_id ? byId.get(p.parent_id) : undefined;
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return p.parent_id && byId.has(p.parent_id) ? p.parent_id : null;
}

export function childrenOf(parts: InventoryPart[], id: string): InventoryPart[] {
  return parts.filter((x) => x.id !== id && effectiveParent(parts, x) === id);
}

export function descendantIds(parts: InventoryPart[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const c of childrenOf(parts, pid)) if (!out.has(c.id)) { out.add(c.id); walk(c.id); }
  };
  walk(id);
  return out;
}

/* Parts `childId` may be put under: not itself, not one of its own
 * descendants, and in the same section (a tool never holds a part). */
export function allowedParents(parts: InventoryPart[], childId: string): InventoryPart[] {
  const child = parts.find((p) => p.id === childId);
  if (!child) return [];
  const banned = descendantIds(parts, childId);
  banned.add(childId);
  return parts.filter((p) => !banned.has(p.id) && partSection(p) === partSection(child));
}

/* Set or clear a parent. The child (and everything under it) moves to
 * the parent's robot. Throws on a loop. */
export function setParent(parts: InventoryPart[], childId: string, parentId: string | null): InventoryPart[] {
  if (parentId && !allowedParents(parts, childId).some((p) => p.id === parentId)) {
    throw new Error('That would put a part inside itself.');
  }
  const parent = parentId ? parts.find((p) => p.id === parentId) : undefined;
  const moving = descendantIds(parts, childId);
  moving.add(childId);
  return parts.map((p) => {
    if (p.id === childId) return { ...p, parent_id: parentId, ...(parent ? { robot_id: parent.robot_id ?? null } : {}) };
    if (parent && moving.has(p.id)) return { ...p, robot_id: parent.robot_id ?? null };
    return p;
  });
}

/* A part moved to another robot takes its children with it. */
export function setRobot(parts: InventoryPart[], id: string, robotId: string | null): InventoryPart[] {
  const moving = descendantIds(parts, id);
  moving.add(id);
  const target = parts.find((p) => p.id === id);
  const parent = target ? effectiveParent(parts, target) : null;
  return parts.map((p) => {
    if (!moving.has(p.id)) return p;
    // Leaving the parent's robot means leaving the parent.
    if (p.id === id && parent) return { ...p, robot_id: robotId, parent_id: null };
    return { ...p, robot_id: robotId };
  });
}

/* Remove a part; its children move up to its own parent. */
export function removePart(parts: InventoryPart[], id: string): { parts: InventoryPart[]; promoted: number } {
  const gone = parts.find((p) => p.id === id);
  if (!gone) return { parts, promoted: 0 };
  const up = effectiveParent(parts, gone);
  const kids = new Set(childrenOf(parts, id).map((c) => c.id));
  return {
    parts: parts.filter((p) => p.id !== id).map((p) => (kids.has(p.id) ? { ...p, parent_id: up } : p)),
    promoted: kids.size,
  };
}

/* ---- the columns view ---- */

export interface Shelf { id: string; label: string; robotId: string | null; tools: boolean }

export function shelvesFor(robots: { id: string; name: string }[]): Shelf[] {
  return [
    ...robots.map((r) => ({ id: 'robot:' + r.id, label: r.name, robotId: r.id, tools: false })),
    { id: 'shared', label: 'Shared shelf', robotId: null, tools: false },
    { id: 'tools', label: 'Tools', robotId: null, tools: true },
  ];
}

function onShelf(p: InventoryPart, shelf: Shelf, robotIds: Set<string>): boolean {
  const isTool = partSection(p) === 'tools';
  if (shelf.tools) return isTool;
  if (isTool) return false;
  if (shelf.robotId) return p.robot_id === shelf.robotId;
  // Shared: unassigned, or pointing at a robot this browser doesn't have.
  return !p.robot_id || !robotIds.has(p.robot_id);
}

export function partsOnShelf(parts: InventoryPart[], shelf: Shelf, robots: { id: string }[]): InventoryPart[] {
  const ids = new Set(robots.map((r) => r.id));
  return parts.filter((p) => onShelf(p, shelf, ids));
}

/* Top-level parts (no parent on this shelf) of one subsystem. */
export function rootParts(shelfParts: InventoryPart[], all: InventoryPart[], sub: SubsystemId): InventoryPart[] {
  const here = new Set(shelfParts.map((p) => p.id));
  return shelfParts.filter((p) => {
    const parent = effectiveParent(all, p);
    return subsystemOf(p) === sub && !(parent && here.has(parent));
  });
}

/* Everything under a part, at any depth, for counts. */
export function countUnder(parts: InventoryPart[], id: string): number {
  return descendantIds(parts, id).size;
}

/* Keep a filtered list's matches visible in the tree: add back every
 * ancestor of a match, marked so the view can dim it. */
export function withAncestors(all: InventoryPart[], matches: InventoryPart[]): { parts: InventoryPart[]; context: Set<string> } {
  const keep = new Map(matches.map((p) => [p.id, p]));
  const context = new Set<string>();
  const byId = new Map(all.map((p) => [p.id, p]));
  for (const m of matches) {
    let pid = effectiveParent(all, m);
    while (pid && !keep.has(pid)) {
      const parent = byId.get(pid);
      if (!parent) break;
      keep.set(pid, parent);
      context.add(pid);
      pid = effectiveParent(all, parent);
    }
  }
  return { parts: all.filter((p) => keep.has(p.id)), context };
}
