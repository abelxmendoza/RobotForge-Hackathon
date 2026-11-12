/* One job per Workshop tab: a line saying what the tab is for, the
 * robot's status for that job, and one main button. The button either
 * opens the RealSense camera window, runs the drive test, or asks Wrench
 * that tab's question about the robot on screen (Wrench carries the
 * robot's spec, checks, scans and notes with it). Pure, so it is tested
 * in Node; Garage renders it. */
export type FocusAction =
  | { kind: 'realsense'; label: string }
  | { kind: 'simRun'; label: string }
  | { kind: 'ask'; label: string; text: string };

export interface TabFocus { job: string; status: string; tone: 'pass' | 'marginal' | 'fail' | 'info'; action: FocusAction }

export interface FocusFacts {
  name: string;
  hasRealsense: boolean;
  hasScan: boolean;
  versions: number;
  verdictLabel: string;
  verdictCls: string; // 'pass' | 'marginal' | 'fail'
}

const tone = (cls: string): TabFocus['tone'] => (cls === 'pass' || cls === 'marginal' || cls === 'fail' ? cls : 'info');

export function tabFocus(tab: string, f: FocusFacts): TabFocus {
  const checks = { status: f.verdictLabel, tone: tone(f.verdictCls) };
  switch (tab) {
    case 'overview':
      return {
        job: `Know ${f.name}: its twin, its size and its health.`,
        status: f.hasRealsense ? 'RealSense scan on file' : f.hasScan ? '3D scan on file, no RealSense scan yet' : 'No 3D scan yet',
        tone: f.hasRealsense ? 'pass' : 'info',
        action: f.hasRealsense
          ? { kind: 'ask', label: 'Ask Wrench what to do next', text: 'What should I work on next on this robot?' }
          : { kind: 'realsense', label: 'Scan with RealSense camera' },
      };
    case 'build':
      return { job: `Put ${f.name} together, or take it apart to repair it.`, status: 'Steps come from its spec and parts', tone: 'info',
        action: { kind: 'ask', label: 'Walk me through the build', text: 'Walk me through building this robot' } };
    case 'wiring':
      return { job: `Keep ${f.name}'s power and connections safe.`, ...checks,
        action: { kind: 'ask', label: 'Check the wiring', text: 'Sanity-check this robot’s wiring' } };
    case 'bom':
    case 'tools':
      return { job: `What ${f.name} costs, what you already have, and what to buy.`, status: 'Checked against My Parts and Tools', tone: 'info',
        action: { kind: 'ask', label: 'What do I still need?', text: 'What do I still need to buy for this robot?' } };
    case 'checks':
      return { job: `Does ${f.name}'s design pass its engineering checks?`, ...checks,
        action: f.verdictCls === 'fail'
          ? { kind: 'ask', label: 'How do I fix these?', text: 'How do I fix this robot’s failing checks?' }
          : { kind: 'ask', label: 'Which checks matter most?', text: 'Which checks matter most for this robot?' } };
    case 'history':
      return { job: `What changed on ${f.name}, when, and why.`, status: `${f.versions} saved version${f.versions === 1 ? '' : 's'}`, tone: 'info',
        action: { kind: 'ask', label: 'What changed last?', text: 'What changed in this robot’s latest version?' } };
    case 'simulate':
      return { job: `Drive ${f.name} and see what happens.`, status: 'Browser physics, or local Gazebo when it is running', tone: 'info',
        action: { kind: 'simRun', label: 'Run the drive test' } };
    case 'specs':
      return { job: `Every number in ${f.name}'s spec.`, ...checks,
        action: { kind: 'ask', label: 'Summarize the spec', text: 'Summarize this robot’s spec' } };
    default:
      return { job: `Work on ${f.name}.`, ...checks, action: { kind: 'ask', label: 'Ask Wrench', text: 'Summarize this robot' } };
  }
}
