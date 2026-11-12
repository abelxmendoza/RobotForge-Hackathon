import type * as Three from 'three';

/** Original lightweight scenery, in robot Z-up coordinates. Decorative only.
 * Kept in one group so a future Blender GLB can replace it without changing
 * robot part IDs or the assembly controller. All dimensions scale to the view.
 */
export function addWorkshopScenery(THREE: typeof Three, scene: Three.Scene, span: number): void {
  const room = new THREE.Group(); room.name = 'workshop-environment';
  const steel = new THREE.MeshStandardMaterial({color: 0x253c48, roughness: .65, metalness: .45});
  const wood = new THREE.MeshStandardMaterial({color: 0x90714a, roughness: .85});
  const dark = new THREE.MeshStandardMaterial({color: 0x111e29, roughness: .8});
  const accent = new THREE.MeshStandardMaterial({color: 0x32b5ad, roughness: .5});
  const box = (x: number, y: number, z: number, w: number, d: number, h: number, material: Three.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w*span,d*span,h*span), material);
    mesh.position.set(x*span,y*span,z*span); mesh.receiveShadow = true; mesh.castShadow = true; room.add(mesh);
  };
  // Work surface below the robot, with a frame and drawers behind it.
  box(0,0,-.05,3.8,2.8,.08,wood);
  for (const x of [-1.6,1.6]) for (const y of [-1.1,1.1]) box(x,y,-.45,.08,.08,.8,steel);
  box(0,1.5,.7,3.8,.07,1.5,dark);
  for(let i=0;i<12;i++) for(let j=0;j<4;j++) box(-1.65+i*.3,1.45,.32+j*.25,.025,.035,.025,steel);
  // Tool rack and storage. These meshes never take part in robot raycasting.
  for(let i=0;i<6;i++) { box(-1.2+i*.4,1.37,.65,.04,.05,.48,steel); box(-1.2+i*.4,1.37,.92,.13,.05,.08,accent); }
  box(1.35,.9,.2,.5,.5,.35,steel);
  for(let i=0;i<3;i++) box(1.35,.635,.1+i*.1,.36,.02,.025,accent);
  // Two parts trays flank the assembly. Positions are illustrative, not mounts.
  for (const x of [-1.25,1.25]) {
    box(x,-.15,.012,.66,1.45,.035,dark);
    for(const dx of [-.34,.34]) box(x+dx,-.15,.045,.025,1.45,.07,steel);
    for(const y of [-.88,.58]) box(x,y,.045,.7,.025,.07,steel);
  }
  box(0,1.38,1.31,2.6,.08,.04,accent);
  scene.add(room);
}

/** Three raycasts include invisible objects unless callers filter ancestors. */
export function visibleForPicking(object: {visible: boolean; parent: {visible: boolean; parent: unknown} | null}): boolean {
  let current: {visible: boolean; parent: unknown} | null = object;
  while(current) {
    if (!current.visible) return false;
    current = current.parent as typeof current;
  }
  return true;
}
