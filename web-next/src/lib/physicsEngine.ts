/* In-browser physics checks: parse a robot's official URDF with
 * urdf-loader, reduce it to masses + collision shapes, and run three
 * checks on the result —
 *   1. mass audit (URDF link-mass sum vs the catalogue's figure),
 *   2. static stability (centre of mass vs support polygon),
 *   3. a settle test in Rapier: the model, joints locked at the
 *      URDF's zero pose, dropped 30 mm onto a ground plane.
 * Everything is computed in this browser from the model file itself;
 * nothing is recorded or replayed. All geometry/mass math that can
 * be pure lives in physicsMath.ts (and is node-tested there); this
 * file is the three.js / URDFLoader / Rapier adapter.
 *
 * Honesty rules baked in:
 *  - A link's mass comes only from its URDF <inertial>. Links with
 *    mass but no collision shape still count: their mass rides on a
 *    collision-disabled point at their centre of mass.
 *  - Mesh collision geometry is approximated by the mesh's own
 *    bounding box, and the count of approximated (and unresolvable)
 *    shapes is reported with the results, never hidden.
 *  - Articulated joints are locked at the zero pose: the settle test
 *    judges the resting stance of the model, not walking or control.
 */
import type { PhysicsEntry } from "./types";
import {
  centerOfMass, sampleShape, staticStability, settleVerdict, tiltDegFromQuat,
  totalMass, type LinkMass, type ShapeSamples, type StabilityResult,
  type Vec3,
} from "./physicsMath";
import { assetPath } from "../components/home/asset";

export interface LinkRow {
  name: string;
  massKg: number;
}

export interface SettleResult {
  tiltDeg: number;
  displacementM: number;
  verdict: "stands" | "settles-tilted" | "topples";
  dropM: number;
  seconds: number;
  /** Body-origin height when the model's lowest point just touches
   *  the ground, and where the body actually ended up — their gap
   *  proves the body really landed (and did not fall through). */
  restZM: number;
  finalZM: number;
}

export interface PhysicsResult {
  robotName: string;
  links: LinkRow[];
  totalMassKg: number;
  com: Vec3;
  stability: StabilityResult | null;
  settle: SettleResult | null;
  settleUnavailable: string | null;
  shapesUsed: number;
  shapesMeshApprox: number;
  shapesSkipped: number;
  massOnlyLinks: number;
}

const DROP_M = 0.03;
const SETTLE_STEPS = 300; // 5 s at 60 Hz
const GRAVITY = 9.81;

interface ShapeRec {
  linkName: string;
  kind: "box" | "sphere" | "cylinder" | "meshbox";
  /** World matrix (URDF frame, zero pose), three.js elements layout. */
  matrix: number[];
  /** For meshbox: world-space bounding-box corner samples. */
  points?: Vec3[];
  /** Rapier-ready local description, filled by buildRapierBody. */
  halfExtents?: Vec3;
  radius?: number;
  halfHeight?: number;
  localPos?: Vec3;
  localQuat?: [number, number, number, number];
}

function geomKindOf(collider: any): { kind: string; meshFile?: string } {
  const node = collider.urdfNode as Element | null;
  if (!node) return { kind: "none" };
  const geo = [...node.children].find(
    (c) => c.nodeName.toLowerCase() === "geometry",
  );
  if (!geo || !geo.children.length) return { kind: "none" };
  const g = geo.children[0];
  const kind = g.nodeName.toLowerCase();
  if (kind === "mesh") return { kind, meshFile: g.getAttribute("filename") || "" };
  return { kind };
}

