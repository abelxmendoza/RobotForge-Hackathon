import type { GarageRobot } from './garage';
import { activeRecords, archiveRecord, deleteArchivedRecord, deleteRecord, replaceRecord, restoreRecord } from './lifecycle';

export type RobotLifecycleResult = { ok: true } | { ok: false; error: string };
type ReadRobots = () => GarageRobot[];
type WriteRobots = (robots: GarageRobot[]) => string | null;

export function readActiveRobots(read: ReadRobots): GarageRobot[] {
  return activeRecords(read());
}

function commit(operation: () => GarageRobot[], write: WriteRobots): RobotLifecycleResult {
  try {
    const error = write(operation());
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'This robot could not be updated.',
    };
  }
}

export function archiveRobotInStore(
  read: ReadRobots,
  write: WriteRobots,
  id: string,
  expected: string,
  archivedAt: string,
): RobotLifecycleResult {
  return commit(() => archiveRecord(read(), id, expected, archivedAt), write);
}

export function restoreRobotInStore(
  read: ReadRobots,
  write: WriteRobots,
  id: string,
  expected: string,
): RobotLifecycleResult {
  return commit(() => restoreRecord(read(), id, expected), write);
}

export function deleteArchivedRobotInStore(
  read: ReadRobots,
  write: WriteRobots,
  id: string,
  expected: string,
): RobotLifecycleResult {
  return commit(() => deleteArchivedRecord(read(), id, expected), write);
}

/* Direct permanent delete from the active list (the Garage confirms
 * inline first). Works for active and archived robots alike. */
export function deleteRobotInStore(
  read: ReadRobots,
  write: WriteRobots,
  id: string,
  expected: string,
): RobotLifecycleResult {
  return commit(() => deleteRecord(read(), id, expected), write);
}

export function replaceRobotInStore(
  read: ReadRobots,
  write: WriteRobots,
  id: string,
  expected: string,
  next: GarageRobot,
): RobotLifecycleResult {
  return commit(() => replaceRecord(read(), id, expected, next), write);
}
