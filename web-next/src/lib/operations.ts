/* Shared operation boundary: local commands and future model tools use this
 * same validator. No arbitrary object paths, code, network or hardware access. */
import { FIELD_GROUPS, getPath, setPath, type GarageRobot } from './garage';

export interface EditOperation {
  kind: 'set-field'; robotId: string; expectedVersionId: string;
  path: string; value: unknown;
}
export interface Preview {
  operation: EditOperation; before: unknown; after: unknown;
}
const fields = FIELD_GROUPS.flatMap(g => g.fields);

export function previewOperation(robots: GarageRobot[], input: unknown): Preview {
  if (!input || typeof input !== 'object') throw new Error('Expected an operation object.');
  const op = input as EditOperation;
  if (op.kind !== 'set-field') throw new Error('Unsupported operation.');
  const robot = robots.find(r => r.id === op.robotId);
  const latest = robot?.versions.at(-1);
  if (!latest || latest.id !== op.expectedVersionId) throw new Error('Robot changed since this proposal. Ask again for a fresh preview.');
  const field = fields.find(f => f.path === op.path);
  if (!field) throw new Error('That field is not editable through chat.');
  if (field.kind === 'number' || field.kind === 'integer') {
    if (typeof op.value !== 'number' || !Number.isFinite(op.value) || op.value < 0 ||
        (op.path !== 'ground_clearance_m' && op.value === 0) ||
        (field.kind === 'integer' && !Number.isInteger(op.value))) {
      throw new Error('Use a finite positive number (whole number for counts); clearance may be zero.');
    }
  } else if (typeof op.value !== 'string' || !op.value.trim() || op.value.length > 200) {
    throw new Error('Use a nonempty text value of at most 200 characters.');
  }
  if (field.options && !field.options.includes(String(op.value))) throw new Error('Choose one of: ' + field.options.join(', '));
  return { operation: { kind: 'set-field', robotId: op.robotId, expectedVersionId: op.expectedVersionId, path: field.path, value: op.value }, before: getPath(latest.spec, field.path), after: op.value };
}

export function applyOperation(robots: GarageRobot[], input: unknown, versionId: string, createdAt: string): GarageRobot[] {
  const { operation: op } = previewOperation(robots, input);
  return robots.map(r => {
    if (r.id !== op.robotId) return r;
    const spec = setPath(r.versions.at(-1)!.spec, op.path, op.value);
    return { ...r, name: spec.name || r.name, versions: [...r.versions, {
      id: versionId, createdAt, source: 'edit' as const, label: 'Chat: ' + op.path,
      note: 'Chat operation; user applied preview. Browser checks are a subset, not hardware validation.', spec,
    }] };
  });
}

export type Command = { kind: 'list' } | { kind: 'help' } | { kind: 'undo' } |
  { kind: 'edit'; robotName: string; path: string; rawValue: string };
/* Explicit grammar avoids silently interpreting a question as a mutation.
 * Schema paths use SI units, matching exported RobotForge specs. */
export function parseCommand(text: string): Command | null {
  const q = text.trim();
  if (/^(?:list|show) my robots[.!]?$/i.test(q)) return { kind: 'list' };
  if (/^(?:operations|what can you do|help with operations)[?!.]?$/i.test(q)) return { kind: 'help' };
  if (/^undo(?: last(?: chat)?(?: change| operation)?)?[.!]?$/i.test(q)) return { kind: 'undo' };
  const m = q.match(/^set "([^"\n]+)" ([a-z_][a-z_0-9.]*) to (.+)$/i);
  return m ? { kind: 'edit', robotName: m[1], path: m[2], rawValue: m[3].trim() } : null;
}

export function proposeCommand(robots: GarageRobot[], command: Extract<Command, {kind: 'edit'}>): Preview {
  const matches = robots.filter(r => r.name.toLowerCase() === command.robotName.toLowerCase());
  if (matches.length !== 1) throw new Error(matches.length ? 'More than one robot has that name. Rename one in My robots first.' : 'No saved robot has that name. Try “list my robots”.');
  const robot = matches[0];
  const field = fields.find(f => f.path === command.path);
  const numeric = field?.kind === 'number' || field?.kind === 'integer';
  const raw = command.rawValue;
  // Number() accepts hexadecimal and empty strings; the command grammar does not.
  if (numeric && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new Error('Use a number in spec units: metres, kilograms, volts or mAh. Example: 0.12 for 120 mm.');
  return previewOperation(robots, { kind: 'set-field', robotId: robot.id, expectedVersionId: robot.versions.at(-1)?.id, path: command.path, value: numeric ? Number(raw) : raw.replace(/^"(.*)"$/, '$1') });
}

/* Undo appends a restoration version; it never deletes history and refuses
 * to overwrite a newer edit by the UI or another chat operation. */
export function undoOperation(robots: GarageRobot[], robotId: string, appliedVersionId: string, versionId: string, createdAt: string): GarageRobot[] {
  const robot = robots.find(r => r.id === robotId);
  if (!robot || robot.versions.at(-1)?.id !== appliedVersionId || robot.versions.length < 2) throw new Error('There is a newer change. Restore a version in My robots instead.');
  const spec = JSON.parse(JSON.stringify(robot.versions.at(-2)!.spec));
  return robots.map(r => r.id !== robotId ? r : { ...r, name: spec.name || r.name, versions: [...r.versions, { id: versionId, createdAt, source: 'edit' as const, label: 'Undo chat change', note: 'Restored the spec before ' + appliedVersionId, spec }] });
}