function resolveMeshUrl(entry: PhysicsEntry, file: string): string | null {
  if (!file) return null;
  if (file.startsWith("$(")) return null; // xacro find expression — not a path
  if (/^https?:\/\//.test(file)) return file;
  if (file.startsWith("package://")) {
    const rest = file.slice("package://".length);
    const pkg = rest.split("/")[0];
    const base = entry.packages?.[pkg];
    if (!base) return null;
    return base + rest.slice(pkg.length + 1);
  }
  // Relative to the URDF's own directory.
  const base = (entry.urdf_url || "").replace(/[^/]*$/, "");
  return base + file;
}

export async function runPhysicsChecks(
  entry: PhysicsEntry,
): Promise<PhysicsResult> {
  const THREE = await import("three");
  const { default: URDFLoader } = await import("urdf-loader");

  const urdfUrl = entry.generated
    ? assetPath(entry.urdf_url || "")
    : entry.urdf_url || "";
  const res = await fetch(urdfUrl);
  if (!res.ok) throw new Error(`the model file answered HTTP ${res.status}`);
  const urdfText = await res.text();

  const loader = new URDFLoader();
  // urdf-loader defaults: parseCollision is FALSE and visuals are
  // parsed — flip both. The checks need collision geometry only;
  // visuals are never rendered here.
  (loader as any).parseCollision = true;
  (loader as any).parseVisual = false;
  // Meshes are NOT loaded by the loader either: collision meshes are
  // resolved deliberately below (bounding boxes, counted) instead of
  // silently.
  (loader as any).loadMeshCb = (
    _path: string,
    _manager: unknown,
    _material: unknown,
    onComplete: (obj: unknown, err?: Error) => void,
  ) => onComplete(new THREE.Object3D());
  const robot: any = loader.parse(urdfText);
  robot.updateMatrixWorld(true);

  const rootInv = new THREE.Matrix4().copy(robot.matrixWorld).invert();

  // ---- link masses + centres of mass --------------------------------
  const links: LinkMass[] = [];
  const linkRows: LinkRow[] = [];
  for (const link of Object.values<any>(robot.links)) {
    const mass = Number(link.inertial?.mass) || 0;
    const o = link.inertial?.origin?.xyz ?? [0, 0, 0];
    const com = link.localToWorld(new THREE.Vector3(o[0], o[1], o[2]));
    links.push({ name: link.urdfName || link.name, mass, com: [com.x, com.y, com.z] });
    if (mass > 0) linkRows.push({ name: link.urdfName || link.name, massKg: mass });
  }
  linkRows.sort((a, b) => b.massKg - a.massKg);
  const com = centerOfMass(links) ?? [0, 0, 0];

  // ---- collision shapes ----------------------------------------------
  const shapes: ShapeRec[] = [];
  let meshApprox = 0;
  let skipped = 0;
  const colliders: any[] = [];
  robot.traverse((obj: any) => {
    if (obj.isURDFCollider) colliders.push(obj);
  });

  const linkNameOf = (obj: any): string => {
    let p = obj;
    while (p && !p.isURDFLink) p = p.parent;
    return p ? p.urdfName || p.name : "";
  };

  let STLLoaderCtor: any = null;
  for (const col of colliders) {
    const { kind, meshFile } = geomKindOf(col);
    const linkName = linkNameOf(col);
    if (kind === "box" || kind === "sphere" || kind === "cylinder") {
      const mesh = col.children.find((c: any) => c.isMesh);
      if (!mesh) { skipped++; continue; }
      mesh.updateWorldMatrix(true, false);
      shapes.push({
        linkName, kind,
        matrix: [...mesh.matrixWorld.elements],
      });
    } else if (kind === "mesh") {
      const url = resolveMeshUrl(entry, meshFile || "");
      if (!url || !/\.stl$/i.test(url)) { skipped++; continue; }
      try {
        if (!STLLoaderCtor) {
          STLLoaderCtor = (await import("three/addons/loaders/STLLoader.js")).STLLoader;
        }
        const buf = await (await fetch(url)).arrayBuffer();
        const geo = new STLLoaderCtor().parse(buf);
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) { skipped++; continue; }
        col.updateWorldMatrix(true, false);
        const m = col.matrixWorld;
        const corners: Vec3[] = [];
        for (const x of [bb.min.x, bb.max.x])
          for (const y of [bb.min.y, bb.max.y])
            for (const z of [bb.min.z, bb.max.z]) {
              const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
              corners.push([v.x, v.y, v.z]);
            }
        // Rapier box: decompose the group matrix; half extents from
        // the bounding box scaled by the matrix's own scale.
        const rel = new THREE.Matrix4().multiplyMatrices(rootInv, m);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        rel.decompose(pos, quat, scl);
        const center = new THREE.Vector3(
          (bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2,
        ).multiply(scl).applyQuaternion(quat).add(pos);
        shapes.push({
          linkName, kind: "meshbox",
          matrix: [...m.elements],
          points: corners,
          halfExtents: [
            Math.abs(((bb.max.x - bb.min.x) / 2) * scl.x),
            Math.abs(((bb.max.y - bb.min.y) / 2) * scl.y),
            Math.abs(((bb.max.z - bb.min.z) / 2) * scl.z),
          ],
          localPos: [center.x, center.y, center.z],
          localQuat: [quat.x, quat.y, quat.z, quat.w],
        });
        meshApprox++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  // ---- static stability ----------------------------------------------
  const samples: Vec3[] = [];
  for (const s of shapes) {
    if (s.kind === "meshbox") samples.push(...(s.points ?? []));
    else samples.push(...sampleShape({ kind: s.kind, matrix: s.matrix }));
  }
  const stability = samples.length ? staticStability(samples, com) : null;

  // ---- settle test (Rapier) -------------------------------------------
  let settle: SettleResult | null = null;
  let settleUnavailable: string | null = null;
  let massOnlyLinks = 0;
  if (!shapes.length) {
    settleUnavailable =
      "the model records no usable collision geometry, so there is nothing to drop";
  } else {
    try {
      settle = await runSettle(THREE, rootInv, shapes, links, com);
    } catch (e) {
      settleUnavailable = `the physics engine failed to run (${(e as Error).message})`;
    }
  }
  // Count links whose mass rides on a phantom point (no own shape).
  const shapedLinks = new Set(shapes.map((s) => s.linkName));
  massOnlyLinks = links.filter((l) => l.mass > 0 && !shapedLinks.has(l.name)).length;

  return {
    robotName: robot.robotName || "",
    links: linkRows,
    totalMassKg: totalMass(links),
    com,
    stability,
    settle,
    settleUnavailable,
    shapesUsed: shapes.length,
    shapesMeshApprox: meshApprox,
    shapesSkipped: skipped,
    massOnlyLinks,
  };
}

async function runSettle(
  THREE: any,
  rootInv: any,
  shapes: ShapeRec[],
  links: LinkMass[],
  com: Vec3,
): Promise<SettleResult> {
  const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
  world.timestep = 1 / 60;
  try {
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(10, 10, 0.5).setTranslation(0, 0, -0.5).setFriction(1.0),
      ground,
    );

    // Lowest point of the model at rest → spawn DROP_M above ground.
    let minZ = Infinity;
    for (const s of shapes) {
      const pts = s.kind === "meshbox" ? (s.points ?? []) : sampleShape({ kind: s.kind, matrix: s.matrix });
      for (const p of pts) minZ = Math.min(minZ, p[2]);
    }
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0, -minZ + DROP_M)
        .setCanSleep(false),
    );

    const byLink = new Map<string, ShapeRec[]>();
    for (const s of shapes) {
      const arr = byLink.get(s.linkName) ?? [];
      arr.push(s);
      byLink.set(s.linkName, arr);
    }
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (const link of links) {
      const recs = byLink.get(link.name) ?? [];
      if (link.mass <= 0 && !recs.length) continue;
      if (!recs.length) {
        // Mass with no collision shape: a collision-disabled point
        // mass at the link's centre of mass. The descriptor's
        // translation is body-relative, and the body starts
        // unrotated on the origin's vertical line, so the URDF-frame
        // centre of mass is the body-relative position.
        world.createCollider(
          RAPIER.ColliderDesc.ball(0.002)
            .setTranslation(link.com[0], link.com[1], link.com[2])
            .setMass(link.mass)
            .setCollisionGroups(0),
          body,
        );
        continue;
      }
      const perShape = link.mass / recs.length;
      for (const s of recs) {
        let desc: any;
        if (s.kind === "meshbox") {
          desc = RAPIER.ColliderDesc.cuboid(
            s.halfExtents![0], s.halfExtents![1], s.halfExtents![2],
          )
            .setTranslation(s.localPos![0], s.localPos![1], s.localPos![2])
            .setRotation({
              x: s.localQuat![0], y: s.localQuat![1], z: s.localQuat![2], w: s.localQuat![3],
            });
        } else {
          const rel = new THREE.Matrix4().multiplyMatrices(
            rootInv, new THREE.Matrix4().fromArray(s.matrix),
          );
          rel.decompose(v, q, sc);
          if (s.kind === "box") {
            desc = RAPIER.ColliderDesc.cuboid(
              Math.abs(sc.x) / 2, Math.abs(sc.y) / 2, Math.abs(sc.z) / 2,
            );
          } else if (s.kind === "sphere") {
            desc = RAPIER.ColliderDesc.ball(Math.abs(sc.x));
          } else {
            desc = RAPIER.ColliderDesc.cylinder(Math.abs(sc.y) / 2, Math.abs(sc.x));
          }
          desc.setTranslation(v.x, v.y, v.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        }
        desc.setFriction(0.9).setRestitution(0);
        if (perShape > 0) desc.setMass(perShape);
        else desc.setDensity(0);
        world.createCollider(desc, body);
      }
    }

    for (let i = 0; i < SETTLE_STEPS; i++) world.step();
    const t = body.translation();
    const r = body.rotation();
    const tiltDeg = tiltDegFromQuat([r.x, r.y, r.z, r.w]);
    const restZ = -minZ;
    // Fell clean through the floor (a solver failure, not a result):
    // report it as a topple, never as a stand.
    const verdict = t.z < restZ - 0.5 ? "topples" : settleVerdict(tiltDeg);
    return {
      tiltDeg,
      displacementM: Math.hypot(t.x, t.y),
      verdict,
      dropM: DROP_M,
      seconds: SETTLE_STEPS / 60,
      restZM: restZ,
      finalZM: t.z,
    };
  } finally {
    world.free();
  }
}
