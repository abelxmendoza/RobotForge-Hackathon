/* Omega1's digital twin — a built-in Garage specimen.
 *
 * The twin was generated on 2026-11-01 by ProjectSim (Kaedim) from a
 * photo of the real Omega1 on its owner's bench, plus text-described
 * reconstructions of six of its parts. EVERYTHING geometric about it —
 * shape, scale, and every physics value below — is a model ESTIMATE,
 * not a measurement of the real robot. The measured record for Omega1
 * lives in docs/omega1/ (MEASURE.md, omega1.template.json,
 * omega1.extracted.json); nothing here overrides it.
 *
 * The six part models are SEPARATE reconstructions. They were never
 * registered to the rover model's frame, so they are presented as a
 * parts gallery, never as a fitted assembly. The rover model itself
 * is articulated in its source (links: chassis, sensor head, four
 * wheels), and only ITS OWN links may be pulled apart in the viewer.
 *
 * One part visible in the source photo — the motor-driver / expansion
 * board under the chassis — was deliberately NOT generated: no
 * RobotForge record names it, and an unnamed part is not guessed.
 *
 * Media: assets/omega1-twin/*.glb + *-preview.jpg, converted from the
 * original USD assets with tools/projectsim/convert_usd_to_glb.py
 * (see docs/omega1/TWIN.md). Only each material's base-colour map is
 * carried over; metallic / roughness / normal maps were dropped for
 * the web build, and heavy untextured meshes were decimated.
 */

export interface TwinPhysics {
  label: string;
  value: string;
}

export interface TwinSubject {
  id: string;
  name: string;
  /* Its place on the robot, in plain words. */
  role: string;
  /* The RobotForge record the part stands on (never invented). */
  basis: string;
  /* How ProjectSim generated this model. */
  generatedFrom: string;
  /* How many of this part the real robot carries. */
  countNote?: string;
  model: string;
  preview: string;
  /* ProjectSim's own physics estimates — estimates, not measurements. */
  physics: TwinPhysics[];
}

const MEDIA = 'assets/omega1-twin';

export const TWIN_LABEL = 'ProjectSim twin — ESTIMATED geometry';
export const TWIN_ESTIMATE_NOTE =
  'Generated from a photo by ProjectSim (Kaedim). Shape, scale and every physics value are model estimates, not measurements of the real robot.';

export const omega1Rover: TwinSubject = {
  id: 'omega1-rover',
  name: 'Omega1 — the whole rover',
  role: 'The twin root: the complete robot as one articulated model.',
  basis: 'The real Omega1 itself — Freenove FNK0043 4WD Raspberry Pi car (docs/omega1/MEASURE.md).',
  generatedFrom: 'A photo of the real robot on its bench (Omega-Code README photo, cropped to the robot).',
  model: `${MEDIA}/omega1-rover.glb`,
  preview: `${MEDIA}/omega1-rover-preview.jpg`,
  physics: [
    { label: 'Mass', value: '0.6835 kg — estimate' },
    { label: 'Material class', value: 'plastic — estimate' },
    { label: 'Static / dynamic friction', value: '0.35 / 0.28 — estimate' },
    { label: 'Restitution', value: '0.3 — estimate' },
    { label: 'Articulation', value: '5 revolute joints (sensor head + 4 wheels), as generated' },
  ],
};

/* The rover model's own links — the only pieces the explode control
 * may separate. Names match the GLB node groups written by the
 * converter from the USD link prims. */
export const ROVER_LINKS = [
  'chassis',
  'sensor_head',
  'wheel_front_left',
  'wheel_front_right',
  'wheel_rear_left',
  'wheel_rear_right',
] as const;

