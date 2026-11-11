/* Shared display taxonomy. Legacy category IDs remain untouched so saved
 * inventory, BOM matching and wiring compatibility keep working. */
export const PART_GROUPS = [
  { id: 'compute', label: 'Compute & Control' },
  { id: 'motion', label: 'Actuators & Motion' },
  { id: 'sensing', label: 'Sensors & Perception' },
  { id: 'energy', label: 'Power & Energy' },
  { id: 'structure', label: 'Mechanical & Structural' },
  { id: 'electronics', label: 'Electronics & Communication' },
  { id: 'tools', label: 'End Effectors & Tools' },
] as const;
export type PartGroupId = typeof PART_GROUPS[number]['id'];
const map: Record<string, PartGroupId> = {
  storage: 'compute', flight_controller: 'compute', computer: 'compute', controller: 'compute', microcontroller: 'compute', cpu: 'compute',
  propulsion: 'motion', drive: 'motion', motor: 'motion', servo: 'motion', actuator: 'motion', wheel: 'motion', gearbox: 'motion',
  sensor: 'sensing', lidar: 'sensing', camera: 'sensing', imu: 'sensing', gps: 'sensing',
  battery: 'energy', power: 'energy', bms: 'energy',
  material: 'structure', frame: 'structure', chassis: 'structure', mechanical: 'structure', mount: 'structure',
  motor_driver: 'electronics', cable: 'electronics', radio: 'electronics', pcb: 'electronics', wiring: 'electronics',
  safety: 'electronics', gripper: 'tools', end_effector: 'tools', tool: 'tools',
};
export function partGroup(category: string, name = ''): PartGroupId {
  const key = category.toLowerCase().replace(/[\s-]+/g, '_');
  if (map[key]) return map[key];
  const n = (category + ' ' + name).toLowerCase();
  if (/gripper|suction|end.effector|welding torch/.test(n)) return 'tools';
  if (/jetson|raspberry|arduino|esp32|stm32|compute|processor|controller/.test(n)) return 'compute';
  if (/lidar|realsense|camera|ultrasonic|encoder|sensor|imu|gps/.test(n)) return 'sensing';
  if (/battery|bms|power supply|converter|regulator/.test(n)) return 'energy';
  if (/motor driver|esc|harness|connector|radio|pcb|ethernet/.test(n)) return 'electronics';
  if (/motor|servo|wheel|gearbox|actuator/.test(n)) return 'motion';
  if (/chassis|frame|mount|bracket|bearing|fastener/.test(n)) return 'structure';
  return 'electronics';
}
export function partGroupLabel(id: PartGroupId): string {
  return PART_GROUPS.find((g) => g.id === id)?.label ?? id;
}
