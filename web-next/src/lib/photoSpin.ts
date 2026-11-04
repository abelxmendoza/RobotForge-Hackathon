/* Photo spin: real photos taken while walking around a robot, played
 * back as a drag-to-turn view. Pure helpers, no DOM, so they test in
 * Node. The frames themselves are downscaled JPEG data URLs stored on
 * the Garage robot (GarageRobot.spin). */

export interface PhotoSpin {
  frames: string[];
  source: 'photos' | 'video';
  addedAt: string;
}

export const SPIN_MIN_FRAMES = 8;
export const SPIN_MAX_FRAMES = 36;
export const SPIN_VIDEO_FRAMES = 24;

/* Removing one photo from a robot's still-photo set: the set is the
 * record (GarageRobot.photoSet, with photo === photoSet[0]). Returns
 * the next set, or null when nothing is left — the caller then clears
 * photo, photoSet and photoAddedAt together so no orphan photo stays
 * behind. An out-of-range index changes nothing. */
export function removePhotoFromSet(photos: string[], index: number): string[] | null {
  if (index < 0 || index >= photos.length) return [...photos];
  const next = photos.filter((_, i) => i !== index);
  return next.length ? next : null;
}

/* Camera files are numbered (IMG_0001, IMG_0002 … IMG_0010): sort by
 * name with numbers compared as numbers, so 10 comes after 9. */
export function naturalOrder<T extends { name: string }>(files: T[]): T[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => coll.compare(a.name, b.name));
}

/* Too many photos: keep an even spread rather than the first N, so the
 * spin still goes all the way round. */
export function evenPick<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

/* Dragging: a full-width drag turns the robot once around. */
export function frameAfterDrag(start: number, dx: number, width: number, count: number): number {
  if (count <= 0) return 0;
  const step = Math.round((dx / Math.max(1, width)) * count);
  return (((start - step) % count) + count) % count;
}

export function stepFrame(i: number, by: number, count: number): number {
  if (count <= 0) return 0;
  return (((i + by) % count) + count) % count;
}
