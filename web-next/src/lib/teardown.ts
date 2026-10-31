/* Step-by-step teardown order for the take-apart viewer.
 *
 * Parts come off outside-in, the way you'd strip a real robot on the
 * bench: sensors and anything bolted on top first, then power and
 * electronics, then the running gear, and the core structure stays on
 * the bench as the last piece. Part ids are takeapart.ts's. Every
 * robot class shares this one list; ids a robot doesn't have are skipped. */
export const TEARDOWN_PRIORITY = [
  'lidar', 'camera', 'ultrasonic', 'head', 'gripper',
  'rotor', 'battery', 'fc',
  'link', 'arm', 'leg',
  'mount', 'wheel', 'caster',
  'torso', 'pelvis', 'frame', 'body', 'base', 'plate',
];

/* Returns the removable steps: every part id present, in teardown
 * order, minus the last one (the core that stays on the bench). */
export function teardownSteps(partIds: string[]): { steps: string[]; core: string | null } {
  const present = [...new Set(partIds)];
  const rank = (id: string) => {
    const i = TEARDOWN_PRIORITY.indexOf(id);
    return i < 0 ? TEARDOWN_PRIORITY.length : i;
  };
  const ordered = present.sort((a, b) => rank(a) - rank(b));
  if (ordered.length <= 1) return { steps: [], core: ordered[0] ?? null };
  return { steps: ordered.slice(0, -1), core: ordered[ordered.length - 1] };
}
