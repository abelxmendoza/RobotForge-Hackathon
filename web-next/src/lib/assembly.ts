import type { GarageRobot } from './garage';
import type { WireNode, WireConn } from './wiring';
import { componentById, resolveComponent } from './components';
export const ASSEMBLY_KEY = 'rf.assemblies.v1';
export type Pose = [number, number, number];
export interface ComponentInstance { id: string; componentId: string; positionM: Pose; yawDeg: number }
export interface Connection { id: string; from: string; to: string }
export interface AssemblyVersion { id: string; note: string; createdAt: string; components: ComponentInstance[]; connections: Connection[] }
export type Assemblies = Record<string, AssemblyVersion[]>;
export interface AssemblyOperation {
  robotId: string; expectedRobotVersionId: string; expectedRevision: string | null;
  kind: 'add' | 'move' | 'remove' | 'connect' | 'disconnect';
  instanceId: string; componentId?: string; positionM?: Pose; yawDeg?: number; targetId?: string;
}
export function currentAssembly(all: Assemblies, robotId: string): AssemblyVersion {
  return all[robotId]?.at(-1) ?? { id: '', note: 'Empty assembly', createdAt: '', components: [], connections: [] };
}
function pose(value: unknown): asserts value is Pose {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10)) throw new Error('Position needs three finite coordinates within ±10 metres.');
}
function safeId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('Invalid instance or robot ID.');
}
/* Pure transaction shared by chat and assembly controls. Version checks happen
 * again at Apply. No connections are represented as electrically validated. */
