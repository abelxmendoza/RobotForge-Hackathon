/** Printable mount mesh in millimetres. Shared by the preview and STL export. */
import { ExtrudeGeometry, Path, Shape } from 'three';
import type { MountArtifact } from './buildArtifacts';
export function mountGeometry(mount: MountArtifact): ExtrudeGeometry {
  const shape = new Shape();
  const x = mount.lengthMm / 2, y = mount.widthMm / 2;
  shape.moveTo(-x,-y); shape.lineTo(x,-y); shape.lineTo(x,y); shape.lineTo(-x,y); shape.closePath();
  for (const [cx,cy] of mount.holes) {
    const hole = new Path();
    hole.absarc(cx,cy,mount.holeDiameterMm/2,0,Math.PI*2,true);
    shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: mount.thicknessMm, bevelEnabled: false, curveSegments: 32 });
  geometry.computeBoundingBox();
  return geometry;
}
