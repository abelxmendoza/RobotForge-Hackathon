/* Rover kit: the rover designer's steps (parts, chassis CAD, build
 * package) as Wrench commands and one Workshop panel, instead of a
 * separate five-step flow. Pure helpers; no persistence here. */
import { parseBrief, type CataloguePart, type ForgeSpec } from './forgeEngine';
import { createRoverConcept, defaultRoverRequirements, seedRoverAssembly, reconcileRoverAssembly, type RoverRequirements } from './roverDesign';
import type { RoverCadSettings } from './roverPackage';

export const ROVER_KIT_EVENT = 'rf-rover-kit';
export type RoverKitCommand =
  | { kind: 'open' }
  | { kind: 'export' }
  | { kind: 'swap'; role: string; part: string }
  | { kind: 'chassis'; lengthMm: number; widthMm: number; thicknessMm?: number };
export interface RoverKitResult { command: RoverKitCommand; handled: boolean; message: string }

const ROLE_WORDS: Record<string, string> = {
  motor: 'motor', motors: 'motor', wheel: 'wheel', wheels: 'wheel', battery: 'battery',
  regulator: 'regulator', 'motor driver': 'driver', driver: 'driver', controller: 'controller',
  computer: 'controller', board: 'controller', caster: 'caster', lidar: 'lidar', imu: 'imu',
  ultrasonic: 'ultrasonic', sonar: 'ultrasonic', 'depth camera': 'depth_camera', camera: 'camera',
};

/** Words that drive the rover kit, or null. Only clear commands match. */
export function parseRoverKitCommand(text: string): RoverKitCommand | null {
  if (/\?\s*$/.test(text) || /^\s*(how|what|why|when|can|could|should|does|do|is)\b/i.test(text)) return null; // questions get answers, not actions
  const q = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(open|show)( the)? (rover kit|build kit|kit)$/.test(q)) return { kind: 'open' };
  if (/\b(export|download|make|give me)\b.*\b(build (package|kit)|rover kit|kit zip|package zip|cad files?|stl files?)\b/.test(q)) return { kind: 'export' };
  const swap = q.match(/\b(?:swap|replace|change|switch)\s+(?:the\s+|my\s+)?(motor driver|depth camera|[a-z]+?)s?\s+(?:for|with|to)\s+(?:an?\s+|the\s+)?(.{2,80})$/);
  if (swap) {
    const role = ROLE_WORDS[swap[1]] ?? ROLE_WORDS[swap[1] + 's'];
    if (role) return { kind: 'swap', role, part: swap[2].trim() };
  }
  const chassis = q.match(/\bchassis\b[^\d]{0,30}(\d{2,4}(?:\.\d+)?)\s*(?:mm)?\s*(?:x|×|by)\s*(\d{2,4}(?:\.\d+)?)\s*(?:mm)?(?:\s*(?:x|×|by)\s*(\d{1,2}(?:\.\d+)?)\s*(?:mm)?)?/);
  if (chassis) {
    const [l, w, t] = [Number(chassis[1]), Number(chassis[2]), chassis[3] ? Number(chassis[3]) : undefined];
    if (l >= 20 && l <= 2000 && w >= 20 && w <= 2000 && (t === undefined || (t >= 1 && t <= 30))) return { kind: 'chassis', lengthMm: l, widthMm: w, thicknessMm: t };
  }
  return null;
}

/** Best catalogue option for a spoken part name, or null. */
export function matchPart(options: CataloguePart[], words: string): CataloguePart | null {
  const tokens = words.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').filter((t) => t.length > 1 || /\d/.test(t));
  if (!tokens.length) return null;
  let best: CataloguePart | null = null, score = 0, hitsBest = 0;
  for (const p of options) {
    const hay = ' ' + (String(p.name ?? '') + ' ' + p.id).toLowerCase().replace(/[^a-z0-9.]+/g, ' ') + ' ';
    const hits = tokens.filter((t) => (/^\d+$/.test(t) ? new RegExp(`[^0-9.]${t}(?![0-9.])`).test(hay) : hay.includes(t))).length;
    /* Fewer unmatched words wins a tie: "pi 4" is the Pi 4, not the Pico. */
    const s = hits - hay.trim().split(' ').length / 100;
    if (hits && s > score) { best = p; score = s; hitsBest = hits; }
  }
  return hitsBest >= Math.min(2, tokens.length) ? best : null;
}

