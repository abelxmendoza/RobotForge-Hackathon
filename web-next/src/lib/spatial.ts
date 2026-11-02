/* Envelope-based spatial, orientation, and mounting intelligence.
 * Evaluates deck bounds, mounting standoff elevation, center-of-mass balance,
 * sensor FOV / perimeter orientation, port keep-outs, and 3D cable lengths.
 * These checks operate on published/illustrative envelopes, not manufacturer CAD. */
import type { ComponentInstance, Pose } from './assembly';
import { componentById, type ComponentDefinition } from './components';

export interface SpecEnvelopeInput {
  length_m?: number;
  width_m?: number;
  height_m?: number;
  ground_clearance_m?: number;
  mass_kg?: number;
}

export interface PartPlacementDiagnostic {
  instanceId: string;
  componentId: string;
  componentName: string;
  mountingStatus: 'pass' | 'warn' | 'fail';
  mountingMessage: string;
  mountingNotes: string[];
  orientationStatus: 'pass' | 'warn' | 'fail';
  orientationMessage: string;
  orientationNotes: string[];
  placementStatus: 'pass' | 'warn' | 'fail';
  placementMessage: string;
  placementNotes: string[];
  fovBlockedBy: string[];
  portBlockedBy: string[];
  overlapsWith: string[];
  recommendedPose: Pose;
  recommendedYawDeg: number;
  score: number;
}

export interface CenterOfMassReport {
  xM: number;
  yM: number;
  zM: number;
  positionM: Pose;
  offsetMm: [number, number];
  totalMassKg: number;
  addedMassKg: number;
  status: 'balanced' | 'offset' | 'tipping-risk' | 'front-heavy' | 'rear-heavy' | 'lateral-imbalance';
  summary: string;
}

export interface PlacementCandidate {
  label: string;
  positionM: Pose;
  yawDeg: number;
  reason: string;
  score: number;
}

export interface PlacementIntelligenceReport {
  com: CenterOfMassReport;
  diagnostics: PartPlacementDiagnostic[];
  cableLengthsMm: Record<string, number>;
  totalCableLengthMm: number;
  overallScore: number;
}

export function snapPlacement(
  position: Pose,
  gridM: number,
  deckTopM: number | null,
  heightM: number,
): Pose {
  if (
    ![...position, gridM, heightM].every(Number.isFinite) ||
    gridM <= 0 ||
    heightM <= 0 ||
    (deckTopM !== null && !Number.isFinite(deckTopM))
  ) {
    throw new Error('Invalid placement inputs.');
  }
  return [
    Math.round(position[0] / gridM) * gridM,
    Math.round(position[1] / gridM) * gridM,
    deckTopM === null ? position[2] : deckTopM + heightM / 2,
  ];
}

export function envelopesOverlap(a: ComponentInstance, b: ComponentInstance): boolean {
  const x = componentById(a.componentId),
    y = componentById(b.componentId);
  if (!x || !y) return false;
  if (Math.abs(a.positionM[2] - b.positionM[2]) >= (x.sizeM[2] + y.sizeM[2]) / 2 - 1e-8)
    return false;
  const angleA = (a.yawDeg * Math.PI) / 180,
    angleB = (b.yawDeg * Math.PI) / 180;
  const axesA = [
    [Math.cos(angleA), Math.sin(angleA)],
    [-Math.sin(angleA), Math.cos(angleA)],
  ];
  const axesB = [
    [Math.cos(angleB), Math.sin(angleB)],
    [-Math.sin(angleB), Math.cos(angleB)],
  ];
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1];
  const delta = [b.positionM[0] - a.positionM[0], b.positionM[1] - a.positionM[1]];
  for (const axis of [...axesA, ...axesB]) {
    const ra =
      (x.sizeM[0] / 2) * Math.abs(dot(axesA[0], axis)) +
      (x.sizeM[1] / 2) * Math.abs(dot(axesA[1], axis));
    const rb =
      (y.sizeM[0] / 2) * Math.abs(dot(axesB[0], axis)) +
      (y.sizeM[1] / 2) * Math.abs(dot(axesB[1], axis));
    if (Math.abs(dot(delta, axis)) >= ra + rb - 1e-8) return false;
  }
  return true;
}

