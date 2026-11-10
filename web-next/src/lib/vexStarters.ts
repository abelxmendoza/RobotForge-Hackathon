/* VEX V5 starter robots for the Workshop's Add panel. Each is a spec
 * file in examples/ (served under /examples/), so the CLI, the tests
 * and the app all read the same file. Pure data, zero imports. */
export interface VexStarter { file: string; name: string; blurb: string }

export const VEX_STARTERS: VexStarter[] = [
  { file: 'vex-v5-tank-drive.json', name: 'Starter tank drive', blurb: '4 motors, 4 in omni wheels, 360 rpm. A balanced first drive base.' },
  { file: 'vex-v5-speed-tank-6m.json', name: 'Speed tank (6-motor)', blurb: '6 motors, 3.25 in wheels, 450 rpm. The usual fast competition drive.' },
  { file: 'vex-v5-push-drive.json', name: 'Pushing drive', blurb: '4 motors, traction wheels, 200 rpm. Slow, strong and hard to push.' },
  { file: 'vex-v5-mecanum.json', name: 'Mecanum drive', blurb: '4 mecanum wheels, one motor each. Slides sideways and spins in place.' },
];
