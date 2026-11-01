/* Data for the standalone kit page (kit.html): the Burger's
 * parametric OpenSCAD modules, the generated-kit part metadata
 * (window.PD in vanilla, here built from the live catalogue data),
 * and the specimen (real model) types. The SCAD text is byte-for-byte
 * the vanilla kit.html content. */
import type { CatalogPart } from '../forge/data';

/* ---------------- OpenSCAD (verbatim from kit.html) ---------------- */

export const SCAD_MODULES: Record<string, string> = {
  chassis: `// Chassis plates — two 178 x 138 mm plates (Burger footprint)
module chassis_plate(){ cube([178,138,10], center=true); }
module chassis(){ translate([0,0,75]) chassis_plate(); translate([0,0,145]) chassis_plate(); }`,
  battery: `// Battery pack — 3S 2200 mAh class pack between the plates
module battery(){ translate([0,0,105]) cube([95,60,35], center=true); }`,
  sbc: `// Onboard computer — Pi-class board on the top plate
module sbc(){ translate([-20,0,155]) cube([85,56,6], center=true); }`,
  driver: `// Motor driver — TB6612FNG-class dual H-bridge board
module driver(){ translate([45,0,153]) cube([45,45,5], center=true); }`,
  lidar: `// 2D lidar — RPLIDAR-class turret, 70 mm diameter
module lidar(){ translate([45,0,192]) cylinder(h=34, d=70, center=true, $fn=48); }`,
  motors: `// Gear motors x2 — inboard of the driven wheels
module motors(){ for (s=[1,-1]) translate([0, s*62, 36]) rotate([90,0,0]) cylinder(h=32, d=26, center=true, $fn=32); }`,
  wheels: `// Driven wheels x2 — 66 mm dia x 21 mm (the dimension the gate grades)
module wheels(){ for (s=[1,-1]) translate([0, s*80, 36]) rotate([90,0,0]) cylinder(h=21, d=66, center=true, $fn=48); }`,
  caster: `// Caster balls x2 — passive supports, 33 mm spheres
module caster(){ for (s=[1,-1]) translate([s*62, 0, 16.5]) sphere(d=33, $fn=32); }`,
};

export function assemblyScad(e: number): string {
  const mods = Object.entries(SCAD_MODULES)
    .map(([k, src]) => {
      let m = src;
      if (k === 'lidar')
        m = m.replace('translate([45,0,192])', 'translate([45,0,192 + 160*explode])');
      if (k === 'sbc')
        m = m.replace('translate([-20,0,155])', 'translate([-20,0,155 + 88*explode])');
      if (k === 'driver')
        m = m.replace(
          'translate([45,0,153])',
          'translate([45 + 50*explode,0,153 + 56*explode])',
        );
      if (k === 'chassis')
        m = m
          .replace('translate([0,0,75])', 'translate([0,0,75 + 8*explode])')
          .replace('translate([0,0,145])', 'translate([0,0,145 + 24*explode])');
      if (k === 'battery')
        m = m.replace('translate([0,0,105])', 'translate([0,0,105 - 88*explode])');
      if (k === 'motors') m = m.replace('s*62', 's*(62 + 28*explode)');
      if (k === 'wheels') m = m.replace('s*80', 's*(80 + 55*explode)');
      if (k === 'caster')
        m = m.replace(
          'translate([s*62, 0, 16.5])',
          'translate([s*(62 + 30*explode), 0, 16.5 - 60*explode])',
        );
      return m;
    })
    .join('\n\n');
  const calls = Object.keys(SCAD_MODULES)
    .map((k) => `${k}();`)
    .join('\n');
  return `// RobotForge take-apart kit - TurtleBot3 Burger (parametric, mm)
// Generated from the same parameters as the 3D viewer on robotforge's parts page.
// Set explode = 0 for the assembled robot, 1 for the fully exploded kit.
explode = ${e.toFixed(2)};
$fn = 32;

${mods}

// Assembly
${calls}`;
}

export function partScad(k: string): string {
  return `// RobotForge kit part: ${k} (mm)\n` + SCAD_MODULES[k] + `\n${k}();`;
}

/* ---------------- generated-kit part details (window.PD) ------------- */

export const GENERATED_KEYS = [
  'lidar',
  'sbc',
  'chassis',
  'battery',
  'driver',
  'motors',
  'wheels',
  'caster',
] as const;
export type GeneratedKey = (typeof GENERATED_KEYS)[number];

export const PD_META: Record<
  GeneratedKey,
  { title: string; blurb: string; partName: string }