export function overlapPairs(instances: ComponentInstance[]): [string, string][] {
  const pairs: [string, string][] = [];
  instances.forEach((a, i) =>
    instances.slice(i + 1).forEach((b) => {
      if (envelopesOverlap(a, b)) pairs.push([a.id, b.id]);
    }),
  );
  return pairs;
}

export function shortestYaw(from: number, to: number, t: number): number {
  return (
    from +
    (((((to - from) % 360) + 540) % 360) - 180) * Math.max(0, Math.min(1, t))
  );
}

/** Normalize yaw into [-180, 180]. */
export function normalizeYawDeg(yawDeg: number): number {
  const n = ((((yawDeg + 180) % 360) + 360) % 360) - 180;
  return Object.is(n, -0) ? 0 : n;
}

/** Compute the recommended Z center coordinate for a component mounted on the robot deck. */
export function mountedCenterZ(spec: SpecEnvelopeInput, part: ComponentDefinition): number {
  const clearance = Number.isFinite(Number(spec.ground_clearance_m))
    ? Number(spec.ground_clearance_m)
    : 0.03;
  const deckTop = clearance + 0.003;
  const standoffM = (part.mounting?.standoffHeightMm ?? 0) / 1000;
  return Math.round((deckTop + standoffM + part.sizeM[2] / 2) * 10000) / 10000;
}

/** Transform a local offset [dx, dy, dz] (metres) by instance pose and yaw. */
export function localToWorldPoint(instance: ComponentInstance, localOffsetM: Pose): Pose {
  const rad = (instance.yawDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    instance.positionM[0] + localOffsetM[0] * cos - localOffsetM[1] * sin,
    instance.positionM[1] + localOffsetM[0] * sin + localOffsetM[1] * cos,
    instance.positionM[2] + localOffsetM[2],
  ];
}

/** Compute world-space 3D coordinate of a component's terminal for accurate 3D cable routing. */
export function terminalWorldPoint(
  instance: ComponentInstance,
  terminalIndex = 0,
): Pose {
  const part = componentById(instance.componentId);
  if (!part) return [...instance.positionM];
  const term = part.terminals?.[terminalIndex % Math.max(1, part.terminals.length)];
  if (!term) {
    return [
      instance.positionM[0],
      instance.positionM[1],
      instance.positionM[2] + part.sizeM[2] / 2 + 0.002,
    ];
  }
  const local: Pose = [
    term.localOffsetRatio[0] * part.sizeM[0],
    term.localOffsetRatio[1] * part.sizeM[1],
    term.localOffsetRatio[2] * part.sizeM[2],
  ];
  return localToWorldPoint(instance, local);
}

/** World coordinates of mounting holes / standoffs for 3D visualization and verification. */
export function mountingHoleWorldPoints(
  instance: ComponentInstance,
  deckTopZ = 0.033,
): { x: number; y: number; zBottom: number; zTop: number; diameterM: number }[] {
  const part = componentById(instance.componentId);
  if (!part || !part.mounting) return [];
  const zTop = instance.positionM[2] - part.sizeM[2] / 2;
  const zBottom = Math.min(deckTopZ, zTop - 0.002);
  return part.mounting.holePatternMm.map(([hxMm, hyMm]) => {
    const [wx, wy] = localToWorldPoint(instance, [hxMm / 1000, hyMm / 1000, 0]);
    return {
      x: wx,
      y: wy,
      zBottom,
      zTop,
      diameterM: (part.mounting.holeDiameterMm || 3.0) / 1000,
    };
  });
}

