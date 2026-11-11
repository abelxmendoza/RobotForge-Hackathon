/* Curated component identities with mounting hole patterns, orientation rules,
 * terminal locations, and catalogue illustration links.
 * Geometry is an envelope with stylized 3D proxy details, never manufacturer CAD.
 * Do not infer a third-party carrier's dimensions or pinout from a module name. */

export type ComponentCategory = 'compute' | 'power' | 'sensor' | 'drive' | 'safety';
export type MountingKind =
  | 'standoffs-m2.5'
  | 'standoffs-m3'
  | 'velcro-strap'
  | 'bezel-m2'
  | 'flange-m3'
  | 'panel-collar';
export type MountingZone =
  | 'center-deck'
  | 'front-perimeter'
  | 'top-mast'
  | 'low-cg-bay'
  | 'power-bay'
  | 'drive-bay'
  | 'accessible-top';

export interface ComponentMountingSpec {
  kind: MountingKind;
  fastener: string;
  /** [xMm, yMm] offsets from component center, strictly inside footprint. */
  holePatternMm: [number, number][];
  holeDiameterMm: number;
  standoffHeightMm: number;
  preferredZone: MountingZone;
  notes: string;
}

export interface ComponentOrientationRule {
  preferredYawDeg: number;
  forwardAxisLabel: string;
  requiresPerimeterClearance: boolean;
  requiresCenterAlignment?: boolean;
  requiresElevatedLineOfSight?: boolean;
  fovDeg: number | null;
  fovRangeM: number | null;
  keepoutFrontMm: number;
  thermalClearanceTopMm: number;
}

export interface ComponentTerminal {
  id: string;
  label: string;
  kind: 'power' | 'data';
  /** Relative offset [-0.5..0.5] along [length, width, height] in local frame. */
  localOffsetRatio: [number, number, number];
  voltageV?: number;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  aliases: string[];
  category: ComponentCategory;
  sizeM: [number, number, number];
  massKg: number;
  geometry: 'published-envelope' | 'illustrative';
  image: string;
  imageCaption: string;
  source: string;
  note: string;
  missing: string[];
  mounting: ComponentMountingSpec;
  orientation: ComponentOrientationRule;
  terminals: ComponentTerminal[];
}