export function previewAssembly(robots: GarageRobot[], all: Assemblies, op: AssemblyOperation): AssemblyVersion {
  if (!op || typeof op !== 'object') throw new Error('Missing assembly operation.');
  safeId(op.robotId); safeId(op.instanceId);
  const robot = robots.find(r => r.id === op.robotId);
  if (!robot || robot.versions.at(-1)?.id !== op.expectedRobotVersionId) throw new Error('Robot spec changed. Make a fresh proposal.');
  const current = currentAssembly(all, op.robotId);
  if ((current.id || null) !== op.expectedRevision) throw new Error('Assembly changed. Make a fresh proposal.');
  const next: AssemblyVersion = JSON.parse(JSON.stringify(current));
  const instance = next.components.find(c => c.id === op.instanceId);
  if (op.kind === 'add') {
    if (instance) throw new Error('That component instance already exists.');
    if (!componentById(op.componentId ?? '')) throw new Error('Unknown component identity.');
    if (next.components.length >= 50) throw new Error('This planner supports up to 50 components per robot.');
    pose(op.positionM);
    next.components.push({ id: op.instanceId, componentId: op.componentId!, positionM: [...op.positionM], yawDeg: 0 });
    next.note = 'Add ' + componentById(op.componentId!)!.name;
  } else if (op.kind === 'move') {
    if (!instance) throw new Error('Component instance not found.');
    pose(op.positionM);
    if (typeof op.yawDeg !== 'number' || !Number.isFinite(op.yawDeg) || Math.abs(op.yawDeg) > 360) throw new Error('Yaw must be within ±360 degrees.');
    instance.positionM = [...op.positionM]; instance.yawDeg = op.yawDeg;
    next.note = 'Move ' + instance.id;
  } else if (op.kind === 'remove') {
    if (!instance) throw new Error('Component instance not found.');
    const count = next.connections.filter(c => c.from === instance.id || c.to === instance.id).length;
    next.components = next.components.filter(c => c.id !== instance.id);
    next.connections = next.connections.filter(c => c.from !== instance.id && c.to !== instance.id);
    next.note = 'Remove ' + instance.id + ' and ' + count + ' associated planned connections';
  } else if (op.kind === 'connect') {
    if (!instance || !next.components.some(c => c.id === op.targetId)) throw new Error('Choose two existing component instances.');
    if (op.instanceId === op.targetId) throw new Error('Cannot connect a component to itself.');
    if (next.connections.some(c => c.from === op.instanceId && c.to === op.targetId)) throw new Error('That planned connection already exists.');
    if (next.connections.length >= 100) throw new Error('Connection limit reached.');
    next.connections.push({ id: op.instanceId + '--' + op.targetId, from: op.instanceId, to: op.targetId! });
    next.note = 'Plan connection ' + op.instanceId + ' → ' + op.targetId + ' (NOT_CHECKED)';
  } else if (op.kind === 'disconnect') {
    const found = next.connections.find(c => c.id === op.instanceId);
    if (!found) throw new Error('Connection not found.');
    next.connections = next.connections.filter(c => c.id !== op.instanceId); next.note = 'Remove planned connection';
  } else throw new Error('Unsupported assembly operation.');
  return next;
}
export function applyAssembly(robots: GarageRobot[], all: Assemblies, op: AssemblyOperation, id: string, createdAt: string): Assemblies {
  const next = previewAssembly(robots, all, op);
  return { ...all, [op.robotId]: [...(all[op.robotId] ?? []), { ...next, id, createdAt }] };
}
export function undoAssembly(all: Assemblies, robotId: string, expectedRevision: string, id: string, createdAt: string): Assemblies {
  safeId(robotId);
  const versions = all[robotId] ?? [];
  if (versions.at(-1)?.id !== expectedRevision) throw new Error('Assembly changed. Cannot undo a stale operation.');
  const before = versions.at(-2) ?? {components: [], connections: []};
  return { ...all, [robotId]: [...versions, { id, createdAt, note: 'Undo previous assembly change', components: JSON.parse(JSON.stringify(before.components)), connections: JSON.parse(JSON.stringify(before.connections)) }] };
}
export function operationFor(robots: GarageRobot[], all: Assemblies, robotId: string, args: Omit<AssemblyOperation,'robotId'|'expectedRobotVersionId'|'expectedRevision'>): AssemblyOperation {
  const robot = robots.find(r => r.id === robotId);
  if (!robot?.versions.at(-1)) throw new Error('Save a robot first.');
  return { ...args, robotId, expectedRobotVersionId: robot.versions.at(-1)!.id, expectedRevision: currentAssembly(all,robotId).id || null };
}
export function parseAssemblyCommand(text: string, robots: GarageRobot[], all: Assemblies, instanceId: string): AssemblyOperation | null {
  const q = text.trim();
  const add = q.match(/^add (?:a |an )?"?([^"\n]+?)"? to "([^"\n]+)"$/i);
  const move = q.match(/^move "([^"\n]+)" on "([^"\n]+)" to ([+-]?[\d.]+) ([+-]?[\d.]+) ([+-]?[\d.]+) mm(?: yaw ([+-]?[\d.]+))?$/i);
  const connect = q.match(/^connect "([^"\n]+)" to "([^"\n]+)" on "([^"\n]+)"$/i);
  const remove = q.match(/^remove "([^"\n]+)" from "([^"\n]+)"$/i);
  const robotName = add?.[2] ?? move?.[2] ?? connect?.[3] ?? remove?.[2];
  if (!robotName) return null;
  const matches = robots.filter(r => r.name.toLowerCase() === robotName.toLowerCase());
  if (matches.length !== 1) throw new Error('Use one unique saved robot name in quotes. Try “list my robots”.');
  const robot = matches[0];
  if (add) {
    const part = resolveComponent(add[1]);
    const spec = robot.versions.at(-1)!.spec;
    const clearance = Number(spec.ground_clearance_m ?? 0);
    if (!Number.isFinite(clearance) || clearance < 0) throw new Error('Robot clearance needs a valid value first.');
    return operationFor(robots,all,robot.id,{kind:'add',instanceId,componentId:part.id,positionM:[0,0,clearance + 0.003 + part.sizeM[2]/2]});
  }
  const resolveInstance = (reference: string) => {
    const components = currentAssembly(all,robot.id).components;
    const exact = components.find(c=>c.id===reference);
    if(exact) return exact.id;
    const definition = resolveComponent(reference);
    const matches = components.filter(c=>c.componentId===definition.id);
    if(matches.length!==1) throw new Error(matches.length ? 'More than one matching component. Use its instance ID from the workbench.' : 'That component is not in this robot assembly.');
    return matches[0].id;
  };
  if (move) return operationFor(robots,all,robot.id,{kind:'move',instanceId:resolveInstance(move[1]),positionM:[Number(move[3])/1000,Number(move[4])/1000,Number(move[5])/1000],yawDeg:Number(move[6]??0)});
  if (connect) return operationFor(robots,all,robot.id,{kind:'connect',instanceId:resolveInstance(connect[1]),targetId:resolveInstance(connect[2])});
  return operationFor(robots,all,robot.id,{kind:'remove',instanceId:resolveInstance(remove![1])});
}

