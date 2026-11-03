import { FIELD_GROUPS, getPath, setPath, type Spec } from './garage';
/* Pure routing helpers: the selected identity is authoritative; names are a
 * compatibility fallback only when unambiguous. Never pick the newest robot. */
export function intakeTarget<T extends { id: string; name: string; archivedAt?: string }>(robots: T[], context: { robotId?: string; robotName: string } | null): T | null {
  if (!context) return null;
  const active = robots.filter((robot) => !robot.archivedAt);
  if (context.robotId) {
    const robot = active.find((r) => r.id === context.robotId);
    if (!robot) throw new Error('That robot is no longer active. Select a robot and attach the file again.');
    return robot;
  }
  const matches = active.filter((r) => r.name.toLowerCase() === context.robotName.toLowerCase());
  if (matches.length > 1) throw new Error('Please select one robot before attaching this file.');
  return matches[0] ?? null;
}

export function conceptRequest(text: string): 'new' | 'regenerate' | null {
  const t = text.trim();
  if (/[?]/.test(t) || /^(how|can|what|why|when)\b/i.test(t) || /\b(photo|picture|scan|mesh)\b/i.test(t)) return null;
  if (/^(regenerate|generate again|try again|iterate)\b/i.test(t)) return 'regenerate';
  return /^(please\s+)?(generate|create|design|build|make me)\b/i.test(t) && /\b(robot|rover|drone|arm|multirotor)\b/i.test(t) ? 'new' : null;
}

export function friendlyEdit(text: string): { path: string; value: number } | null {
  const t = text.trim().replace(/[.!]$/, '');
  const number = '(\\d+(?:\\.\\d+)?)';
  const patterns: [RegExp, string, (n: number, unit: string) => number][] = [
    [new RegExp(`^(?:my robot |it )?(?:weighs|mass is|set (?:the )?mass to) ${number}\\s*(kg|g)$`, 'i'), 'mass_kg', (n, u) => u.toLowerCase() === 'g' ? n / 1000 : n],
    [new RegExp(`^(?:make|set|change) (?:the )?wheels?(?: diameter)?(?: to)? ${number}\\s*(mm|cm|m)$`, 'i'), 'wheel.diameter_m', length],
    ...(['length', 'width', 'height'] as const).map((field): [RegExp, string, typeof length] => [new RegExp(`^(?:set|make|change) (?:the )?${field}(?: to)? ${number}\\s*(mm|cm|m)$`, 'i'), `${field}_m`, length]),
    [new RegExp(`^(?:set|change) (?:the )?battery(?: capacity)?(?: to)? ${number}\\s*(mAh|Ah)$`, 'i'), 'battery.capacity_mah', (n, u) => u.toLowerCase() === 'ah' ? n * 1000 : n],
  ];
  for (const [pattern, path, convert] of patterns) {
    const match = pattern.exec(t);
    if (match && Number(match[1]) > 0) return { path, value: convert(Number(match[1]), match[2]) };
  }
  return null;
}
function length(n: number, unit: string): number { return n / (unit.toLowerCase() === 'mm' ? 1000 : unit.toLowerCase() === 'cm' ? 100 : 1); }

// Photo inference fills gaps; it cannot replace a user's recorded values.
export function mergePhotoDraft(known: Spec, inferred: Spec, previousEstimates: string[] = []): {spec: Spec; estimatedPaths: string[]} {
  let spec = {...inferred,...known};
  const estimatedPaths = new Set(previousEstimates);
  for (const field of FIELD_GROUPS.flatMap((group) => group.fields)) {
    const oldValue = getPath(known,field.path), newValue = getPath(inferred,field.path);
    if ((oldValue == null || oldValue === '') && newValue != null) {
      spec = setPath(spec,field.path,newValue);
      if (field.kind === 'number' || field.kind === 'integer') estimatedPaths.add(field.path);
    }
  }
  return {spec,estimatedPaths:[...estimatedPaths]};
}

// Only an explicit command may mutate a generated concept locally.
export function modificationRequest(text: string): boolean {
  return !/[?]/.test(text) && !/\b(don't|dont|do not|never|without|not)\b/i.test(text)
    && /^(please\s+)?(add|make|swap|replace|remove|change|set)\b/i.test(text.trim());
}
