/** Parametric mounting artifacts. Units are mm; catalogue mounting patterns remain unverified. */
export interface MountPart {
  name: string;
  sizeM: [number, number, number];
  source: string;
  mounting: { holePatternMm: [number, number][]; holeDiameterMm: number; notes: string };
}
export interface MountOptions { lengthMm: number; widthMm: number; thicknessMm: number; holeDiameterMm: number }
export interface MountArtifact extends MountOptions {
  holes: [number, number][];
  source: string;
  filename: string;
  warnings: string[];
  bedFit: boolean;
}
const number = (n: number) => Number(n.toFixed(3));
const comment = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, ' ');
export function mountDefaults(part: MountPart): MountOptions {
  return { lengthMm: number(part.sizeM[0] * 1000 + 12), widthMm: number(part.sizeM[1] * 1000 + 12), thicknessMm: 3, holeDiameterMm: part.mounting.holeDiameterMm || 3.2 };
}
export function generateMount(options: MountOptions, part: MountPart): MountArtifact {
  for (const [label, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || value <= 0 || value > 600) throw new RangeError(label + ' must be a finite size between 0 and 600 mm.');
  }
  options = { lengthMm: number(options.lengthMm), widthMm: number(options.widthMm), thicknessMm: number(options.thicknessMm), holeDiameterMm: number(options.holeDiameterMm) };
  const { lengthMm, widthMm, thicknessMm, holeDiameterMm } = options;
  if (Object.values(options).some(n => n <= 0)) throw new RangeError('Dimensions must remain positive at 0.001 mm precision.');
  if (thicknessMm < 0.5 || thicknessMm > 30) throw new RangeError('Plate thickness must be between 0.5 and 30 mm.');
  if (!part.sizeM.every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Component dimensions must be recorded first.');
  if (lengthMm < part.sizeM[0] * 1000 || widthMm < part.sizeM[1] * 1000) throw new RangeError('Plate must cover the component footprint.');
  const holes = part.mounting.holePatternMm.map(p => [...p] as [number, number]);
  const radius = holeDiameterMm / 2;
  for (let i = 0; i < holes.length; i++) {
    const [x,y] = holes[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) + radius + 2 > lengthMm / 2 || Math.abs(y) + radius + 2 > widthMm / 2) {
      throw new RangeError('Each mounting hole needs at least 2 mm of material to the plate edge.');
    }
    if (holes.slice(0,i).some(([a,b]) => Math.hypot(x-a,y-b) < holeDiameterMm+2)) throw new RangeError('Mounting holes overlap or leave less than 2 mm between holes.');
  }
  if (holeDiameterMm > Math.min(lengthMm,widthMm) / 4) throw new RangeError('Hole diameter is too large for this plate.');
  const bedFit = lengthMm <= 220 && widthMm <= 220;
  const warnings = ['UNVERIFIED mounting pattern: confirm the physical part, hole coordinates and screw clearance before printing.', 'Plate geometry only: standoffs, fastener strength, thermal clearance and chassis attachment are not verified.'];
  if (!holes.length) warnings.push('No mounting pattern is recorded; this is a blank plate with no invented holes.');
  if (!bedFit) warnings.push('Plate exceeds the assumed 220 × 220 mm printer bed; use a larger bed or redesign.');
  const source = [
    '// RobotForge generated component mounting plate — PLANNED / UNVERIFIED',
    '// Component: ' + comment(part.name), '// Reference: ' + comment(part.source),
    '// Mounting notes: ' + comment(part.mounting.notes),
    '// Component mounting coordinates come from the catalogue; measure before printing.',
    'plate_length_mm = ' + number(lengthMm) + ';',
    'plate_width_mm = ' + number(widthMm) + ';',
    'plate_thickness_mm = ' + number(thicknessMm) + ';',
    'hole_diameter_mm = ' + number(holeDiameterMm) + ';',
    '$fn = 64;', 'difference() {',
    '  translate([-plate_length_mm/2, -plate_width_mm/2, 0]) cube([plate_length_mm, plate_width_mm, plate_thickness_mm]);',
    ...holes.map(([x,y]) => '  translate([' + number(x) + ', ' + number(y) + ', -1]) cylinder(h=plate_thickness_mm+2, d=hole_diameter_mm);'),
    '}', '',
  ].join('\n');
  return { ...options, holes, bedFit, source, filename: 'component-mount.scad', warnings };
}

/** Conservative usable space reserves the complete lid-lip band at the top. */
export function enclosureFit(box: {length_mm:number; width_mm:number; height_mm:number; wall_mm:number}, part: {sizeM:[number,number,number];mounting:{standoffHeightMm?:number}}) {
  const length = number(box.length_mm-2*box.wall_mm);
  const width = number(box.width_mm-2*box.wall_mm);
  const height = number(box.height_mm-2*box.wall_mm);
  const requiredHeight = part.sizeM[2]*1000+(part.mounting.standoffHeightMm ?? 0);
  return {length,width,height,fits:[length,width,height,requiredHeight].every(Number.isFinite)&&length>=part.sizeM[0]*1000&&width>=part.sizeM[1]*1000&&height>=requiredHeight};
}
