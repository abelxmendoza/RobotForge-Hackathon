/** Pure, storage-agnostic lifecycle operations for browser-owned records. */

export interface LifecycleRecord {
  id: string;
  archivedAt?: string;
}

export class LifecycleConflictError extends Error {
  constructor(message = 'This record changed. Review the latest version and try again.') {
    super(message);
    this.name = 'LifecycleConflictError';
  }
}

function validArchiveAt(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

export function activeRecords<T extends LifecycleRecord>(records: readonly T[]): T[] {
  return records.filter((record) => !validArchiveAt(record.archivedAt));
}

export function archivedRecords<T extends LifecycleRecord>(records: readonly T[]): T[] {
  return records.filter((record) => validArchiveAt(record.archivedAt));
}

export function activeSelection<T extends LifecycleRecord>(records: readonly T[], selected: string | null): string | null {
  const active = activeRecords(records);
  return selected && active.some((record) => record.id === selected) ? selected : active[0]?.id ?? null;
}

export function recordSnapshot(record: LifecycleRecord): string {
  return JSON.stringify(record);
}

function currentRecord<T extends LifecycleRecord>(records: readonly T[], id: string, expected: string): T {
  const record = records.find((candidate) => candidate.id === id);
  if (!record || recordSnapshot(record) !== expected) throw new LifecycleConflictError();
  return record;
}

export function archiveRecord<T extends LifecycleRecord>(
  records: readonly T[], id: string, expected: string, archivedAt: string,
): T[] {
  if (!validArchiveAt(archivedAt)) throw new RangeError('Archive time must be an ISO timestamp.');
  const target = currentRecord(records, id, expected);
  return records.map((record) => (record === target ? { ...record, archivedAt } : record)) as T[];
}

export function restoreRecord<T extends LifecycleRecord>(records: readonly T[], id: string, expected: string): T[] {
  const target = currentRecord(records, id, expected);
  return records.map((record) => {
    if (record !== target) return record;
    const { archivedAt: _archivedAt, ...active } = record;
    void _archivedAt;
    return active as T;
  });
}

/* Permanent delete. Only an archived record can be deleted, so every
 * delete has already passed through Archive (which asks first), and a
 * record changed elsewhere since it was read is refused. */
export function deleteArchivedRecord<T extends LifecycleRecord>(records: readonly T[], id: string, expected: string): T[] {
  const target = currentRecord(records, id, expected);
  if (!validArchiveAt(target.archivedAt)) {
    throw new LifecycleConflictError('Archive this robot before deleting it.');
  }
  return records.filter((record) => record !== target) as T[];
}

/* Swap one record for a replacement with the same id (for example a
 * fresh copy rebuilt from its records), guarded the same way. */
export function replaceRecord<T extends LifecycleRecord>(records: readonly T[], id: string, expected: string, next: T): T[] {
  if (next.id !== id) throw new RangeError('A replacement must keep the same id.');
  const target = currentRecord(records, id, expected);
  return records.map((record) => (record === target ? next : record)) as T[];
}