/** Once a robot has a snapshot, the legacy store can never override it. */
export function effectiveAssemblies(robots: GarageRobot[], legacy: Assemblies): Assemblies {
  const all = { ...legacy };
  for (const robot of robots) {
    const snapshots = robot.versions.flatMap(v => v.spec?.assembly ? [v.spec.assembly as AssemblyVersion] : []);
    if (snapshots.length) all[robot.id] = snapshots;
  }
  return all;
}
function editableRobot(robots: GarageRobot[], robotId: string, expected: string): GarageRobot {
  safeId(robotId);
  const robot = robots.find(r => r.id === robotId);
  if (!robot || robot.versions.at(-1)?.id !== expected) throw new Error('Robot spec changed. Make a fresh proposal.');
  if (robot.archivedAt && Number.isFinite(Date.parse(robot.archivedAt))) throw new Error('Robot is archived. Restore it before editing.');
  return robot;
}
export function commitAssemblyVersion(robots: GarageRobot[], legacy: Assemblies, op: AssemblyOperation, versionId: string, createdAt: string): GarageRobot[] {
  const robot = editableRobot(robots, op.robotId, op.expectedRobotVersionId);
  safeId(versionId);
  const assembly = { ...previewAssembly(robots, effectiveAssemblies(robots, legacy), op), id: versionId, createdAt };
  const base = robot.versions.at(-1)!;
  const spec = JSON.parse(JSON.stringify(base.spec));
  spec.assembly = assembly;
  if (spec.wiring && Array.isArray(spec.wiring.nodes) && Array.isArray(spec.wiring.connections)) {
    if (op.kind === 'remove') {
      spec.wiring.nodes = spec.wiring.nodes.filter((node: WireNode) => node.id !== op.instanceId);
      spec.wiring.connections = spec.wiring.connections.filter((edge: WireConn) => edge.from !== op.instanceId && edge.to !== op.instanceId);
    } else if (op.kind === 'disconnect') {
      const link = currentAssembly(effectiveAssemblies(robots, legacy), op.robotId).connections.find(c => c.id === op.instanceId);
      // A pair-only assembly link can represent the coordinated power feed.
      // Preserve data/unknown interfaces and ambiguous parallel power feeds.
      const powerEdges = spec.wiring.connections.filter((edge: WireConn) => link && edge.from === link.from && edge.to === link.to && edge.kind === 'power');
      if (powerEdges.length === 1) spec.wiring.connections = spec.wiring.connections.filter((edge: WireConn) => edge !== powerEdges[0]);
    }
  }
  for (const key of ['gate_status', 'gate_report', 'gateReport', 'simulation_results', 'simulationResults', 'test_results', 'testResults', 'forgeTests']) delete spec[key];
  spec.simulation_status = 'incomplete: assembly changed; recheck hardware mass, inertia and interfaces';
  // Assembly geometry changed: prior upgrade evidence and generated files are
  // version-bound. Keep their history on the previous version only.
  delete spec.upgradePlan;
  delete spec.upgrade;
  delete spec.upgradeReport;
  delete spec.upgradeArtifacts;
  const next = { ...base, id: versionId, createdAt, label: assembly.note, note: assembly.note, source: 'edit' as const, planned: true, spec };
  return robots.map(r => r === robot ? { ...r, versions: [...r.versions, next] } : r);
}
export function undoVersionedAssembly(robots: GarageRobot[], legacy: Assemblies, robotId: string, expectedRobotVersionId: string, expectedAssemblyRevision: string | null, versionId: string, createdAt: string): GarageRobot[] {
  const robot = editableRobot(robots, robotId, expectedRobotVersionId);
  safeId(versionId);
  const all = effectiveAssemblies(robots, legacy);
  if ((currentAssembly(all, robotId).id || null) !== expectedAssemblyRevision) throw new Error('Assembly changed. Cannot undo a stale operation.');
  const latest = robot.versions.at(-1)!;
  const previous = latest.spec?.assembly ? robot.versions.at(-2) : latest;
  if (!previous) throw new Error('No previous robot snapshot to restore.');
  const spec = JSON.parse(JSON.stringify(previous.spec));
  const before = spec.assembly ?? (latest.spec?.assembly ? currentAssembly(legacy, robotId) : (legacy[robotId]?.at(-2) ?? currentAssembly({},robotId)));
  spec.assembly = { ...JSON.parse(JSON.stringify(before)), id: versionId, createdAt, note: 'Undo previous assembly change' };
  const next = { ...previous, id: versionId, createdAt, label: 'Undo previous assembly change', note: 'Restored previous complete robot snapshot', source: 'edit' as const, spec };
  return robots.map(r => r === robot ? { ...r, versions: [...r.versions, next] } : r);
}