/** A Wrench brief ("a compact mecanum rover with a lidar") as rover requirements, or null if it isn't a rover. */
export function roverRequirementsFromBrief(brief: string): RoverRequirements | null {
  const parsed = parseBrief(brief);
  if (parsed.archetype !== 'differential_rover' && parsed.archetype !== 'mecanum_rover') return null;
  if (/\b(arm|drone|quadcopter|multirotor|humanoid|biped|quadruped|legged)\b/i.test(brief)) return null;
  return {
    ...defaultRoverRequirements(),
    name: (parsed.name || 'New rover').split(/\s+(?:with|that|which|for|and|to|using)\b|[,.;]/i)[0].trim().slice(0, 100) || 'New rover',
    purpose: brief.trim().slice(0, 4000) || 'Explore an indoor environment',
    archetype: parsed.archetype,
    size: parsed.size,
    sensors: parsed.sensors.filter((s) => ['lidar', 'camera', 'depth_camera', 'imu', 'ultrasonic'].includes(s)),
  };
}

/** A name nobody else is using ("Generated Rover 2"). */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(name.trim().toLowerCase())) return name;
  for (let i = 2; i < 1000; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  return name + ' ' + Date.now();
}

/** A full rover kit (parts, assembly, CAD defaults) from a brief. */
export function roverKitFromBrief(req: RoverRequirements, cat: CataloguePart[], revisionId: string, at: string): ForgeSpec {
  return seedRoverAssembly(createRoverConcept(req, cat), revisionId, at);
}

/** An older planned rover concept upgraded to a rover kit, keeping its name and size. */
export function roverKitFromConcept(spec: ForgeSpec, name: string, cat: CataloguePart[], revisionId: string, at: string): ForgeSpec {
  const req: RoverRequirements = { ...defaultRoverRequirements(), name, purpose: String(spec.description || spec.conceptBrief || 'Continue this planned rover').slice(0, 4000), archetype: spec.drivetrain === 'mecanum' ? 'mecanum_rover' : 'differential_rover', size: spec.conceptSize || 'standard' };
  const next = JSON.parse(JSON.stringify(spec));
  next.roverDesign = createRoverConcept(req, cat).roverDesign;
  return seedRoverAssembly(next, revisionId, at);
}

export function canBeRoverKit(spec: ForgeSpec | undefined, planned: boolean | undefined): boolean {
  return !!spec && !!planned && !!spec.forge && ['differential', 'mecanum'].includes(String(spec.drivetrain));
}

/** Apply chassis CAD settings to a rover kit spec (sizes follow the plate). */
export function withCad(spec: ForgeSpec, cad: RoverCadSettings): ForgeSpec {
  const next = JSON.parse(JSON.stringify(spec));
  next.length_m = cad.chassis.lengthMm / 1000;
  next.width_m = cad.chassis.widthMm / 1000;
  next.roverDesign.cad = JSON.parse(JSON.stringify(cad));
  return reconcileRoverAssembly(next);
}

/** "10, 10" lines as hole coordinates; throws a short message on bad input. */
export function parseHoles(text: string): [number, number][] {
  if (!text.trim()) return [];
  return text.trim().split('\n').map((row) => {
    const pair = row.split(',').map((v) => v.trim());
    if (pair.length !== 2 || pair.some((v) => !v || !Number.isFinite(Number(v)))) throw new Error('Use one X, Y pair per line.');
    return [Number(pair[0]), Number(pair[1])] as [number, number];
  });
}

/** Ask the open Workshop to run a rover-kit command; says what happened. */
export function requestRoverKit(command: RoverKitCommand): RoverKitResult {
  const result: RoverKitResult = { command, handled: false, message: '' };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROVER_KIT_EVENT, { detail: result }));
  return result;
}
