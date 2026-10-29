/* STL export for the 3D take-apart — a port of RF3D.exportSTL in
 * assets/js/robot3d.js (the vanilla viewer), kept as pure
 * functions over the scene's part groups so the exact code path
 * can be exercised headlessly.
 *
 * The export carries the geometry the 3D view actually shows:
 * the part groups are cloned, their explode offsets are stripped
 * (the file is the assembled robot), and the clone is scaled
 * metres -> millimetres before three's STLExporter writes a
 * binary STL — the format CAD tools and slicers open natively.
 * One part when partId is given, the whole robot when it is null.
 */
import type * as THREE_NS from "three";

type ThreeModule = typeof THREE_NS;

export interface STLExporterLike {
  parse: (
    scene: THREE_NS.Object3D,
    options: { binary: boolean },
  ) => DataView;
}

export type STLExporterClass = new () => STLExporterLike;

export function groupsToBinarySTL(
  THREE: ThreeModule,
  STLExporter: STLExporterClass,
  groups: THREE_NS.Group[],
  partId: string | null,
): DataView | null {
  const root = new THREE.Group();
  groups.forEach((g) => {
    if (partId && g.userData.part !== partId) return;
    const clone = g.clone(true);
    clone.position.set(0, 0, 0);
    root.add(clone);
  });
  if (!root.children.length) return null;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(1000); // metres -> millimetres
  wrap.add(root);
  wrap.updateMatrixWorld(true);
  return new STLExporter().parse(wrap, { binary: true });
}

export function stlFileName(
  specName: string | undefined,
  partId: string | null,
): string {
  const slug = (specName || "robot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return (
    "robotforge-" + slug + (partId ? "-" + partId : "-assembly") + ".stl"
  );
}

export function downloadBinarySTL(data: DataView, filename: string): void {
  /* Copy into a fresh Uint8Array: the exporter's DataView spans
   * its whole buffer, and the copy keeps the Blob typing exact. */
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const blob = new Blob([bytes], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
