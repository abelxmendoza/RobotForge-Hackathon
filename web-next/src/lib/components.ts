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
      'Choose a supported component: Jetson Orin Nano (NVIDIA reference kit), Raspberry Pi 5, battery placeholder, 3S LiPo, buck converter, motor driver, RealSense D435, RPLIDAR A1, HC-SR04 ultrasonic, 9-DoF IMU, 12V gearmotor, or E-Stop.',
    );
  }
  return matches[0];
}

export const componentById = (id: string) => COMPONENTS.find((c) => c.id === id);