/** Rotated XY half-extents of a component in robot frame. */
export function rotatedHalfExtentsXY(
  part: ComponentDefinition,
  yawDeg: number,
): [number, number] {
  const rad = (yawDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return [
    (part.sizeM[0] / 2) * c + (part.sizeM[1] / 2) * s,
    (part.sizeM[0] / 2) * s + (part.sizeM[1] / 2) * c,
  ];
}

/** Check if another component blocks a sensor's horizontal FOV cone. */
export function checkFovObstruction(
  sensor: ComponentInstance,
  others: ComponentInstance[],
): string[] {
  const part = componentById(sensor.componentId);
  if (!part || !part.orientation.fovDeg || !part.orientation.fovRangeM) return [];
  const fovRad = (part.orientation.fovDeg * Math.PI) / 180;
  const rangeM = part.orientation.fovRangeM;
  const yawRad = (sensor.yawDeg * Math.PI) / 180;
  const forward = [Math.cos(yawRad), Math.sin(yawRad)];
  const sensorTop = sensor.positionM[2] + part.sizeM[2] / 2;
  const sensorBot = sensor.positionM[2] - part.sizeM[2] / 2;

  const blockedBy: string[] = [];
  for (const other of others) {
    if (other.id === sensor.id) continue;
    const oPart = componentById(other.componentId);
    if (!oPart) continue;
    const oTop = other.positionM[2] + oPart.sizeM[2] / 2;
    const oBot = other.positionM[2] - oPart.sizeM[2] / 2;
    // Must overlap vertically with sensor scan band
    if (oTop < sensorBot + 0.002 || oBot > sensorTop + 0.02) continue;

    const dx = other.positionM[0] - sensor.positionM[0];
    const dy = other.positionM[1] - sensor.positionM[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6 || dist > rangeM) continue;
    if (part.orientation.fovDeg >= 359) {
      blockedBy.push(other.id);
      continue;
    }
    const dot = (dx * forward[0] + dy * forward[1]) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angularRadius = Math.atan2(Math.max(oPart.sizeM[0], oPart.sizeM[1]) * 0.5, dist);
    if (angle - angularRadius <= fovRad / 2) {
      blockedBy.push(other.id);
    }
  }
  return blockedBy;
}

/** Check if another component intrudes into the front connector/port keep-out zone. */
export function checkPortKeepout(
  instance: ComponentInstance,
  others: ComponentInstance[],
): string[] {
  const part = componentById(instance.componentId);
  if (!part || part.orientation.keepoutFrontMm <= 0) return [];
  const keepM = part.orientation.keepoutFrontMm / 1000;
  const probeOffset = part.sizeM[0] / 2 + keepM / 2;
  const probeCenter = localToWorldPoint(instance, [probeOffset, 0, 0]);
  const probeInstance: ComponentInstance = {
    id: '__keepout__',
    componentId: instance.componentId,
    positionM: probeCenter,
    yawDeg: instance.yawDeg,
  };
  const blocked: string[] = [];
  for (const other of others) {
    if (other.id === instance.id) continue;
    if (envelopesOverlap(probeInstance, other)) {
      blocked.push(other.id);
    }
  }
  return blocked;
}

/** Generate ranked, collision-free, mounting-aware placement & orientation candidates. */
export function recommendSmartPlacement(
  componentId: string,
  existing: ComponentInstance[],
  arg3: { id: string; from: string; to: string }[] | SpecEnvelopeInput,
  arg4?: SpecEnvelopeInput | string,
  arg5?: string,
): {
  positionM: Pose;
  yawDeg: number;
  zoneLabel: string;
  rationale: string[];
  candidates: PlacementCandidate[];
} {
  const connections: { id: string; from: string; to: string }[] = Array.isArray(arg3) ? arg3 : [];
  const spec: SpecEnvelopeInput = Array.isArray(arg3)
    ? ((arg4 as SpecEnvelopeInput) ?? {})
    : (arg3 ?? {});
  const excludeInstanceId: string | undefined = Array.isArray(arg3)
    ? arg5
    : typeof arg4 === 'string'
      ? arg4
      : arg5;
  const part = componentById(componentId) ?? componentById('jetson-orin-nano-reference-devkit')!;
  const lengthM = Math.max(0.16, Number(spec.length_m) || 0.32);
  const widthM = Math.max(0.14, Number(spec.width_m) || 0.24);
  const clearanceM = Math.max(0, Number(spec.ground_clearance_m) || 0.03);
  const deckTopZ = clearanceM + 0.003;
  const baseZ = snapPlacement(
    [0, 0, deckTopZ + (part.mounting.standoffHeightMm || 3) / 1000 + part.sizeM[2] / 2],
    0.005,
    null,
    part.sizeM[2],
  )[2];

  const others = existing.filter((c) => c.id !== excludeInstanceId);
  const halfL = lengthM / 2;
  const halfW = widthM / 2;
  const marginX = Math.max(0.01, halfL - part.sizeM[0] / 2 - 0.008);
  const marginY = Math.max(0.01, halfW - part.sizeM[1] / 2 - 0.008);
  const snap5 = (v: number) => Math.round(v / 0.005) * 0.005;

  const rawCandidates: { label: string; pos: Pose; yaw: number; reason: string }[] = [];
  const zone = part.mounting.preferredZone;

  if (zone === 'front-perimeter') {
    rawCandidates.push(
      {
        label: 'Front perimeter mount (+X forward)',
        pos: [snap5(marginX), 0, baseZ],
        yaw: 0,
        reason: `Unobstructed forward ${part.orientation.fovDeg ?? 60}° field of view at front deck edge (${part.mounting.fastener}).`,
      },
      {
        label: 'Front-left corner mount (+X forward)',
        pos: [snap5(marginX), snap5(marginY * 0.55), baseZ],
        yaw: 0,
        reason: 'Front-left perimeter offset to clear central mast or lidar.',
      },
      {
        label: 'Rear perimeter watch (-X backward)',
        pos: [snap5(-marginX), 0, baseZ],
        yaw: 180,
        reason: 'Rear-facing perimeter mount (yaw 180°) with clear aft line of sight.',
      },
    );
  } else if (zone === 'top-mast') {
    const tallestOtherTop = others.reduce((maxZ, o) => {
      const op = componentById(o.componentId);
      return Math.max(maxZ, o.positionM[2] + (op ? op.sizeM[2] / 2 : 0.02));
    }, deckTopZ + 0.02);
    const elevatedZ = Math.round(( Math.max(baseZ, tallestOtherTop + 0.012 + part.sizeM[2] / 2) ) * 10000) / 10000;
    rawCandidates.push(
      {
        label: 'Elevated center mast (360° clear sweep)',
        pos: [0, 0, elevatedZ],
        yaw: 0,
        reason: `Riser mount at Z=${Math.round(elevatedZ * 1000)} mm clears lower deck electronics for 360° scan plane.`,
      },
      {
        label: 'Forward mast mount (0° index forward)',
        pos: [snap5(marginX * 0.45), 0, elevatedZ],
        yaw: 0,
        reason: 'Elevated forward-center mast with 0° heading aligned to +X.',
      },
      {
        label: 'Deck-level forward bay',
        pos: [snap5(marginX * 0.5), 0, baseZ],
        yaw: 0,
        reason: 'Low-profile forward mount on standard standoffs.',
      },
    );
  } else if (zone === 'low-cg-bay') {
    rawCandidates.push(
      {
        label: 'Low-CG centerline bay (yaw 0°)',
        pos: [0, 0, baseZ],
        yaw: 0,
        reason: `Centers ${Math.round(part.massKg * 1000)} g mass over wheelbase [0, 0] with ${part.mounting.fastener}.`,
      },
      {
        label: 'Low-CG rear counter-balance bay',
        pos: [snap5(-marginX * 0.45), 0, baseZ],
        yaw: 0,
        reason: 'Aft centerline bay to counter-balance front sensor/camera payload.',
      },
      {
        label: 'Transverse mid-bay (yaw 90°)',
        pos: [snap5(-marginX * 0.25), 0, baseZ],
        yaw: 90,
        reason: 'Cross-chassis orientation (yaw 90°) freeing fore/aft deck space.',
      },
    );
  } else if (zone === 'power-bay' || zone === 'drive-bay') {
    rawCandidates.push(
      {
        label: 'Mid-left power & harness bay (yaw 0°)',
        pos: [snap5(-marginX * 0.25), snap5(marginY * 0.65), baseZ],
        yaw: 0,
        reason: `Shortens high-current cable runs between battery and load (${part.mounting.fastener}).`,
      },
      {
        label: 'Mid-right power & drive bay (yaw 0°)',
        pos: [snap5(-marginX * 0.25), snap5(-marginY * 0.65), baseZ],
        yaw: 0,
        reason: 'Starboard power/drive channel with clear top convective cooling.',
      },
      {
        label: 'Aft power distribution deck',
        pos: [snap5(-marginX * 0.65), 0, baseZ],
        yaw: 0,
        reason: 'Rear deck placement keeping switching noise away from front sensors/IMU.',
      },
    );
  } else {
    // center-deck / accessible-top (compute, IMU, E-stop)
    rawCandidates.push(
      {
        label: 'Center deck primary mount (yaw 0°)',
        pos: [0, 0, baseZ],
        yaw: part.orientation.preferredYawDeg,
        reason: `Aligned with robot +X axis on ${part.mounting.fastener}; minimizes harness fan-out.`,
      },
      {
        label: 'Forward-center compute bay (yaw 0°)',
        pos: [snap5(marginX * 0.35), 0, baseZ],
        yaw: part.orientation.preferredYawDeg,
        reason: 'Forward-center deck with rear clearance for battery pack.',
      },
      {
        label: 'Port-side compute bay (yaw 0°)',
        pos: [0, snap5(marginY * 0.55), baseZ],
        yaw: part.orientation.preferredYawDeg,
        reason: 'Port-side offset leaving centerline open for battery or IMU.',
      },
    );
  }

  // Also add grid fallback slots so even a crowded deck always finds a non-overlapping spot
  for (const fx of [0, 0.35, -0.35, 0.65, -0.65]) {
    for (const fy of [0, 0.55, -0.55]) {
      rawCandidates.push({
        label: `Deck slot (${Math.round(fx * 100)}%, ${Math.round(fy * 100)}%)`,
        pos: [snap5(marginX * fx), snap5(marginY * fy), baseZ],
        yaw: part.orientation.preferredYawDeg,
        reason: `Collision-free 5 mm grid slot using ${part.mounting.fastener}.`,
      });
    }
  }

  const scored: PlacementCandidate[] = rawCandidates.map((cand) => {
    const testInst: ComponentInstance = {
      id: excludeInstanceId ?? '__cand__',
      componentId: part.id,
      positionM: cand.pos,
      yawDeg: cand.yaw,
    };
    let score = 100;
    for (const o of others) {
      if (envelopesOverlap(testInst, o)) score -= 65;
    }
    const fovBlocks = checkFovObstruction(testInst, others);
    score -= fovBlocks.length * 30;
    const portBlocks = checkPortKeepout(testInst, others);
    score -= portBlocks.length * 15;

    const [hx, hy] = rotatedHalfExtentsXY(part, cand.yaw);
    if (Math.abs(cand.pos[0]) + hx > halfL + 1e-4 || Math.abs(cand.pos[1]) + hy > halfW + 1e-4) {
      score -= 25;
    }

    // Reward shorter wiring to connected instances
    if (excludeInstanceId) {
      const peerIds = connections
        .filter((c) => c.from === excludeInstanceId || c.to === excludeInstanceId)
        .map((c) => (c.from === excludeInstanceId ? c.to : c.from));
      for (const pid of peerIds) {
        const peer = others.find((o) => o.id === pid);
        if (peer) {
          const dist = Math.hypot(
            cand.pos[0] - peer.positionM[0],
            cand.pos[1] - peer.positionM[1],
            cand.pos[2] - peer.positionM[2],
          );
          score -= Math.round(dist * 20);
        }
      }
    }

    return {
      label: cand.label,
      positionM: cand.pos,
      yawDeg: cand.yaw,
      reason: cand.reason,
      score: Math.max(0, Math.min(100, score)),
    };
  });

  // Deduplicate by coordinate + yaw and pick top 3
  const seen = new Set<string>();
  const unique: PlacementCandidate[] = [];
  for (const c of scored.sort((a, b) => b.score - a.score)) {
    const key = `${c.positionM.map((v) => v.toFixed(3)).join(',')}:${c.yawDeg}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
    if (unique.length >= 3) break;
  }

  const best = unique[0] ?? {
    label: 'Center deck default',
    positionM: [0, 0, baseZ] as Pose,
    yawDeg: 0,
    reason: part.mounting.notes,
    score: 80,
  };

  return {
    positionM: best.positionM,
    yawDeg: best.yawDeg,
    zoneLabel: best.label,
    rationale: [best.reason, `Mounting: ${part.mounting.fastener}`],
    candidates: unique,
  };
}

/** Compute full placement, orientation, mounting & center-of-mass intelligence report. */
export function evaluatePlacementIntelligence(
  instances: ComponentInstance[],
  arg2: { id: string; from: string; to: string }[] | SpecEnvelopeInput,
  arg3?: SpecEnvelopeInput | { id: string; from: string; to: string }[],
): PlacementIntelligenceReport {
  const connections: { id: string; from: string; to: string }[] = Array.isArray(arg2)
    ? arg2
    : Array.isArray(arg3)
      ? arg3
      : [];
  const spec: SpecEnvelopeInput = Array.isArray(arg2)
    ? ((arg3 as SpecEnvelopeInput) ?? {})
    : (arg2 ?? {});
  const lengthM = Math.max(0.12, Number(spec.length_m) || 0.32);
  const widthM = Math.max(0.12, Number(spec.width_m) || 0.24);
  const heightM = Math.max(0.05, Number(spec.height_m) || 0.14);
  const clearanceM = Math.max(0, Number(spec.ground_clearance_m) || 0.03);
  const baseMassKg = Math.max(0.1, Number(spec.mass_kg) || 1.5);
  const deckTopZ = clearanceM + 0.003;

  // 1. Center of mass calculation
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = baseMassKg * (clearanceM + heightM * 0.45);
  let addedMassKg = 0;

  for (const inst of instances) {
    const part = componentById(inst.componentId);
    const m = part?.massKg ?? 0.05;
    addedMassKg += m;
    weightedX += m * inst.positionM[0];
    weightedY += m * inst.positionM[1];
    weightedZ += m * inst.positionM[2];
  }

  const totalMassKg = baseMassKg + addedMassKg;
  const comPos: Pose = [
    weightedX / totalMassKg,
    weightedY / totalMassKg,
    weightedZ / totalMassKg,
  ];
  const offsetMm: [number, number] = [
    Math.round(comPos[0] * 1000 * 10) / 10,
    Math.round(comPos[1] * 1000 * 10) / 10,
  ];

  let comStatus: CenterOfMassReport['status'] = 'balanced';
  if (Math.abs(comPos[0]) > lengthM * 0.15) {
    comStatus = comPos[0] > 0 ? 'front-heavy' : 'rear-heavy';
  } else if (Math.abs(comPos[1]) > widthM * 0.12) {
    comStatus = 'lateral-imbalance';
  }
  const comSummary =
    comStatus === 'balanced'
      ? `Balanced CoM (ΔX ${offsetMm[0] >= 0 ? '+' : ''}${offsetMm[0]} mm, ΔY ${offsetMm[1] >= 0 ? '+' : ''}${offsetMm[1]} mm; +${Math.round(addedMassKg * 1000)} g payload)`
      : `CoM shift (${comStatus.replace('-', ' ')}: ΔX ${offsetMm[0]} mm, ΔY ${offsetMm[1]} mm) — move heavy battery/motors closer to [0, 0]`;

  // 2. Per-part diagnostics
  const overlaps = overlapPairs(instances);
  const diagnostics: PartPlacementDiagnostic[] = instances.map((inst) => {
    const part = componentById(inst.componentId);
    const rec = recommendSmartPlacement(
      inst.componentId,
      instances,
      connections,
      spec,
      inst.id,
    );
    if (!part) {
      return {
        instanceId: inst.id,
        componentId: inst.componentId,
        componentName: inst.componentId,
        mountingStatus: 'warn',
        mountingMessage: 'Unknown component mounting metadata.',
        mountingNotes: ['Unknown component mounting metadata.'],
        orientationStatus: 'warn',
        orientationMessage: 'Unknown orientation rules.',
        orientationNotes: ['Unknown orientation rules.'],
        placementStatus: 'warn',
        placementMessage: 'Unknown envelope.',
        placementNotes: ['Unknown envelope.'],
        fovBlockedBy: [],
        portBlockedBy: [],
        overlapsWith: [],
        recommendedPose: [0, 0, deckTopZ + 0.015],
        recommendedYawDeg: 0,
        score: 50,
      };
    }

    const instOverlaps = overlaps
      .filter(([a, b]) => a === inst.id || b === inst.id)
      .map(([a, b]) => (a === inst.id ? b : a));

    // Mounting Z check
    const expectedBottomZ = deckTopZ + (part.mounting.standoffHeightMm || 0) / 1000;
    const actualBottomZ = inst.positionM[2] - part.sizeM[2] / 2;
    const zDiffMm = Math.round((actualBottomZ - deckTopZ) * 1000);
    let mountingStatus: 'pass' | 'warn' | 'fail' = 'pass';
    let mountingMessage = `${part.mounting.fastener} (${part.mounting.holePatternMm.length} holes · ${zDiffMm} mm deck gap)`;
    if (actualBottomZ < deckTopZ - 0.002) {
      mountingStatus = 'fail';
      mountingMessage = `Part bottom penetrates chassis deck by ${Math.abs(zDiffMm)} mm — snap to deck + ${part.mounting.standoffHeightMm} mm standoffs.`;
    } else if (
      !part.orientation.requiresElevatedLineOfSight &&
      Math.abs(actualBottomZ - expectedBottomZ) > 0.025
    ) {
      mountingStatus = 'warn';
      mountingMessage = `Part sits ${zDiffMm} mm above deck (standard ${part.mounting.fastener} is ${part.mounting.standoffHeightMm} mm).`;
    }

    // Placement / Deck bounds & overlap check
    const [hx, hy] = rotatedHalfExtentsXY(part, inst.yawDeg);
    const overhangX = Math.max(0, Math.abs(inst.positionM[0]) + hx - lengthM / 2);
    const overhangY = Math.max(0, Math.abs(inst.positionM[1]) + hy - widthM / 2);
    let placementStatus: 'pass' | 'warn' | 'fail' = 'pass';
    let placementMessage = `Fits within ${Math.round(lengthM * 1000)} × ${Math.round(widthM * 1000)} mm deck (${part.mounting.preferredZone}).`;
    if (instOverlaps.length > 0) {
      placementStatus = 'fail';
      placementMessage = `Envelope collides with ${instOverlaps.join(', ')}.`;
    } else if (overhangX > 0.002 || overhangY > 0.002) {
      placementStatus = 'warn';
      placementMessage = `Overhangs chassis perimeter by ${Math.round(Math.max(overhangX, overhangY) * 1000)} mm.`;
    }

    // Orientation & FOV / Keepout check
    const fovBlockedBy = checkFovObstruction(inst, instances);
    const portBlockedBy = checkPortKeepout(inst, instances);
    const normYaw = normalizeYawDeg(inst.yawDeg);
    let orientationStatus: 'pass' | 'warn' | 'fail' = 'pass';
    let orientationMessage = `Yaw ${normYaw}° — ${part.orientation.forwardAxisLabel}.`;

    if (fovBlockedBy.length > 0) {
      orientationStatus = 'fail';
      orientationMessage = `${part.orientation.fovDeg}° sensor FOV is occluded by ${fovBlockedBy.join(', ')} — move forward or elevate on risers.`;
    } else if (part.orientation.requiresPerimeterClearance) {
      // Check if sensor points inward toward robot center [0,0] instead of outward
      const rad = (normYaw * Math.PI) / 180;
      const forwardDotPos =
        inst.positionM[0] * Math.cos(rad) + inst.positionM[1] * Math.sin(rad);
      if (forwardDotPos < -0.01) {
        orientationStatus = 'warn';
        orientationMessage = `Sensor at [${Math.round(inst.positionM[0] * 1000)}, ${Math.round(inst.positionM[1] * 1000)}] mm faces inward (yaw ${normYaw}°) across the deck.`;
      }
    } else if (part.orientation.requiresCenterAlignment) {
      const cardinalRem = Math.abs(normYaw % 90);
      if (cardinalRem > 1 && Math.abs(cardinalRem - 90) > 1) {
        orientationStatus = 'warn';
        orientationMessage = `IMU yaw (${normYaw}°) is non-cardinal — align to 0°, ±90°, or 180° for clean frame transforms.`;
      }
    } else if (portBlockedBy.length > 0) {
      orientationStatus = 'warn';
      orientationMessage = `Front connector keep-out (${part.orientation.keepoutFrontMm} mm) is crowded by ${portBlockedBy.join(', ')}.`;
    }

    let score = 100;
    if (placementStatus === 'fail') score -= 45;
    else if (placementStatus === 'warn') score -= 15;
    if (orientationStatus === 'fail') score -= 35;
    else if (orientationStatus === 'warn') score -= 15;
    if (mountingStatus === 'fail') score -= 25;
    else if (mountingStatus === 'warn') score -= 10;

    return {
      instanceId: inst.id,
      componentId: inst.componentId,
      componentName: part.name,
      mountingStatus,
      mountingMessage,
      mountingNotes: [mountingMessage],
      orientationStatus,
      orientationMessage,
      orientationNotes: [orientationMessage],
      placementStatus,
      placementMessage,
      placementNotes: [placementMessage],
      fovBlockedBy,
      portBlockedBy,
      overlapsWith: instOverlaps,
      recommendedPose: rec.positionM,
      recommendedYawDeg: rec.yawDeg,
      score: Math.max(0, score),
    };
  });

  // 3. Total 3D cable length (with 18% routing slack)
  let totalCableLengthMm = 0;
  const cableLengthsMm: Record<string, number> = {};
  for (const conn of connections) {
    const a = instances.find((c) => c.id === conn.from);
    const b = instances.find((c) => c.id === conn.to);
    if (a && b) {
      const pa = terminalWorldPoint(a, 0);
      const pb = terminalWorldPoint(b, 0);
      const distM = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) * 1.18;
      const lenMm = Math.round(distM * 1000);
      cableLengthsMm[conn.id] = lenMm;
      totalCableLengthMm += lenMm;
    }
  }

  const overallScore = diagnostics.length
    ? Math.round(diagnostics.reduce((s, d) => s + d.score, 0) / diagnostics.length)
    : 100;

  return {
    com: {
      xM: comPos[0],
      yM: comPos[1],
      zM: comPos[2],
      positionM: comPos,
      offsetMm,
      totalMassKg: Math.round(totalMassKg * 1000) / 1000,
      addedMassKg: Math.round(addedMassKg * 1000) / 1000,
      status: comStatus,
      summary: comSummary,
    },
    diagnostics,
    cableLengthsMm,
    totalCableLengthMm,
    overallScore,
  };
}