export const COMPONENTS: ComponentDefinition[] = [
  {
    id: 'jetson-orin-nano-reference-devkit',
    name: 'Jetson Orin Nano — NVIDIA reference developer kit',
    aliases: [
      'jetson orin nano',
      'jetson orin nano developer kit',
      'nvidia jetson orin nano',
      'orin nano devkit',
    ],
    category: 'compute',
    sizeM: [0.100, 0.079, 0.021],
    massKg: 0.176,
    geometry: 'published-envelope',
    image: 'assets/img/parts/jetson_orin_nano.jpg',
    imageCaption: 'Catalogue illustration — NVIDIA reference kit envelope (100 × 79 × 21 mm)',
    source:
      'https://developer.nvidia.com/blog/develop-ai-powered-robots-smart-vision-systems-and-more-with-nvidia-jetson-orin-nano-developer-kit',
    note: 'NVIDIA publishes a 100 × 79 × 21 mm kit envelope. Confirm the reference carrier and your actual cooling hardware. This is a simple envelope, not detailed CAD; connectors and mounting holes are planning proxies.',
    missing: [
      'Mounting-hole coordinates',
      'Port and cooling keep-outs',
      'Actual mass',
      'Confirmed carrier revision and power requirements',
      'Connector pin assignments',
    ],
    mounting: {
      kind: 'standoffs-m2.5',
      fastener: '4 × M2.5 × 6 mm brass standoffs',
      holePatternMm: [
        [-43, -33],
        [43, -33],
        [-43, 33],
        [43, 33],
      ],
      holeDiameterMm: 2.7,
      standoffHeightMm: 6,
      preferredZone: 'center-deck',
      notes: 'Mount on 6 mm standoffs near deck center for harness reach and fan airflow.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'USB-A / GbE / DisplayPort cluster facing +X; heatsink fins along X',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 25,
      thermalClearanceTopMm: 15,
    },
    terminals: [
      { id: 'dc-in', label: 'DC barrel 9–19 V', kind: 'power', localOffsetRatio: [0.46, -0.32, -0.15], voltageV: 12 },
      { id: 'usb-data', label: 'USB 3.2 / UART', kind: 'data', localOffsetRatio: [0.46, 0.12, -0.10] },
      { id: 'gpio-40', label: '40-pin GPIO / I2C', kind: 'data', localOffsetRatio: [-0.10, 0.44, 0.20] },
    ],
  },
  {
    id: 'battery-envelope',
    name: 'Battery — planning placeholder',
    aliases: ['battery', 'battery placeholder', '4s lipo', 'lipo 4s 5200'],
    category: 'power',
    sizeM: [0.100, 0.035, 0.030],
    massKg: 0.480,
    geometry: 'illustrative',
    image: 'assets/img/parts/lipo_4s_5200.jpg',
    imageCaption: 'Catalogue illustration — planning battery pack envelope (100 × 35 × 30 mm)',
    source: '',
    note: 'Illustrative 100 × 35 × 30 mm box only. Not a battery recommendation or confirmed physical part.',
    missing: [
      'Exact battery model',
      'Measured dimensions and mass',
      'Minimum and maximum pack voltage',
      'Continuous and peak current',
      'Connector pin assignments',
      'Protection requirements',
    ],
    mounting: {
      kind: 'velcro-strap',
      fastener: '2 × 20 mm non-slip Velcro battery straps + deck slots',
      holePatternMm: [
        [-31, -15],
        [-31, 15],
        [31, -15],
        [31, 15],
      ],
      holeDiameterMm: 4.0,
      standoffHeightMm: 2,
      preferredZone: 'low-cg-bay',
      notes: 'Place low and close to chassis XY center to keep the center of mass balanced.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'XT60 main discharge lead and balance tap exiting +X',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 20,
      thermalClearanceTopMm: 8,
    },
    terminals: [
      { id: 'xt60-out', label: 'XT60 main discharge', kind: 'power', localOffsetRatio: [0.48, 0, 0.15], voltageV: 14.8 },
      { id: 'balance-jst', label: 'JST-XH balance tap', kind: 'data', localOffsetRatio: [0.46, 0.30, 0.25] },
    ],
  },
  {
    id: 'converter-envelope',
    name: 'DC converter — planning placeholder',
    aliases: ['buck converter', 'converter', 'dc converter', '5v buck converter'],
    category: 'power',
    sizeM: [0.045, 0.025, 0.015],
    massKg: 0.032,
    geometry: 'illustrative',
    image: 'assets/img/parts/buck_converter_5v.jpg',
    imageCaption: 'Catalogue illustration — synchronous buck regulator envelope (45 × 25 × 15 mm)',
    source: '',
    note: 'Illustrative 45 × 25 × 15 mm box only. Buck, boost or buck-boost topology and ratings remain unselected.',
    missing: [
      'Exact converter model and topology',
      'Measured dimensions and mass',
      'Input and output voltage ranges',
      'Derated current and thermal capacity',
      'Connector pin assignments',
    ],
    mounting: {
      kind: 'standoffs-m3',
      fastener: '4 × M3 × 5 mm nylon/brass standoffs',
      holePatternMm: [
        [-18, -9],
        [18, -9],
        [-18, 9],
        [18, 9],
      ],
      holeDiameterMm: 3.2,
      standoffHeightMm: 5,
      preferredZone: 'power-bay',
      notes: 'Place between battery and compute board to minimize high-current wire loop length.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Regulated VOUT terminal facing +X toward logic loads; VIN on -X',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 12,
      thermalClearanceTopMm: 10,
    },
    terminals: [
      { id: 'vin', label: 'VIN+ / GND screw terminal', kind: 'power', localOffsetRatio: [-0.45, 0, 0.10], voltageV: 14.8 },
      { id: 'vout', label: 'VOUT 5 V / 5 A terminal', kind: 'power', localOffsetRatio: [0.45, 0, 0.10], voltageV: 5.0 },
    ],
  },
  {
    id: 'raspberry-pi-5-sbc',
    name: 'Raspberry Pi 5 — 8 GB single-board computer',
    aliases: ['raspberry pi 5', 'raspberry pi', 'rpi5', 'pi 5'],
    category: 'compute',
    sizeM: [0.085, 0.056, 0.017],
    massKg: 0.051,
    geometry: 'published-envelope',
    image: 'assets/img/parts/raspberry_pi_5.jpg',
    imageCaption: 'Catalogue illustration — standard 85 × 56 mm SBC form factor (58 × 49 mm M2.5 pattern)',
    source: 'https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-mechanical-drawing.pdf',
    note: 'Published 85 × 56 mm board outline with standard 58 × 49 mm M2.5 mounting pattern. Requires stable 5.1 V / 5 A USB-C PD or regulated 5 V header supply.',
    missing: [
      'Active cooler Z height with chosen case',
      'Confirmed 5 V rail current budget under load',
      'GPIO pin allocation table',
    ],
    mounting: {
      kind: 'standoffs-m2.5',
      fastener: '4 × M2.5 × 6 mm standoffs (58 × 49 mm Raspberry Pi HAT standard)',
      holePatternMm: [
        [-29, -24.5],
        [29, -24.5],
        [-29, 24.5],
        [29, 24.5],
      ],
      holeDiameterMm: 2.75,
      standoffHeightMm: 6,
      preferredZone: 'center-deck',
      notes: 'Standard 58 × 49 mm M2.5 hole rectangle; leave +X clear for USB/Ethernet plugs.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Dual USB 3.0 + Gigabit Ethernet facing +X; 40-pin GPIO along +Y edge',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 22,
      thermalClearanceTopMm: 12,
    },
    terminals: [
      { id: 'usbc-5v', label: '5 V / 5 A USB-C power', kind: 'power', localOffsetRatio: [-0.30, -0.46, -0.10], voltageV: 5.0 },
      { id: 'gpio-header', label: '40-pin GPIO / UART / I2C', kind: 'data', localOffsetRatio: [0.0, 0.44, 0.25] },
      { id: 'usb-ports', label: 'USB 3.0 host ports', kind: 'data', localOffsetRatio: [0.46, 0.0, 0.10] },
    ],
  },
  {
    id: 'raspberry-pi-4b-sbc',
    name: 'Raspberry Pi 4B — single-board computer',
    aliases: ['raspberry pi 4b', 'pi 4b', 'raspberry pi 4', 'rpi 4b', 'rpi4'],
    category: 'compute',
    sizeM: [0.085, 0.056, 0.017],
    massKg: 0.046,
    geometry: 'published-envelope',
    image: 'assets/img/parts/raspberry_pi_5.jpg',
    imageCaption: 'Catalogue illustration — the standard 85 × 56 mm Raspberry Pi board outline (photo shows a Pi 5; the 4B shares the outline and the 58 × 49 mm M2.5 pattern)',
    source: 'https://datasheets.raspberrypi.com/rpi4/raspberry-pi-4-mechanical-drawing.pdf',
    note: 'Published 85 × 56 mm board outline with the standard 58 × 49 mm M2.5 mounting pattern — the same footprint as the Pi 5, with different ports (2 × micro-HDMI, 2 × USB 3.0 + 2 × USB 2.0). Requires a stable 5 V / 3 A USB-C supply (the official supply is 5.1 V / 3 A). This is the board Omega1\u2019s own records document (Raspberry Pi 4B, 4 GB — docs/omega1/omega1.extracted.json).',
    missing: [
      'RAM size of the specific board (1–8 GB variants exist)',
      'Confirmed 5 V rail current budget under load',
      'GPIO pin allocation table',
    ],
    mounting: {
      kind: 'standoffs-m2.5',
      fastener: '4 × M2.5 × 6 mm standoffs (58 × 49 mm Raspberry Pi HAT standard)',
      holePatternMm: [
        [-29, -24.5],
        [29, -24.5],
        [-29, 24.5],
        [29, 24.5],
      ],
      holeDiameterMm: 2.75,
      standoffHeightMm: 6,
      preferredZone: 'center-deck',
      notes: 'Standard 58 × 49 mm M2.5 hole rectangle; leave +X clear for USB/Ethernet plugs.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'USB 3.0 / USB 2.0 + Gigabit Ethernet facing +X; 40-pin GPIO along +Y edge; CSI camera port between Ethernet and HDMI',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 22,
      thermalClearanceTopMm: 10,
    },
    terminals: [
      { id: 'usbc-5v', label: '5 V / 3 A USB-C power', kind: 'power', localOffsetRatio: [-0.30, -0.46, -0.10], voltageV: 5.0 },
      { id: 'gpio-header', label: '40-pin GPIO / UART / I2C', kind: 'data', localOffsetRatio: [0.0, 0.44, 0.25] },
      { id: 'csi-camera', label: 'CSI camera port (15-pin, for OV5647-class camera modules)', kind: 'data', localOffsetRatio: [-0.28, 0.30, 0.10] },
      { id: 'usb-ports', label: 'USB 3.0 / USB 2.0 host ports', kind: 'data', localOffsetRatio: [0.46, 0.0, 0.10] },
    ],
  },
  {
    id: 'pi-camera-ov5647',
    name: 'Pi Camera OV5647 — Raspberry Pi camera module',
    aliases: ['pi camera', 'raspberry pi camera', 'ov5647', 'camera module', 'pi cam'],
    category: 'sensor',
    sizeM: [0.025, 0.024, 0.009],
    massKg: 0.003,
    geometry: 'published-envelope',
    image: 'assets/img/parts/camera_rpi_v2.jpg',
    imageCaption: 'Catalogue illustration — a Raspberry Pi Camera Module board (v2 photo; the OV5647 is the v1 module, same board class and ribbon interface)',
    source: 'https://www.raspberrypi.com/documentation/accessories/camera.html',
    note: 'The OV5647 camera module documented in Omega1\u2019s records (CSI, via libcamera — docs/omega1/omega1.extracted.json): a small fixed-focus board on a 15-pin CSI ribbon to the Pi. On Omega1 it rides the pan/tilt servo head, with the HC-SR04 mounted above it. Geometry is the published board envelope, not a measurement of a specific module.',
    missing: [
      'Exact hole pattern of the specific module in hand — confirm against the physical board',
      'Ribbon cable length and routing to the Pi CSI port',
      'Focus setting (fixed-focus module; adjustable only by turning the lens)',
    ],
    mounting: {
      kind: 'bezel-m2',
      fastener: '2 × M2 screws (diagonal board holes — confirm pattern on the physical module)',
      holePatternMm: [
        [-9, -8],
        [9, 8],
      ],
      holeDiameterMm: 2.2,
      standoffHeightMm: 3,
      preferredZone: 'front-perimeter',
      notes: 'Lens faces outward; on a pan/tilt head the mount moves with the servos, so leave ribbon slack for the full sweep.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Lens facing +X (about 54° horizontal field of view, as published for the OV5647 module)',
      requiresPerimeterClearance: true,
      fovDeg: 54,
      fovRangeM: null,
      keepoutFrontMm: 10,
      thermalClearanceTopMm: 2,
    },
    terminals: [
      { id: 'csi', label: '15-pin CSI ribbon to the Pi camera port', kind: 'data', localOffsetRatio: [0, -0.45, 0] },
    ],
  },
  {
    id: 'servo-hobby-generic',
    name: 'Hobby servo — generic planning servo (SG90 class)',
    aliases: ['servo', 'hobby servo', 'sg90', 'micro servo'],
    category: 'drive',
    sizeM: [0.032, 0.012, 0.031],
    massKg: 0.009,
    geometry: 'illustrative',
    image: 'assets/img/parts/servo_mg996r.jpg',
    imageCaption: 'Catalogue illustration — a metal-gear hobby servo (MG996R photo); the generic planning servo is an envelope, not this exact unit',
    source: '',
    note: 'A generic planning component in the common SG90-class micro-servo envelope — no specific model, and no torque figure is claimed, because the records do not name one. On Omega1-class Freenove builds the pan/tilt servos are NOT driven from Pi GPIO: they are channels 8 (pan) and 9 (tilt) of the PCA9685 PWM hat (I2C 0x40, shared 50 Hz clock — docs/omega1/omega1.extracted.json). Plan the signal wire to the PCA9685, not to the Pi.',
    missing: [
      'The actual servo model and its torque / speed ratings',
      'Stall current (sizes the 5–6 V rail and its wiring)',
      'Horn and bracket geometry for the specific unit',
    ],
    mounting: {
      kind: 'flange-m3',
      fastener: '2 × screws through the mounting ears (SG90-class ear pattern — confirm on the physical servo)',
      holePatternMm: [
        [-14, 0],
        [14, 0],
      ],
      holeDiameterMm: 2.2,
      standoffHeightMm: 2,
      preferredZone: 'top-mast',
      notes: 'Mount by the ears with the output spline clear to sweep; leave room for the horn arc.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Output spline facing +Z up; the horn sweeps in the horizontal plane',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 12,
      thermalClearanceTopMm: 5,
    },
    terminals: [
      { id: 'pwm-signal', label: 'PWM signal (from a PCA9685 channel on Omega1-class builds)', kind: 'data', localOffsetRatio: [-0.30, -0.45, -0.20] },
      { id: 'vcc-gnd', label: '4.8–6 V power + GND', kind: 'power', localOffsetRatio: [0.30, -0.45, -0.20], voltageV: 5.0 },
    ],
  },
  {
    id: 'lipo-3s-2200-pack',
    name: 'LiPo battery 3S 2200 mAh (11.1 V, XT60)',
    aliases: ['3s lipo', 'lipo 3s', 'lipo 3s 2200', '11.1v battery'],
    category: 'power',
    sizeM: [0.105, 0.034, 0.024],
    massKg: 0.185,
    geometry: 'illustrative',
    image: 'assets/img/parts/lipo_3s_2200.jpg',
    imageCaption: 'Catalogue illustration — 3S 2200 mAh LiPo pack (105 × 34 × 24 mm)',
    source: '',
    note: 'Typical 3S 2200 mAh pouch-cell pack dimensions (105 × 34 × 24 mm). Verify cell swelling clearance and physical retention.',
    missing: ['Continuous C-rating', 'Low-voltage cutoff alarm setting', 'Fused main lead rating'],
    mounting: {
      kind: 'velcro-strap',
      fastener: '2 × 16 mm Velcro battery straps + EVA foam pad',
      holePatternMm: [
        [-32, -14],
        [-32, 14],
        [32, -14],
        [32, 14],
      ],
      holeDiameterMm: 3.5,
      standoffHeightMm: 2,
      preferredZone: 'low-cg-bay',
      notes: 'Strap down along chassis centerline to balance pitch/roll inertia.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'XT60 power lead exiting +X toward motor driver / power distribution',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 18,
      thermalClearanceTopMm: 8,
    },
    terminals: [
      { id: 'xt60-11v', label: 'XT60 11.1 V output', kind: 'power', localOffsetRatio: [0.48, 0, 0.10], voltageV: 11.1 },
    ],
  },
  {
    id: 'driver-l298n-module',
    name: 'Dual H-bridge DC motor driver (L298N / TB6612 carrier)',
    aliases: ['motor driver', 'l298n', 'h-bridge', 'dual motor driver', 'tb6612'],
    category: 'drive',
    sizeM: [0.043, 0.043, 0.027],
    massKg: 0.028,
    geometry: 'published-envelope',
    image: 'assets/img/parts/driver_l298n.jpg',
    imageCaption: 'Catalogue illustration — 43 × 43 × 27 mm dual H-bridge driver carrier',
    source: '',
    note: 'Standard 43 × 43 mm dual H-bridge module envelope with 36 × 36 mm M3 corner holes and central vertical heatsink.',
    missing: ['Continuous current per channel vs thermal derating', 'PWM frequency and dead-time spec'],
    mounting: {
      kind: 'standoffs-m3',
      fastener: '4 × M3 × 6 mm standoffs (36 × 36 mm square pattern)',
      holePatternMm: [
        [-18, -18],
        [18, -18],
        [-18, 18],
        [18, 18],
      ],
      holeDiameterMm: 3.2,
      standoffHeightMm: 6,
      preferredZone: 'drive-bay',
      notes: 'Mount near wheel motors and battery rail; keep vertical heatsink unobstructed.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'PWM/direction logic pins facing +X; OUTA/OUTB motor screw blocks on ±Y sides',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 12,
      thermalClearanceTopMm: 15,
    },
    terminals: [
      { id: 'vmot-in', label: '12 V motor power input', kind: 'power', localOffsetRatio: [-0.44, 0, -0.15], voltageV: 12 },
      { id: 'pwm-in', label: 'PWM + IN1..IN4 logic', kind: 'data', localOffsetRatio: [0.44, 0, -0.15] },
      { id: 'motor-out-l', label: 'Motor A screw terminal', kind: 'power', localOffsetRatio: [0, 0.45, -0.10] },
      { id: 'motor-out-r', label: 'Motor B screw terminal', kind: 'power', localOffsetRatio: [0, -0.45, -0.10] },
    ],
  },
  {
    id: 'realsense-d435-depth-cam',
    name: 'Intel RealSense D435 stereo depth camera',
    aliases: ['realsense', 'realsense d435', 'depth camera', 'intel realsense', 'd435'],
    category: 'sensor',
    sizeM: [0.025, 0.090, 0.025],
    massKg: 0.072,
    geometry: 'published-envelope',
    image: 'assets/img/parts/realsense_d435.jpg',
    imageCaption: 'Catalogue illustration — Intel RealSense D435 (90 mm wide × 25 mm deep × 25 mm tall)',
    source: 'https://www.intelrealsense.com/depth-camera-d435/',
    note: 'Published 90 × 25 × 25 mm stereo depth bar (25 mm along optical +X axis, 90 mm stereo baseline along Y). Needs clear forward line-of-sight.',
    missing: ['USB 3.1 Gen 1 lock-screw cable bend radius', 'Exact pitch tilt angle for floor visibility'],
    mounting: {
      kind: 'flange-m3',
      fastener: '1 × 1/4"-20 center tripod screw or 2 × M3 × 6 mm rear bracket threads (45 mm spacing)',
      holePatternMm: [
        [-6, -22.5],
        [-6, 22.5],
      ],
      holeDiameterMm: 3.2,
      standoffHeightMm: 12,
      preferredZone: 'front-perimeter',
      notes: 'Mount at front deck edge (+X) with zero obstruction inside the 87° horizontal stereo FOV cone.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Stereo IR + RGB lenses facing +X forward (87° horizontal FOV)',
      requiresPerimeterClearance: true,
      fovDeg: 87,
      fovRangeM: 1.2,
      keepoutFrontMm: 40,
      thermalClearanceTopMm: 8,
    },
    terminals: [
      { id: 'usbc-3', label: 'USB-C 3.1 data + 5 V', kind: 'data', localOffsetRatio: [-0.20, -0.46, 0.0] },
    ],
  },
  {
    id: 'rplidar-a1-scanner',
    name: 'Slamtec RPLIDAR A1 360° 2D laser scanner',
    aliases: ['rplidar', 'rplidar a1', 'lidar', '2d lidar', 'laser scanner'],
    category: 'sensor',
    sizeM: [0.097, 0.070, 0.055],
    massKg: 0.170,
    geometry: 'published-envelope',
    image: 'assets/img/parts/rplidar_a1.jpg',
    imageCaption: 'Catalogue illustration — Slamtec RPLIDAR A1 (96.8 × 70.3 × 55 mm)',
    source: 'https://www.slamtec.com/en/Lidar/A1',
    note: 'Published 96.8 × 70.3 × 55 mm envelope. Optical scan plane sits near the top turret; taller deck parts at the same Z height will cast blind-spot shadows.',
    missing: ['Riser standoff height needed to clear taller electronics', '5 V motor PWM startup current'],
    mounting: {
      kind: 'standoffs-m2.5',
      fastener: '4 × M2.5 × 20 mm elevated riser standoffs',
      holePatternMm: [
        [-35, -26],
        [35, -26],
        [-35, 26],
        [35, 26],
      ],
      holeDiameterMm: 2.7,
      standoffHeightMm: 20,
      preferredZone: 'top-mast',
      notes: 'Elevate on risers above SBC/battery so the 360° laser plane has unobstructed sweep.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: '0° heading index aligned with robot +X forward (360° scan plane)',
      requiresPerimeterClearance: false,
      requiresElevatedLineOfSight: true,
      fovDeg: 360,
      fovRangeM: 1.5,
      keepoutFrontMm: 15,
      thermalClearanceTopMm: 5,
    },
    terminals: [
      { id: 'uart-5v', label: 'UART + 5 V motor header', kind: 'data', localOffsetRatio: [-0.45, 0, -0.35] },
    ],
  },
  {
    id: 'ultrasonic-hcsr04',
    name: 'HC-SR04 ultrasonic distance sensor (5 V)',
    aliases: ['ultrasonic', 'hc-sr04', 'hcsr04', 'ultrasonic ranger', 'ultrasonic sensor'],
    category: 'sensor',
    sizeM: [0.015, 0.045, 0.020],
    massKg: 0.009,
    geometry: 'published-envelope',
    image: 'assets/img/parts/ultrasonic_hcsr04.jpg',
    imageCaption: 'Catalogue illustration — HC-SR04 ultrasonic ranger (45 mm wide × 20 mm tall × 15 mm deep)',
    source: '',
    note: 'Standard 45 × 20 × 15 mm board with dual 16 mm transducer cans facing +X. Note 5 V logic level on TRIG/ECHO.',
    missing: ['5 V to 3.3 V level shifter for 3.3 V GPIO controllers', 'Minimum blind-zone distance (20 mm)'],
    mounting: {
      kind: 'bezel-m2',
      fastener: '2 × M2 front L-bracket screws (42 × 17 mm corner holes)',
      holePatternMm: [
        [-3, -19.5],
        [-3, 19.5],
      ],
      holeDiameterMm: 2.0,
      standoffHeightMm: 4,
      preferredZone: 'front-perimeter',
      notes: 'Mount flush at the perimeter edge with transducer cones pointing outward.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Dual ultrasonic transducer cans facing outward along local +X (30° acoustic cone)',
      requiresPerimeterClearance: true,
      fovDeg: 30,
      fovRangeM: 0.8,
      keepoutFrontMm: 30,
      thermalClearanceTopMm: 4,
    },
    terminals: [
      { id: 'vcc-trig-echo', label: '4-pin VCC(5V)/TRIG/ECHO/GND', kind: 'data', localOffsetRatio: [-0.35, 0, -0.40], voltageV: 5.0 },
    ],
  },
  {
    id: 'imu-bno055-9dof',
    name: '9-DoF absolute orientation IMU (BNO055 / BNO085)',
    aliases: ['imu', 'bno055', 'bno085', '9dof imu', 'gyroscope'],
    category: 'sensor',
    sizeM: [0.026, 0.020, 0.005],
    massKg: 0.004,
    geometry: 'published-envelope',
    image: 'assets/img/parts/imu_bno055.jpg',
    imageCaption: 'Catalogue illustration — 9-DoF MEMS IMU breakout (26 × 20 × 5 mm)',
    source: '',
    note: 'Compact 26 × 20 mm IMU breakout. Rigidly mount near the robot center of rotation and keep away from high-current motor leads (magnetometer interference).',
    missing: ['Hard/soft-iron magnetometer calibration offsets', 'Rigid vibration isolation spec'],
    mounting: {
      kind: 'standoffs-m2.5',
      fastener: '4 × M2.5 × 4 mm non-magnetic nylon standoffs (20 × 15 mm pattern)',
      holePatternMm: [
        [-10, -7.5],
        [10, -7.5],
        [-10, 7.5],
        [10, 7.5],
      ],
      holeDiameterMm: 2.5,
      standoffHeightMm: 4,
      preferredZone: 'center-deck',
      notes: 'Use non-magnetic brass/nylon fasteners near chassis XY center [0, 0] aligned with cardinal axes.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'PCB +X silkscreen arrow aligned with robot +X (cardinal 0°/90°/180° yaw required)',
      requiresPerimeterClearance: false,
      requiresCenterAlignment: true,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 8,
      thermalClearanceTopMm: 5,
    },
    terminals: [
      { id: 'qwiic-i2c', label: 'I2C / STEMMA QT 3.3 V', kind: 'data', localOffsetRatio: [-0.42, 0, 0.10], voltageV: 3.3 },
    ],
  },
  {
    id: 'gearmotor-37d-12v',
    name: '37D 12 V metal DC gearmotor with quadrature encoder',
    aliases: ['gearmotor', '12v gearmotor', 'dc gearmotor', '37d motor'],
    category: 'drive',
    sizeM: [0.070, 0.037, 0.037],
    massKg: 0.215,
    geometry: 'published-envelope',
    image: 'assets/img/parts/gearmotor_12v.jpg',
    imageCaption: 'Catalogue illustration — 37 mm diameter × 70 mm 12 V spur/planetary gearmotor',
    source: '',
    note: 'Standard 37D cylindrical gearmotor envelope (70 mm length × 37 mm diameter) with 6 × M3 face-mount ring on a 31 mm bolt circle.',
    missing: ['Gear ratio and no-load RPM', 'Encoder CPR and pull-up voltage'],
    mounting: {
      kind: 'flange-m3',
      fastener: '4 × M3 × 8 mm face-flange screws on L-bracket (31 mm bolt circle)',
      holePatternMm: [
        [28, -11],
        [28, 11],
        [-20, -11],
        [-20, 11],
      ],
      holeDiameterMm: 3.2,
      standoffHeightMm: 3,
      preferredZone: 'drive-bay',
      notes: 'Mount on side chassis wall / L-bracket with output shaft aligned to wheel axle.',
    },
    orientation: {
      preferredYawDeg: 90,
      forwardAxisLabel: '6 mm D-shaft output exiting along local +X toward left/right wheel hub',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 15,
      thermalClearanceTopMm: 5,
    },
    terminals: [
      { id: 'motor-leads', label: 'M+ / M- 12 V power leads', kind: 'power', localOffsetRatio: [-0.46, -0.15, 0], voltageV: 12 },
      { id: 'enc-6pin', label: '6-pin quadrature encoder', kind: 'data', localOffsetRatio: [-0.46, 0.15, 0], voltageV: 5 },
    ],
  },
  {
    id: 'estop-mushroom-switch',
    name: 'Emergency stop mushroom button (NC high-current)',
    aliases: ['e-stop', 'estop', 'emergency stop', 'kill switch'],
    category: 'safety',
    sizeM: [0.045, 0.045, 0.038],
    massKg: 0.065,
    geometry: 'illustrative',
    image: 'assets/img/parts/estop_button.jpg',
    imageCaption: 'Catalogue illustration — latching red mushroom E-stop switch (45 × 45 × 38 mm)',
    source: '',
    note: 'Latching emergency stop switch in series with main battery contactor/discharge path. Must be immediately reachable from the top exterior.',
    missing: ['DC contact current rating at pack voltage', '22 mm panel cutout position'],
    mounting: {
      kind: 'panel-collar',
      fastener: '22 mm top-deck bulkhead nut + 4 × M3 corner enclosure screws',
      holePatternMm: [
        [-17, -17],
        [17, -17],
        [-17, 17],
        [17, 17],
      ],
      holeDiameterMm: 3.2,
      standoffHeightMm: 3,
      preferredZone: 'accessible-top',
      notes: 'Mount on top rear/center deck with zero vertical obstruction above the red mushroom cap.',
    },
    orientation: {
      preferredYawDeg: 0,
      forwardAxisLabel: 'Twist-to-release mushroom cap facing +Z up; high-current lugs along ±X',
      requiresPerimeterClearance: false,
      fovDeg: null,
      fovRangeM: null,
      keepoutFrontMm: 10,
      thermalClearanceTopMm: 35,
    },
    terminals: [
      { id: 'batt-in', label: 'Battery + in', kind: 'power', localOffsetRatio: [-0.45, 0, -0.25] },
      { id: 'bus-out', label: 'Main bus + out', kind: 'power', localOffsetRatio: [0.45, 0, -0.25] },
    ],
  },
];

