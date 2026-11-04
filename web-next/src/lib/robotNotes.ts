/* What Wrench knows about a robot: short notes the owner asked Wrench to
 * remember ("remember that the left motor stalls") or saved from a
 * web-sourced answer, each with where it came from. They live in this
 * browser (demo mode keeps its own copy through the store layer), are
 * shown on the robot's Overview where they can be deleted, and ride
 * along with every question about that robot so later answers use them.
 * A note is the owner's record, never a measured or catalogue fact. */
import { readStore, writeStore } from './store';

export const ROBOT_NOTES_KEY = 'rf.robotNotes.v1';
export const NOTE_MAX_CHARS = 400;
export const NOTES_IN_CONTEXT = 8;

export interface RobotNote {
  id: string;
  robotId: string;
  text: string;
  /* 'you' for a note the owner dictated; otherwise the web source caption. */
  source: string;
  addedAt: string;
}

export function notesFor(all: RobotNote[], robotId: string): RobotNote[] {
  return all.filter((n) => n.robotId === robotId).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function cleanNoteText(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > NOTE_MAX_CHARS ? t.slice(0, NOTE_MAX_CHARS - 1).trimEnd() + '…' : t;
}

/* Pure: the list with one note added (duplicates of the same text on the
 * same robot are kept once), or null when there is nothing to save. */
export function withNote(all: RobotNote[], robotId: string, text: string, source: string, now: Date, id: string): RobotNote[] | null {
  const clean = cleanNoteText(text);
  if (!robotId || !clean) return null;
  if (all.some((n) => n.robotId === robotId && n.text.toLowerCase() === clean.toLowerCase())) return all;
  return [...all, { id, robotId, text: clean, source: cleanNoteText(source).slice(0, 160) || 'you', addedAt: now.toISOString() }];
}

export function addRobotNote(robotId: string, text: string, source = 'you'): string | null {
  const next = withNote(readStore<RobotNote[]>(ROBOT_NOTES_KEY, []), robotId, text, source, new Date(),
    'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  if (!next) return 'There was nothing to save.';
  return writeStore(ROBOT_NOTES_KEY, next);
}

export function removeRobotNote(id: string): string | null {
  return writeStore(ROBOT_NOTES_KEY, readStore<RobotNote[]>(ROBOT_NOTES_KEY, []).filter((n) => n.id !== id));
}

export function forgetRobotNotes(robotId: string): string | null {
  return writeStore(ROBOT_NOTES_KEY, readStore<RobotNote[]>(ROBOT_NOTES_KEY, []).filter((n) => n.robotId !== robotId));
}

/* The notes as context lines for a question (newest first, capped). */
export function noteContextLines(notes: RobotNote[]): string[] {
  return notes.slice(0, NOTES_IN_CONTEXT).map((n) =>
    ('Owner note' + (n.source && n.source !== 'you' ? ' (from ' + n.source + ')' : '') + ': ' + n.text).slice(0, 160));
}

/* "remember that …" / "note: …" → the text to remember, else null. */
export function parseRememberCommand(q: string): string | null {
  const m = String(q || '').trim().match(/^(?:wrench,?\s+)?(?:remember(?:\s+that)?|note(?:\s+that)?|make a note(?:\s+that)?)\s*[:,-]?\s+(.+)$/i);
  if (!m) return null;
  const text = m[1].trim().replace(/^that\s+/i, '');
  return text.length >= 3 ? text : null;
}