export const omega1Parts: TwinSubject[] = [
  {
    id: 'hc-sr04',
    name: 'HC-SR04 ultrasonic module',
    role: 'The rover’s ranging “eyes”, mounted at the front.',
    basis: 'Kit DOCUMENTED — the FNK0043 ships an HC-SR04; template sensors list ultrasonic, front.',
    generatedFrom: 'The catalogue’s verified SparkFun product photo of an HC-SR04.',
    model: `${MEDIA}/hc-sr04.glb`,
    preview: `${MEDIA}/hc-sr04-preview.jpg`,
    physics: [
      { label: 'Material class', value: 'metal / aluminium — estimate' },
      { label: 'Density', value: '696 kg/m³ — estimate' },
      { label: 'Static friction', value: '0.45 — estimate' },
    ],
  },
  {
    id: 'raspberry-pi',
    name: 'Raspberry Pi',
    role: 'The rover’s computer.',
    basis: 'Omega1’s own repo documents a Raspberry Pi 4B (4 GB) as its compute (docs/omega1/omega1.extracted.json). This model was generated generically — no Pi model is claimed for the model itself.',
    generatedFrom: 'A text description of a Raspberry Pi board.',
    model: `${MEDIA}/raspberry-pi.glb`,
    preview: `${MEDIA}/raspberry-pi-preview.jpg`,
    physics: [
      { label: 'Mass', value: '0.6393 kg — estimate (generous for a bare board; placeholder)' },
      { label: 'Material class', value: 'plastic — estimate' },
      { label: 'Static friction', value: '0.35 — estimate' },
    ],
  },
  {
    id: 'pi-camera',
    name: 'Pi Camera module',
    role: 'The rover’s front camera.',
    basis: 'Kit DOCUMENTED — template sensors list an RGB camera, front.',
    generatedFrom: 'A text description of a Raspberry Pi Camera Module.',
    model: `${MEDIA}/pi-camera.glb`,
    preview: `${MEDIA}/pi-camera-preview.jpg`,
    physics: [
      { label: 'Mass', value: '0.0971 kg — estimate' },
      { label: 'Static friction', value: '0.5 — estimate' },
    ],
  },
  {
    id: 'gearmotor-wheel',
    name: 'DC gearmotor with wheel',
    role: 'One driven corner: yellow TT gearmotor, output shaft and tyre.',
    basis: 'Template motor block — 4× dc_gearmotor, one per wheel.',
    generatedFrom: 'A text description of a yellow TT gearmotor with its wheel.',
    countNote: '×4 on the real robot — one model represents the repeated part.',
    model: `${MEDIA}/gearmotor-wheel.glb`,
    preview: `${MEDIA}/gearmotor-wheel-preview.jpg`,
    physics: [
      { label: 'Material class', value: 'plastic — estimate' },
      { label: 'Density', value: '852 kg/m³ — estimate' },
      { label: 'Static friction', value: '0.35 — estimate' },
    ],
  },
  {
    id: 'battery-cells',
    name: '18650 cells (pair)',
    role: 'The rover’s power source, under the deck.',
    basis: 'Kit DOCUMENTED — two 3.7 V 18650 cells in series, 7.4 V nominal (template battery block).',
    generatedFrom: 'A text description of two 18650 cells side by side.',
    model: `${MEDIA}/battery-cells.glb`,
    preview: `${MEDIA}/battery-cells-preview.jpg`,
    physics: [
      { label: 'Density', value: '2726 kg/m³ — estimate' },
      { label: 'Static friction', value: '0.35 — estimate' },
    ],
  },
  {
    id: 'chassis-plate',
    name: 'Chassis plate',
    role: 'The black deck plate everything mounts to.',
    basis: 'The template’s dimension fields are chassis-plate measurements; the plate is the robot’s structural base in the source photo.',
    generatedFrom: 'A text description of the kit’s black acrylic deck plate.',
    model: `${MEDIA}/chassis-plate.glb`,
    preview: `${MEDIA}/chassis-plate-preview.jpg`,
    physics: [
      { label: 'Mass', value: '0.1445 kg — estimate' },
      { label: 'Material class', value: 'plastic — estimate' },
      { label: 'Static friction', value: '0.35 — estimate' },
    ],
  },
];

export const twinSubjects: TwinSubject[] = [omega1Rover, ...omega1Parts];

/* Facts about the real Omega1, from its own RobotForge records only
 * (docs/omega1/MEASURE.md, omega1.template.json, omega1.extracted.json).
 * These describe the physical robot — never the twin's estimates. */
export const OMEGA1_FACTS: { label: string; value: string }[] = [
  { label: 'Base kit', value: 'Freenove FNK0043 4WD Raspberry Pi car' },
  { label: 'Drive', value: 'Skid-steer, four driven wheels' },
  { label: 'Control', value: 'Manual remote control — Omega1 does not drive itself' },
  { label: 'Compute', value: 'Raspberry Pi 4B (4 GB), documented in its own repo' },
  { label: 'Sensors (kit)', value: 'HC-SR04 ultrasonic + camera, both front' },
  { label: 'Battery', value: '2× 18650 in series — 7.4 V nominal' },
  { label: 'Right now', value: 'Off the bench awaiting repair parts (MEASURE.md)' },
];

export const TWIN_NOT_GENERATED =
  'Not generated: the motor-driver / expansion board visible under the chassis in the photo. No RobotForge record names it, so it was skipped rather than guessed.';

/* The Omega1 Checks pane lines, in the Workshop's "[SEVERITY] check:
 * message" shape, derived ONLY from the records above (OMEGA1_FACTS and
 * the template blocks the subjects cite). What the records do not state
 * is NOT_CHECKED with the gap named — and there is deliberately no
 * overall verdict line: no gate has ever run on Omega1, so nothing
 * here claims one. Shared by the Checks pane and the chat snapshot
 * Garage publishes while the twin is open, so the two never drift. */
export const OMEGA1_CHECK_LINES: string[] = [
  '[PASS] control: manual remote control is the recorded control mode',
  '[PASS] power: 2× 18650 cells in series — 7.4 V nominal is recorded',
  '[PASS] sensors: HC-SR04 ultrasonic + camera, both front, are recorded',
  '[NOT_CHECKED] motor-driver board: no RobotForge record names it',
  '[NOT_CHECKED] measured spec fields: not loaded in the Workshop — they live in docs/omega1/MEASURE.md',
];
