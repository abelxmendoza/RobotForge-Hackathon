/** Guard a saved edit against the actual current record, not a stale UI list. */
export function requireRobotVersion<T extends {id:string;archivedAt?:string;versions:{id:string}[]}>(robots:T[],id:string,expected:string|null):T {
  const robot=robots.find(r=>r.id===id);
  if(!robot)throw new Error('This robot was removed before the edit could be saved.');
  if(robot.archivedAt&&Number.isFinite(Date.parse(robot.archivedAt)))throw new Error('This robot is archived. Restore it before editing.');
  if(!expected||robot.versions.at(-1)?.id!==expected)throw new Error('A newer saved version exists. Export your unsaved draft, then load the latest version before saving edits.');
  return robot;
}