> = {
  lidar: {
    title: '2D lidar',
    blurb: "Scans the room 360° — the robot's sense of where things are.",
    partName: 'RPLIDAR A1 2D lidar',
  },
  sbc: {
    title: 'Onboard computer',
    blurb: "Runs the robot's brain: navigation, decisions, radio home.",
    partName: 'Raspberry Pi 5',
  },
  chassis: {
    title: 'Chassis plate',
    blurb:
      'The skeleton everything bolts to. In the CAD kit this is its own OpenSCAD file.',
    partName: 'Aluminium extrusion 2020 (per metre)',
  },
  battery: {
    title: 'Battery pack',
    blurb:
      "Stored energy. The forge's validator refuses specs whose motors out-voltage the pack.",
    partName: 'LiPo battery 3S 2200 mAh',
  },
  driver: {
    title: 'Motor driver',
    blurb: 'Turns brain signals into wheel power — two channels, one per side.',
    partName: 'TB6612FNG dual motor driver',
  },
  motors: {
    title: 'Gear motors ×2',
    blurb: 'The muscles. Torque here decides whether the robot climbs or stalls.',
    partName: 'DC gearmotor 12 V (37 mm class)',
  },
  wheels: {
    title: 'Driven wheels ×2',
    blurb:
      'Where the paperwork meets the floor — the gate exists because these lie.',
    partName: 'Wheel 100 mm diameter',
  },
  caster: {
    title: 'Caster ball',
    blurb: 'The passive third contact: carries the tail without steering it.',
    partName: 'Ball caster',
  },
};

/* Spec values in the catalogue print the way the Python generator
 * printed them in kit.html: floats keep their decimal (12.0, 5.0).
 * JSON.parse cannot tell 12 from 12.0, so the keys whose values are
 * floats in catalog/parts.json are named here; an integer value
 * under one of them prints with .0, every other integer plainly. */
const FLOAT_KEYS = new Set(['voltage_v', 'logic_v', 'output_v', 'pitch_in']);

export function fmtSpecValue(key: string, v: unknown): string {
  if (Array.isArray(v)) {
    return (
      '[' +
      v
        .map((x) => (typeof x === 'string' ? "'" + x + "'" : String(x)))
        .join(', ') +
      ']'
    );
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && FLOAT_KEYS.has(key)) return v.toFixed(1);
    return String(v);
  }
  return String(v);
}

export function fmtSpecs(part: CatalogPart): string {
  return Object.keys(part.specs || {})
    .sort()
    .map(
      (k) =>
        k.replace(/_/g, ' ') + ': ' + fmtSpecValue(k, (part.specs || {})[k]),
    )
    .join(', ');
}

export function classLabel(part: CatalogPart): string {
  return part.part_class.replace(/_/g, ' ');
}

/* ---------------- specimen (real model) ---------------- */

export interface SpecimenPart {
  id: string;
  name: string;
  role: string;
  tier: 'REAL_MESH' | 'COLLISION_BOX' | 'FRAME_ONLY';
  position: [number, number, number];
  quaternion: [number, number, number, number];
  explode: [number, number, number];
  mass_kg?: number;
  material?: string;
  color_rgba?: [number, number, number, number];
  mesh_file?: string;
  mesh_url?: string;
  scale?: number;
  collision_box_m?: [number, number, number];
  related_catalog_parts?: { part: string; note: string }[];
}

export interface SpecimenDoc {
  dex_id?: string;
  robot?: string;
  annotation_note?: string;
  honesty: string[];
  source: {
    repo: string;
    commit: string;
    urdf?: string;
    package?: string;
    license: string;
    retrieved?: string;
  };
  parts: SpecimenPart[];
}

export const TIER_LABEL: Record<SpecimenPart['tier'], string> = {
  REAL_MESH: 'Real mesh — official model',
  COLLISION_BOX: 'Collision box — no visual mesh published',
  FRAME_ONLY: 'Frame only — no geometry published',
};

/* ---------------- SimReady bench props (external assets) ------------- */
/* Bench dressing from NVIDIA's SimReady dataset (CC BY 4.0), converted
 * to web-sized glTF by RobotForge. The manifest of record lives in the
 * repo at catalog/props/simready/props.json (source packages, license,
 * per-prop attribution, sizes, hashes, conversion notes); the copy the
 * scene fetches is materialized next to the models at build time by
 * web-next/scripts/make-simready-props.mjs. Props are environment
 * dressing only — never kit parts, never gate-checked. */

export interface SimReadyProp {
  id: string;
  name: string;
  file: string;
  source_package: string;
  source_url: string;
  root_usd: string;
  attribution: string;
  size_m: [number, number, number];
  triangles: number;
  optimized_bytes: number;
  sha256: string;
  position_xy_m: [number, number];
  rotation_y_rad: number;
}

export interface SimReadyManifest {
  dataset: string;
  dataset_url: string;
  license: string;
  license_note: string;
  retrieved: string;
  honesty: string[];
  props: SimReadyProp[];
}