export function resolveComponent(query: string): ComponentDefinition {
  const q = query.trim().toLowerCase();
  const matches = COMPONENTS.filter(
    (c) =>
      c.id === q ||
      c.name.toLowerCase() === q ||
      c.aliases.includes(q),
  );
  if (matches.length !== 1) {
    throw new Error(
      'Choose a supported component: Jetson Orin Nano (NVIDIA reference kit), Raspberry Pi 5, Raspberry Pi 4B, Pi Camera OV5647, hobby servo, battery placeholder, 3S LiPo, buck converter, motor driver, RealSense D435, RPLIDAR A1, HC-SR04 ultrasonic, 9-DoF IMU, 12V gearmotor, or E-Stop.',
    );
  }
  return matches[0];
}

export const componentById = (id: string) => COMPONENTS.find((c) => c.id === id) ?? CATALOGUE_COMPONENTS.find((c) => c.id === id);

/* Generated compact input table from catalog/parts.json. These proxies deliberately
 * have no mounting coordinates or electrical terminals. Keep this module standalone. */
type CatalogueEnvelopeRow = [string,string,string,string,string,Record<string,unknown>];
const CATALOGUE_ENVELOPE_ROWS: CatalogueEnvelopeRow[] = [["lipo_4s_5200","LiPo battery 4S 5200 mAh","power","assets/img/parts/lipo_4s_5200.jpg","generic 4S LiPo pack (manufacturer datasheet values)",{"capacity_mah":5200,"chemistry":"lipo","connector":"XT60","voltage_v":14.8}],["lipo_4s_1500","LiPo battery 4S 1500 mAh (5-inch quad)","power","assets/img/parts/lipo_4s_1500.jpg","generic 4S quad pack",{"capacity_mah":1500,"chemistry":"lipo","connector":"XT60","voltage_v":14.8}],["lipo_3s_2200","LiPo battery 3S 2200 mAh","power","assets/img/parts/lipo_3s_2200.jpg","generic 3S LiPo pack",{"capacity_mah":2200,"chemistry":"lipo","connector":"XT60","voltage_v":11.1}],["buck_converter_5v","Buck converter 5 V / 5 A","power","assets/img/parts/buck_converter_5v.jpg","generic synchronous buck module",{"input_v_max":24,"output_a":5,"output_v":5.0}],["lipo_balance_charger","LiPo balance charger","power","assets/img/parts/lipo_balance_charger.jpg","generic balance charger",{"cells":"1-6S","charge_a_max":6}],["xt60_pigtail","XT60 pigtail lead","cables_connectors","assets/img/parts/xt60_pigtail.jpg","generic XT60 pigtail",{"connector":"XT60","gauge_awg":14}],["silicone_wire_14awg","Silicone wire 14 AWG (per metre)","cables_connectors","assets/img/parts/silicone_wire_14awg.jpg","generic silicone hookup wire",{"gauge_awg":14}],["driver_tb6612fng","TB6612FNG dual motor driver","drivers","assets/img/parts/driver_tb6612fng.jpg","Toshiba TB6612FNG breakout (Pololu/SparkFun class)",{"channels":2,"current_a_per_channel":3.0,"voltage_v_max":13.5,"input_v_max":15.0,"logic_v":[2.7,5.5],"mass_g":0.14,"output_a":1.2,"voltage_v_min":2.5}],["driver_l298n","L298N dual motor driver module","drivers","assets/img/parts/driver_l298n.jpg","generic L298N module",{"channels":2,"current_a_per_channel":2,"voltage_v_max":35}],["esc_4in1_45a","4-in-1 ESC 45 A (BLHeli_S class)","drivers","assets/img/parts/esc_4in1_45a.jpg","generic 4-in-1 ESC",{"cells":"3-6S","channels":4,"current_a_per_channel":45}],["esc_quicrun_1060","Brushed ESC 60 A (QuicRun 1060 class)","drivers","assets/img/parts/esc_quicrun_1060.jpg","Hobbywing QuicRun WP 1060 class",{"cells":"2-3S","channels":1,"current_a":60}],["esp32_devkit","ESP32 development board","microcontrollers","assets/img/parts/esp32_devkit.jpg","Espressif ESP32 DevKit class",{"interfaces":["i2c","spi","uart","pwm","wifi","ble"],"logic_v":3.3}],["teensy_41","Teensy 4.1","microcontrollers","assets/img/parts/teensy_41.jpg","PJRC Teensy 4.1",{"interfaces":["i2c","spi","uart","can"],"logic_v":3.3}],["pico_rp2040","Raspberry Pi Pico (RP2040)","microcontrollers","assets/img/parts/pico_rp2040.jpg","Raspberry Pi Pico",{"interfaces":["i2c","spi","uart","pio"],"logic_v":3.3}],["raspberry_pi_5","Raspberry Pi 5","sbc","assets/img/parts/raspberry_pi_5.jpg","Raspberry Pi 5",{"interfaces":["usb","ethernet","csi","gpio"],"supply":"5V/5A USB-C"}],["jetson_orin_nano","NVIDIA Jetson Orin Nano","sbc","assets/img/parts/jetson_orin_nano.jpg","NVIDIA Jetson Orin Nano Series Data Sheet (DS-11105-001)",{"ai_performance":"up to 67 TOPS (8 GB, Super mode)","interfaces":["usb","ethernet","csi","pcie","i2c","uart","can","gpio"],"power_modes":"7 W / 15 W / 25 W","size":"69.6 × 45 mm module, 260-pin SO-DIMM","supply":"5 V module input"}],["microsd_128gb","microSD card 128 GB (A2/V30)","memory_storage","assets/img/parts/microsd_128gb.jpg","generic A2/V30 microSD",{"capacity_gb":128,"speed_class":"V30"}],["sik_telemetry_v3","SiK telemetry radio pair (915 MHz)","comms","assets/img/parts/sik_telemetry_v3.jpg","Holybro SiK Telemetry Radio V3 class",{"band_mhz":915,"interface":"uart"}],["elrs_receiver","ExpressLRS receiver","comms","assets/img/parts/elrs_receiver.jpg","generic ExpressLRS receiver",{"band_ghz":2.4,"interface":"crsf/uart"}],["realsense_d435","Intel RealSense D435 depth camera","cameras_sensors","assets/img/parts/realsense_d435.jpg","Intel RealSense D435",{"depth_range_m":"0.3-10","interface":"usb3","kind":"rgbd_camera"}],["rplidar_a1","RPLIDAR A1 2D lidar","cameras_sensors","assets/img/parts/rplidar_a1.jpg","SLAMTEC RPLIDAR A1",{"interface":"uart/usb","kind":"lidar_2d","range_m":12}],["imu_bno055","BNO055 9-DOF IMU breakout","cameras_sensors","assets/img/parts/imu_bno055.jpg","Bosch BNO055 breakout class",{"interface":"i2c","kind":"imu"}],["ultrasonic_hcsr04","HC-SR04 ultrasonic ranger","cameras_sensors","assets/img/parts/ultrasonic_hcsr04.jpg","generic HC-SR04",{"kind":"ultrasonic","logic_v":5.0,"range_m":4}],["pla_filament","PLA filament 1.75 mm, 1 kg","materials","assets/img/parts/pla_filament.jpg","generic PLA filament",{"density_g_cm3":1.19,"print_temp_c":"190-220","filament_diameter_mm":1.75,"spool_weight_g":1000.0}],["petg_filament","PETG filament 1.75 mm, 1 kg","materials","assets/img/parts/petg_filament.jpg","generic PETG filament",{"density_g_cm3":1.3,"print_temp_c":"230-250","bed_temp_c_max":70.0,"bed_temp_c_min":60.0,"filament_diameter_mm":1.75,"nozzle_temp_c_max":260.0,"nozzle_temp_c_min":240.0,"spool_weight_g":1000.0}],["fuse_inline","Inline blade fuse holder + fuse","safety_protection","assets/img/parts/fuse_inline.jpg","generic inline fuse holder",{"fuse_a":10,"gauge_awg":14}],["estop_button","Emergency stop button (latching)","safety_protection","assets/img/parts/estop_button.jpg","generic panel e-stop",{"action":"latching twist-release"}],["bms_4s","BMS protection board 4S 40 A","safety_protection","assets/img/parts/bms_4s.jpg","generic 4S BMS board",{"cells":"4S","current_a":40}],["custom_pcb_kicad","Custom PCB (KiCad import)","custom_boards","assets/img/parts/custom_pcb_kicad.jpg","imported from the builder's own KiCad project",{"import_from":"kicad_pcb/step","provenance":"CONFIRMED (design files)"}],["gearmotor_12v","DC gearmotor 12 V (37 mm class)","actuators","assets/img/parts/gearmotor_12v.jpg","generic 37D gearmotor class (pathfinder demo spec)",{"kind":"dc_gearmotor","stall_torque_nm":0.8,"voltage_v":12.0}],["brushed_motor_540","Brushed motor 540 size","actuators","assets/img/parts/brushed_motor_540.jpg","generic 540 RC motor",{"kind":"dc_brushed","voltage_v":7.4}],["servo_mg996r","MG996R servo","actuators","assets/img/parts/servo_mg996r.jpg","generic MG996R",{"interface":"pwm","kind":"servo_positional","torque_kg_cm":11,"voltage_v":"4.8-7.2"}],["servo_sts3215","STS3215 serial bus servo (Feetech)","actuators","assets/img/parts/servo_sts3215.jpg","Feetech STS3215",{"interface":"uart bus, position feedback","kind":"servo_serial_bus","torque_kg_cm":30,"voltage_v":7.4}],["stepper_nema17","Stepper motor NEMA 17","actuators","assets/img/parts/stepper_nema17.jpg","generic NEMA 17",{"holding_torque_nm":0.45,"kind":"stepper","steps_per_rev":200}],["brushless_2207_1960kv","Brushless motor 2207 1960 KV","actuators","assets/img/parts/brushless_2207_1960kv.jpg","generic 2207 FPV motor",{"cells":"4-6S","kind":"brushless_outrunner","kv":1960}],["wheel_100mm","Wheel 100 mm diameter","wheels","assets/img/parts/wheel.jpg","generic 100 mm robot wheel (pathfinder demo spec)",{"diameter_m":0.1,"width_m":0.032}],["mecanum_wheel_100mm","Mecanum wheel 100 mm","wheels","assets/img/parts/mecanum_wheel_100mm.jpg","generic mecanum wheel set",{"diameter_m":0.1,"note":"mecanum odometry is unreliable by design; gate heading checks differ"}],["caster_ball","Ball caster","wheels","assets/img/parts/caster.jpg","generic ball caster",{"kind":"caster"}],["propeller_5040","Propeller 5x4.0x3 tri-blade","propulsion_air","assets/img/parts/propeller_5040.jpg","generic 5040 tri-blade prop",{"blades":3,"diameter_in":5,"pitch_in":4.0}],["fc_f405_stack","Flight controller stack F405","flight_control","assets/img/parts/fc_f405_stack.jpg","generic F405 stack",{"firmware":"Betaflight/iNav class","mcu":"STM32F405"}],["gripper_2finger","2-finger parallel gripper kit","end_effectors","assets/img/parts/gripper_2finger.jpg","generic parallel gripper kit",{"actuation":"servo (not included)"}],["quad_frame_5inch","Quadcopter frame 5 inch (carbon)","structure","assets/img/parts/quad_frame_5inch.jpg","generic 5-inch freestyle frame",{"material":"carbon fibre","wheelbase_mm":220}],["extrusion_2020","Aluminium extrusion 2020 (per metre)","structure","assets/img/parts/extrusion_2020.jpg","generic 2020 extrusion",{"profile_mm":"20x20"}],["chassis_plate","Chassis plate (3D-printed)","structure","assets/img/parts/plate.jpg","RobotForge CAD kit (this repository)",{"kind":"flat_plate","origin":"generated per-robot by `robotforge cad`"}],["motor_mount","Motor mount bracket (3D-printed)","structure","assets/img/parts/mount.jpg","RobotForge CAD kit (this repository)",{"kind":"bracket","origin":"generated per-robot by `robotforge cad`"}],["lidar_mount","Lidar mount post (3D-printed)","structure","assets/img/parts/lidar.jpg","RobotForge CAD kit (this repository)",{"kind":"mount_post","origin":"generated per-robot by `robotforge cad`"}],["camera_bracket","Camera bracket (3D-printed)","structure","assets/img/parts/camera.jpg","RobotForge CAD kit (this repository)",{"kind":"bracket","origin":"generated per-robot by `robotforge cad`"}],["ultrasonic_bracket","Ultrasonic bracket (3D-printed)","structure","assets/img/parts/ultrasonic.jpg","RobotForge CAD kit (this repository)",{"kind":"bracket","origin":"generated per-robot by `robotforge cad`"}],["camera_rpi_v2","Raspberry Pi Camera Module V2 (8 MP)","cameras_sensors","assets/img/parts/camera_rpi_v2.jpg","Raspberry Pi Camera Module V2 (the camera in the official Andino BOM)",{"interface":"csi ribbon","kind":"rgb_camera","megapixels":8}],["liion_18650_3s","18650 Li-ion pack 3S (3 cells)","power","assets/img/parts/liion_18650_3s.jpg","generic 18650 cells in a 3-cell holder (the battery in the official Andino BOM)",{"capacity_mah":"varies by cell (2600 typical)","chemistry":"liion","voltage_v":11.1}],["servo_sg90","SG90 micro servo","actuators","assets/img/parts/servo_sg90.jpg","TowerPro SG90 class micro servo",{"kind":"servo_positional","mass_g":9,"torque_kg_cm":1.8,"voltage_v":"4.8-6.0"}],["servo_mg90s","MG90S micro servo (metal gear)","actuators","assets/img/parts/servo_mg90s.jpg","TowerPro MG90S class micro servo",{"kind":"servo_positional","mass_g":13.4,"torque_kg_cm":2.2,"voltage_v":"4.8-6.0"}],["servo_ds3218","DS3218 high-torque servo (20 kg class)","actuators","assets/img/parts/servo_ds3218.jpg","DSSERVO DS3218 class digital servo",{"kind":"servo_positional","torque_kg_cm":20,"voltage_v":"4.8-6.8"}],["stepper_28byj48","28BYJ-48 stepper motor with ULN2003 driver board","actuators","assets/img/parts/stepper_28byj48.jpg","generic 28BYJ-48 geared stepper set",{"kind":"stepper","steps_per_rev":2048,"voltage_v":5}],["stepper_nema23","NEMA 23 stepper motor","actuators","assets/img/parts/stepper_nema23.jpg","generic NEMA 23 (57 mm frame) stepper",{"frame_mm":"57x57","kind":"stepper","steps_per_rev":200}],["gearmotor_25ga370","25GA-370 DC gearmotor 12 V","actuators","assets/img/parts/gearmotor_25ga370.jpg","generic 25 mm gearbox DC motor",{"diameter_mm":25,"kind":"dc_gearmotor","voltage_v":12}],["gearmotor_tt","TT DC gearmotor (1:48, dual shaft)","actuators","assets/img/parts/gearmotor_tt.jpg","generic TT motor (yellow gearbox)",{"gear_ratio":"1:48","kind":"dc_gearmotor","voltage_v":"3-6"}],["brushless_2212_1000kv","2212 1000KV brushless outrunner","actuators","assets/img/parts/brushless_2212_1000kv.jpg","generic A2212 class outrunner",{"cells":"2-3S","kind":"brushless_outrunner","kv":1000}],["motor_775","775-size DC motor (12-24 V)","actuators","assets/img/parts/motor_775.jpg","generic 775 frame DC motor",{"kind":"dc_brushed","voltage_v":"12-24"}],["servo_hs645mg","Hitec HS-645MG servo","actuators","assets/img/parts/servo_hs645mg.jpg","Hitec HS-645MG (manufacturer datasheet values)",{"kind":"servo_positional","mass_g":55.2,"torque_kg_cm":9.6,"voltage_v":"4.8-6.0"}],["linear_actuator_12v","Linear actuator 12 V, 100 mm stroke","actuators","assets/img/parts/linear_actuator_12v.jpg","generic small linear actuator",{"kind":"linear_actuator","stroke_mm":100,"voltage_v":12}],["solenoid_12v","Push-pull solenoid 12 V","actuators","assets/img/parts/solenoid_12v.jpg","generic open-frame solenoid (JF-0530B class)",{"kind":"solenoid","voltage_v":12}],["driver_a4988","A4988 stepper driver (Pololu-style carrier)","drivers","assets/img/parts/driver_a4988.jpg","Allegro A4988 carrier board",{"input_v_max":35,"kind":"stepper_driver","microstep_max":16,"output_a":1}],["driver_drv8825","DRV8825 stepper driver (Pololu-style carrier)","drivers","assets/img/parts/driver_drv8825.jpg","TI DRV8825 carrier board",{"input_v_max":45,"kind":"stepper_driver","microstep_max":32,"output_a":1.5}],["driver_tmc2209","TMC2209 silent stepper driver","drivers","assets/img/parts/driver_tmc2209.jpg","Trinamic TMC2209 carrier board",{"input_v_max":29,"kind":"stepper_driver","microstep_max":256,"output_a":1.4}],["driver_bts7960","BTS7960 43 A H-bridge module","drivers","assets/img/parts/driver_bts7960.jpg","generic BTS7960 module",{"channels":1,"current_a":43,"kind":"h_bridge","voltage_v_max":27}],["driver_pca9685","PCA9685 16-channel PWM driver board","drivers","assets/img/parts/driver_pca9685.jpg","NXP PCA9685 breakout board",{"channels":16,"kind":"pwm_driver"}],["driver_l9110s","L9110S dual H-bridge module","drivers","assets/img/parts/driver_l9110s.jpg","generic L9110S module",{"channels":2,"current_a_per_channel":0.8,"voltage_v_max":12}],["esc_35a_blheli","35 A BLHeli_32 ESC","drivers","assets/img/parts/esc_35a_blheli.jpg","generic BLHeli_32 single ESC",{"cells":"2-6S","channels":1,"current_a":35,"kind":"esc_brushless"}],["arduino_uno_r3","Arduino Uno R3","microcontrollers","assets/img/parts/arduino_uno_r3.jpg","Arduino Uno R3 (ATmega328P)",{"clock_mhz":16,"logic_v":5,"mcu":"ATmega328P"}],["arduino_nano","Arduino Nano (classic)","microcontrollers","assets/img/parts/arduino_nano.jpg","Arduino Nano (ATmega328P)",{"clock_mhz":16,"logic_v":5,"mcu":"ATmega328P"}],["stm32_blue_pill","STM32 Blue Pill board (STM32F103C8T6)","microcontrollers","assets/img/parts/stm32_blue_pill.jpg","generic Blue Pill development board",{"clock_mhz":72,"logic_v":3.3,"mcu":"STM32F103C8T6"}],["esp32_s3_devkit","ESP32-S3 development board","microcontrollers","assets/img/parts/esp32_s3_devkit.jpg","Espressif ESP32-S3 dev board class",{"logic_v":3.3,"mcu":"ESP32-S3"}],["esp8266_nodemcu","NodeMCU ESP8266 development board","microcontrollers","assets/img/parts/esp8266_nodemcu.jpg","generic NodeMCU v2/v3 (ESP8266)",{"logic_v":3.3,"mcu":"ESP8266"}],["pico_w","Raspberry Pi Pico W","microcontrollers","assets/img/parts/pico_w.jpg","Raspberry Pi Pico W (RP2040)",{"logic_v":3.3,"mcu":"RP2040"}],["xiao_rp2040","Seeed Studio XIAO RP2040","microcontrollers","assets/img/parts/xiao_rp2040.jpg","Seeed Studio XIAO RP2040",{"logic_v":3.3,"mcu":"RP2040"}],["raspberry_pi_4b","Raspberry Pi 4 Model B","sbc","assets/img/parts/raspberry_pi_4b.jpg","Raspberry Pi 4 Model B",{"supply":"5V/3A USB-C"}],["raspberry_pi_zero_2_w","Raspberry Pi Zero 2 W","sbc","assets/img/parts/raspberry_pi_zero_2_w.jpg","Raspberry Pi Zero 2 W",{"supply":"5V/2.5A micro-USB"}],["jetson_nano","NVIDIA Jetson Nano developer kit","sbc","assets/img/parts/jetson_nano.jpg","NVIDIA Jetson Nano (original developer kit)",{"ai_performance":"472 GFLOPS","supply":"5V/4A barrel or 5V/2A micro-USB"}],["realsense_d455","Intel RealSense Depth Camera D455","cameras_sensors","assets/img/parts/realsense_d455.jpg","Intel RealSense D455 (manufacturer datasheet values)",{"depth_range_m":"0.6-6","kind":"rgbd_camera"}],["camera_rpi_v3","Raspberry Pi Camera Module 3","cameras_sensors","assets/img/parts/camera_rpi_v3.jpg","Raspberry Pi Camera Module 3 (IMX708)",{"autofocus":"phase-detection AF","kind":"rgb_camera","megapixels":12}],["camera_ov5647","OV5647 5 MP camera module (Pi camera v1 class)","cameras_sensors","assets/img/parts/camera_ov5647.jpg","generic OV5647 module for Raspberry Pi",{"kind":"rgb_camera","megapixels":5}],["tf_luna","Benewake TF-Luna LiDAR","cameras_sensors","assets/img/parts/tf_luna.jpg","Benewake TF-Luna (manufacturer datasheet values)",{"kind":"lidar_1d","range_m":8}],["vl53l0x_tof","VL53L0X time-of-flight distance sensor","cameras_sensors","assets/img/parts/vl53l0x_tof.jpg","ST VL53L0X breakout board",{"kind":"tof_distance","range_m":2}],["imu_mpu6050","MPU-6050 6-axis IMU module (GY-521)","cameras_sensors","assets/img/parts/imu_mpu6050.jpg","generic GY-521 module (MPU-6050)",{"kind":"imu"}],["sensor_bme280","BME280 environmental sensor","cameras_sensors","assets/img/parts/sensor_bme280.jpg","Bosch BME280 breakout board",{"kind":"temp_humidity_pressure"}],["sensor_dht22","DHT22 / AM2302 temperature-humidity sensor","cameras_sensors","assets/img/parts/sensor_dht22.jpg","Aosong DHT22 (AM2302)",{"kind":"temp_humidity"}],["sensor_ina219","INA219 current and voltage sensor board","cameras_sensors","assets/img/parts/sensor_ina219.jpg","TI INA219 breakout board",{"current_a":3.2,"kind":"current_sensor","voltage_v_max":26}],["gps_neom9n","u-blox NEO-M9N GPS module","cameras_sensors","assets/img/parts/gps_neom9n.jpg","u-blox NEO-M9N module board",{"kind":"gps"}],["encoder_hall","Hall-effect motor encoder (pair)","cameras_sensors","assets/img/parts/encoder_hall.jpg","generic hall encoder kit for gearmotors",{"kind":"encoder"}],["sensor_qmc5883l","QMC5883L 3-axis magnetometer","cameras_sensors","assets/img/parts/sensor_qmc5883l.jpg","generic QMC5883L compass module",{"kind":"magnetometer"}],["pir_hcsr501","HC-SR501 PIR motion sensor","cameras_sensors","assets/img/parts/pir_hcsr501.jpg","generic HC-SR501 module",{"kind":"pir_motion","range_m":7,"voltage_v":"5-12"}],["sharp_gp2y0a21","Sharp GP2Y0A21YK0F IR distance sensor","cameras_sensors","assets/img/parts/sharp_gp2y0a21.jpg","Sharp GP2Y0A21YK0F (manufacturer datasheet values)",{"kind":"ir_distance","range_cm":"10-80"}],["hx711_kit","HX711 load cell kit (5 kg cell + amplifier)","cameras_sensors","assets/img/parts/hx711_kit.jpg","generic HX711 + beam load cell kit",{"kind":"force"}],["lipo_2s_5000","LiPo battery 2S 5000 mAh","power","assets/img/parts/lipo_2s_5000.jpg","generic 2S LiPo pack",{"capacity_mah":5000,"chemistry":"lipo","connector":"XT60","voltage_v":7.4}],["lipo_6s_1300","LiPo battery 6S 1300 mAh","power","assets/img/parts/lipo_6s_1300.jpg","generic 6S LiPo pack",{"capacity_mah":1300,"chemistry":"lipo","connector":"XT60","voltage_v":22.2}],["liion_21700_cell","21700 Li-ion cell 3.7 V (5000 mAh class)","power","assets/img/parts/liion_21700_cell.jpg","generic 21700 cylindrical cell",{"capacity_mah":5000,"chemistry":"liion","voltage_v":3.7}],["buck_lm2596","LM2596 adjustable buck converter module","power","assets/img/parts/buck_lm2596.jpg","generic LM2596 module",{"input_v_max":40,"output_a":3,"output_v":"1.25-37 adjustable"}],["boost_mt3608","MT3608 boost converter module","power","assets/img/parts/boost_mt3608.jpg","generic MT3608 module",{"input_v_max":24,"input_v_min":2,"output_a":2,"output_v_max":28}],["pdb_xt60","Power distribution board with XT60 input","power","assets/img/parts/pdb_xt60.jpg","generic PDB for multirotors",{"connector":"XT60","kind":"pdb"}],["charger_imax_b6","iMAX B6 balance charger","power","assets/img/parts/charger_imax_b6.jpg","SkyRC iMAX B6 class charger",{"cells":"1-6S","charge_a_max":5}],["regulator_7805","7805 voltage regulator (TO-220)","power","assets/img/parts/regulator_7805.jpg","generic 7805 linear regulator",{"input_v_max":35,"output_a":1.5,"output_v":5}],["nimh_pack_72","NiMH battery pack 7.2 V, 3000 mAh","power","assets/img/parts/nimh_pack_72.jpg","generic 6-cell NiMH pack",{"capacity_mah":3000,"chemistry":"nimh","voltage_v":7.2}],["xt90_pigtail","XT90 pigtail (12 AWG)","cables_connectors","assets/img/parts/xt90_pigtail.jpg","generic XT90 pigtail",{"connector":"XT90","gauge_awg":12}],["xt30_pigtail","XT30 pigtail (18 AWG)","cables_connectors","assets/img/parts/xt30_pigtail.jpg","generic XT30 pigtail",{"connector":"XT30","gauge_awg":18}],["jst_ph_set","JST PH 2.0 mm connector set","cables_connectors","assets/img/parts/jst_ph_set.jpg","generic JST PH assortment",{"connector":"JST PH 2.0mm","kind":"connector_set"}],["dupont_kit","Dupont jumper wire kit","cables_connectors","assets/img/parts/dupont_kit.jpg","generic jumper wire assortment",{"kind":"jumper_wires"}],["wago_221","WAGO 221 lever-nut connectors (assortment)","cables_connectors","assets/img/parts/wago_221.jpg","WAGO 221 series",{"kind":"lever_nut","wire_range_awg":"24-12"}],["usb_c_cable_100w","USB-C to USB-C cable (100 W PD)","cables_connectors","assets/img/parts/usb_c_cable_100w.jpg","generic USB PD cable",{"connector":"USB-C","kind":"cable","power_w":100}],["qwiic_cable_set","QWIIC / STEMMA QT cable set","cables_connectors","assets/img/parts/qwiic_cable_set.jpg","generic JST SH 1.0 mm I2C cable set",{"connector":"JST SH 1.0mm","kind":"i2c_cables"}],["heat_shrink_kit","Heat-shrink tubing kit (assorted)","cables_connectors","assets/img/parts/heat_shrink_kit.jpg","generic heat-shrink assortment",{"kind":"heat_shrink"}],["wheel_65mm","Rubber wheel 65 mm (TT-motor fit)","wheels","assets/img/parts/wheel_65mm.jpg","generic 65 mm tyre + hub",{"diameter_m":0.065,"width_m":0.027}],["mecanum_wheel_48mm","Mecanum wheel 48 mm","wheels","assets/img/parts/mecanum_wheel_48mm.jpg","generic 48 mm mecanum wheel",{"diameter_m":0.048}],["wheel_130mm_pneumatic","Pneumatic wheel 130 mm","wheels","assets/img/parts/wheel_130mm_pneumatic.jpg","generic inflatable cart wheel",{"diameter_m":0.13,"kind":"pneumatic"}],["tank_track_set","Rubber tank track set (pair)","wheels","assets/img/parts/tank_track_set.jpg","generic track + sprocket kit",{"kind":"track_set"}],["omni_wheel_60mm","Omni wheel 60 mm","wheels","assets/img/parts/omni_wheel_60mm.jpg","generic double-row omni wheel",{"diameter_m":0.06,"kind":"omni"}],["extrusion_3030","Aluminium extrusion 3030 (per metre)","structure","assets/img/parts/extrusion_3030.jpg","generic 3030 extrusion",{"profile_mm":"30x30"}],["extrusion_2040","Aluminium extrusion 2040 (per metre)","structure","assets/img/parts/extrusion_2040.jpg","generic 2040 extrusion",{"profile_mm":"20x40"}],["bearing_608","608-2RS ball bearing","structure","assets/img/parts/bearing_608.jpg","generic 608-2RS bearing",{"bore_mm":8,"kind":"ball_bearing","outer_mm":22,"width_mm":7}],["gt2_belt","GT2 timing belt 6 mm (open, per metre)","structure","assets/img/parts/gt2_belt.jpg","generic GT2 belt",{"kind":"timing_belt","pitch_mm":2,"width_mm":6}],["gt2_pulley_20t","GT2 pulley 20T, 5 mm bore","structure","assets/img/parts/gt2_pulley_20t.jpg","generic GT2 pulley",{"bore_mm":5,"pitch_mm":2,"teeth":20}],["lead_screw_t8","T8 lead screw with brass nut (8 mm)","structure","assets/img/parts/lead_screw_t8.jpg","generic T8 screw set",{"diameter_mm":8,"kind":"lead_screw","lead_mm":8}],["linear_rail_mgn12","MGN12 linear rail with carriage","structure","assets/img/parts/linear_rail_mgn12.jpg","generic MGN12 rail set",{"kind":"linear_rail","width_mm":12}],["coupler_5x8","Flexible shaft coupler 5 x 8 mm","structure","assets/img/parts/coupler_5x8.jpg","generic beam coupler",{"bore_mm":"5x8","kind":"coupler"}],["standoff_kit_m3","M3 brass standoff kit (assorted)","structure","assets/img/parts/standoff_kit_m3.jpg","generic standoff assortment",{"kind":"standoffs","thread":"M3"}],["screw_kit_m3","M3 socket-head screw kit (assorted lengths)","structure","assets/img/parts/screw_kit_m3.jpg","generic screw assortment",{"kind":"fastener_kit","thread":"M3"}],["heat_inserts_m3","M3 heat-set thread inserts","structure","assets/img/parts/heat_inserts_m3.jpg","generic knurled brass inserts (CNC Kitchen pattern)",{"kind":"heat_set_insert","thread":"M3"}],["angle_bracket_2020","2020 corner bracket set","structure","assets/img/parts/angle_bracket_2020.jpg","generic cast corner brackets",{"kind":"corner_bracket","profile_mm":"20x20"}],["carbon_tube_10mm","Carbon fibre tube 10 mm OD (per metre)","structure","assets/img/parts/carbon_tube_10mm.jpg","generic pultruded carbon tube",{"diameter_mm":10,"kind":"tube","material":"carbon fibre"}],["abs_filament","ABS filament 1.75 mm, 1 kg","materials","assets/img/parts/abs_filament.jpg","generic ABS filament",{"density_g_cm3":1.05,"filament_diameter_mm":1.75,"print_temp_c":"230-250","spool_weight_g":1000}],["pc_filament","Polycarbonate filament 1.75 mm, 1 kg","materials","assets/img/parts/pc_filament.jpg","generic polycarbonate filament",{"filament_diameter_mm":1.75,"spool_weight_g":1000}],["hips_filament","HIPS filament 1.75 mm, 1 kg","materials","assets/img/parts/hips_filament.jpg","generic HIPS filament",{"filament_diameter_mm":1.75,"spool_weight_g":1000}],["resin_standard","Standard photopolymer resin, 1 kg (405 nm)","materials","assets/img/parts/resin_standard.jpg","generic SLA resin",{"kind":"resin","wavelength_nm":405}],["plywood_baltic_3mm","Baltic birch plywood sheet 3 mm","materials","assets/img/parts/plywood_baltic_3mm.jpg","generic Baltic birch ply",{"kind":"sheet","material":"birch plywood","thickness_mm":3}],["nrf24l01","nRF24L01+ 2.4 GHz radio module","comms","assets/img/parts/nrf24l01.jpg","Nordic nRF24L01+ module",{"band_ghz":2.4}],["lora_rfm95w","LoRa radio module 915 MHz (RFM95W)","comms","assets/img/parts/lora_rfm95w.jpg","HopeRF RFM95W module/breakout",{"band_mhz":915}],["ble_hm10","HM-10 BLE Bluetooth module","comms","assets/img/parts/ble_hm10.jpg","generic HM-10 module (CC2541)",{"band_ghz":2.4}],["can_transceiver_sn65hvd230","SN65HVD230 CAN bus transceiver board","comms","assets/img/parts/can_transceiver_sn65hvd230.jpg","TI SN65HVD230 board (Waveshare pattern)",{"logic_v":3.3}],["usb_ttl_cp2102","CP2102 USB-to-UART adapter","comms","assets/img/parts/usb_ttl_cp2102.jpg","generic CP2102 adapter board",{"logic_v":3.3}],["lipo_alarm","LiPo low-voltage alarm (1-8S)","safety_protection","assets/img/parts/lipo_alarm.jpg","generic balance-lead voltage alarm",{"cells":"1-8S","kind":"voltage_alarm"}],["antispark_xt90s","XT90-S anti-spark connector (pair)","safety_protection","assets/img/parts/antispark_xt90s.jpg","Amass XT90-S",{"connector":"XT90-S","kind":"anti_spark_connector"}],["breaker_30a","Manual-reset circuit breaker 30 A","safety_protection","assets/img/parts/breaker_30a.jpg","generic automotive breaker",{"current_a":30,"kind":"circuit_breaker"}],["microsd_256gb","microSD card 256 GB (V30)","memory_storage","assets/img/parts/microsd_256gb.jpg","generic branded microSD",{"capacity_gb":256,"speed_class":"V30"}],["nvme_1tb","M.2 2280 NVMe SSD 1 TB","memory_storage","assets/img/parts/nvme_1tb.jpg","generic NVMe SSD",{"capacity_gb":1000}],["fc_pixhawk_6c","Holybro Pixhawk 6C flight controller","flight_control","assets/img/parts/fc_pixhawk_6c.jpg","Holybro Pixhawk 6C",{"firmware":"PX4 / ArduPilot","mcu":"STM32H743"}],["propeller_6040","Propeller 6x4 (pair)","propulsion_air","assets/img/parts/propeller_6040.jpg","generic 6040 propellers",{"blades":2,"diameter_in":6,"pitch_in":4}],["electromagnet_12v","Electromagnet 12 V (holding)","end_effectors","assets/img/parts/electromagnet_12v.jpg","generic round holding magnet",{"kind":"electromagnet","voltage_v":12}],["gripper_parallel_kit","Parallel gripper kit (servo-driven)","end_effectors","assets/img/parts/gripper_parallel_kit.jpg","generic parallel-jaw gripper kit",{"actuation":"servo (not included)","kind":"gripper"}],["perfboard_set","Perfboard / protoboard set","custom_boards","assets/img/parts/perfboard_set.jpg","generic FR4 perfboard assortment",{"kind":"perfboard"}],["motor_2306_1750kv","2306 1750KV brushless motor","actuators","assets/img/parts/motor_2306_1750kv.jpg","generic 2306 stator outrunner",{"cells":"4-6S","kind":"brushless_outrunner","kv":1750}],["vex_v5_brain","VEX V5 Robot Brain","microcontrollers","assets/img/parts/vex_v5_brain.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","smart_ports":21,"three_wire_ports":8,"screen":"4.25 in colour touchscreen"}],["vex_v5_m11w","VEX V5 Smart Motor (11 W)","actuators","assets/img/parts/vex_v5_m11w.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"vex_v5_smart_motor","peak_power_w":11,"voltage_v":12.8,"cartridges":{"red_36_1":{"free_rpm":100,"stall_torque_nm":2.1},"green_18_1":{"free_rpm":200,"stall_torque_nm":1.05},"blue_6_1":{"free_rpm":600,"stall_torque_nm":0.35}},"encoder":"built in"}],["vex_v5_m5w5","VEX V5 Smart Motor (5.5 W)","actuators","assets/img/parts/vex_v5_m5w5.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"vex_v5_smart_motor","peak_power_w":5.5,"voltage_v":12.8,"free_rpm":200,"cartridge":"fixed (200 rpm)"}],["vex_v5_batt","VEX V5 Robot Battery (Li-ion, 1100 mAh)","power","assets/img/parts/vex_v5_batt.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","chemistry":"liion","voltage_v":12.8,"capacity_mah":1100}],["vex_v5_ctrl","VEX V5 Controller","comms","assets/img/parts/vex_v5_ctrl.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","joysticks":2,"buttons":12,"screen":"monochrome"}],["vex_v5_vexnet","VEX V5 Robot Radio","comms","assets/img/parts/vex_v5_vexnet.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","link":"VEXnet 3 / Bluetooth; VEXlink robot-to-robot"}],["vex_omni4","VEX 4 in omni-directional wheel","wheels","assets/img/parts/vex_omni4.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","kind":"omni","diameter_m":0.1016,"diameter_in":4}],["vex_omni325","VEX 3.25 in omni-directional wheel","wheels","assets/img/parts/vex_omni325.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","kind":"omni","diameter_m":0.08255,"diameter_in":3.25}],["vex_omni275","VEX 2.75 in omni-directional wheel","wheels","assets/img/parts/vex_omni275.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","kind":"omni","diameter_m":0.06985,"diameter_in":2.75}],["vex_trac325","VEX 3.25 in traction wheel","wheels","assets/img/parts/vex_trac325.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","kind":"traction","diameter_m":0.08255,"diameter_in":3.25}],["vex_mec4","VEX 4 in mecanum wheel","wheels","assets/img/parts/vex_mec4.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","kind":"mecanum","diameter_m":0.1016,"diameter_in":4}],["vex_cchan","VEX aluminum C-channel (1x2x1)","structure","assets/img/parts/vex_cchan.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","material":"aluminum","profile":"1x2x1 C-channel","hole_pitch_in":0.5}],["vex_hsgear","VEX high-strength gears (12-84 teeth)","structure","assets/img/parts/vex_hsgear.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex","teeth":[12,36,48,60,72,84],"shaft":"high-strength square"}],["vex_v5_imu","VEX V5 Inertial Sensor","cameras_sensors","assets/img/parts/vex_v5_imu.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"imu","axes":"3-axis gyro + 3-axis accelerometer"}],["vex_v5_rot","VEX V5 Rotation Sensor","cameras_sensors","assets/img/parts/vex_v5_rot.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"encoder","absolute":true}],["vex_v5_dist","VEX V5 Distance Sensor","cameras_sensors","assets/img/parts/vex_v5_dist.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"time_of_flight"}],["vex_v5_opt","VEX V5 Optical Sensor","cameras_sensors","assets/img/parts/vex_v5_opt.jpg","VEX Robotics V5 product documentation (vexrobotics.com, kb.vex.com)",{"platform":"vex_v5","kind":"colour_proximity"}]];
export const CATALOGUE_COMPONENTS: ComponentDefinition[] = CATALOGUE_ENVELOPE_ROWS.map(([id,name,cls,image,source,s]) => {
  const number = (k:string):number|null => typeof s[k]==='number' && Number.isFinite(s[k]) && Number(s[k])>0 ? Number(s[k]) : null;
  const category:ComponentCategory = ['sbc','microcontrollers','custom_boards'].includes(cls)?'compute':cls==='power'?'power':cls==='cameras_sensors'?'sensor':cls==='safety_protection'?'safety':'drive';
  const fallback:[number,number,number] = cls==='wheels'?[.1,.032,.1]:cls==='structure'?[.08,.05,.006]:cls==='actuators'?[.07,.037,.037]:category==='compute'?[.085,.056,.025]:category==='power'?[.10,.04,.03]:[.045,.035,.025];
  const measured = [number('length_m')??(number('length_mm')===null?null:number('length_mm')!/1000),number('width_m')??(number('width_mm')===null?null:number('width_mm')!/1000),number('height_m')??(number('height_mm')===null?null:number('height_mm')!/1000)];
  if(cls==='wheels'){const diameter=number('diameter_m')??(number('diameter_mm')===null?null:number('diameter_mm')!/1000);if(diameter){measured[0]=diameter;measured[2]=diameter;}}
  const known = measured.every(v=>v!==null);
  const mass=number('mass_kg')??(number('mass_g')===null?0:number('mass_g')!/1000);
  return {id:'catalog--'+id,name,aliases:[],category,sizeM:measured.map((v,i)=>v??fallback[i]) as [number,number,number],massKg:mass,geometry:known?'published-envelope':'illustrative',image,imageCaption:'Catalogue planning envelope; verify actual hardware',source,note:'ESTIMATED placement proxy; envelope only, not manufacturer CAD.',missing:[...(!known?['Measured dimensions']:[]),...(!mass?['Measured mass']:[]),'Mounting-hole coordinates','Electrical terminals and pinout'],mounting:{kind:'standoffs-m3',fastener:'Unknown — measure actual mounting interface',holePatternMm:[],holeDiameterMm:0,standoffHeightMm:0,preferredZone:'center-deck',notes:'No mounting coordinates recorded; do not infer holes from the envelope.'},orientation:{preferredYawDeg:0,forwardAxisLabel:'Illustrative orientation; confirm on hardware',requiresPerimeterClearance:false,fovDeg:null,fovRangeM:null,keepoutFrontMm:0,thermalClearanceTopMm:0},terminals:[]};
});
