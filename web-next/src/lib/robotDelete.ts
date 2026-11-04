/* Deleting one of your robots: the ONE path, shared by the Workshop,
 * the Robodex card and Wrench. Reads fresh, refuses if the robot changed
 * since it was shown, then drops what only that robot used: scans, notes,
 * the editor draft and its Robodex filing. */
import { GARAGE_KEY, type GarageRobot } from './garage';
import { garageKey, loadDexOverrides, saveDexOverrides } from './dexOverrides';
import { recordSnapshot } from './lifecycle';
import { deleteRobotInStore, type RobotLifecycleResult } from './robotLifecycleRepository';
import { forgetRobotNotes } from './robotNotes';
import { workshopDraftKey } from './robotOwnership';
import { forgetRobotScans } from './scanStore';
import { readStore, writeStore } from './store';

export function deleteOwnedRobot(robot: GarageRobot): RobotLifecycleResult {
  const result = deleteRobotInStore(
    () => readStore<GarageRobot[]>(GARAGE_KEY, []),
    (next) => writeStore(GARAGE_KEY, next),
    robot.id, recordSnapshot(robot),
  );
  if (!result.ok) return result;
  void forgetRobotScans(robot.id).catch(() => undefined);
  forgetRobotNotes(robot.id);
  writeStore(workshopDraftKey(robot.id), null);
  const overrides = loadDexOverrides();
  if (overrides[garageKey(robot.id)]) {
    delete overrides[garageKey(robot.id)];
    saveDexOverrides(overrides);
  }
  return result;
}
