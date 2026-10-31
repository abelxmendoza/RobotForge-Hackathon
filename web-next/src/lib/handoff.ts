/* Wrench, the app-wide chat: its name, and the file hand-off that lets
 * any page's chat send a photo, parts list, spec file or scan into the
 * Workspace's existing ingestion pipeline.
 *
 * The file never leaves the browser here. It is kept in memory for one
 * client-side navigation to /forge/, where the Workspace takes it once
 * and runs the same flow its own attach button would. */
export const ASSISTANT_NAME = 'Wrench';

export type HandoffKind = 'photo' | 'doc' | 'spec' | 'scan';

export interface Handoff {
  kind: HandoffKind;
  file: File;
  text: string;
}

/* One accept list for every chat surface. */
export const HANDOFF_ACCEPT = 'image/*,.json,application/json,.txt,.md,.csv,text/plain,.ply';

/* Which pipeline a file belongs to, from its type and extension. */
export function handoffKind(file: File): HandoffKind | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'photo';
  if (name.endsWith('.ply')) return 'scan';
  if (name.endsWith('.json') || file.type === 'application/json') return 'spec';
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith('text/')) return 'doc';
  return null;
}

export const HANDOFF_LABEL: Record<HandoffKind, string> = {
  photo: 'Photo',
  doc: 'Parts list',
  spec: 'Spec file',
  scan: 'Scan (.ply)',
};

let pending: Handoff | null = null;

export function setHandoff(h: Handoff): void {
  pending = h;
}

/* Returns the waiting file once, then forgets it. */
export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  return h;
}
