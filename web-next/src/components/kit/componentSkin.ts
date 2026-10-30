/* Stylized proxies within the envelope, not manufacturer CAD or connector locations. */
import type * as T from 'three';
export function addComponentSkin(THREE: typeof T, mesh: T.Mesh, size: [number,number,number], componentId: string) {
  const [l,w,h]=size;
  const material=(color:number,metalness=0.15,roughness=0.5)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
  const board=material(0x12644e),metal=material(0x4a5968,0.85,0.28),black=material(0x101722,0.2,0.48);
  const box=(dims:[number,number,number],position:[number,number,number],mat:T.Material)=>{
    const part=new THREE.Mesh(new THREE.BoxGeometry(...dims),mat);part.position.set(...position);part.castShadow=true;part.receiveShadow=true;mesh.add(part);return part;
  };
  if(componentId.startsWith('jetson')){
    box([l*0.96,w*0.96,h*0.08],[0,0,-h*0.42],board);
    box([l*0.60,w*0.63,h*0.40],[0,0,-h*0.08],black);
    for(let i=0;i<11;i++)box([l*0.58,w*0.022,h*0.38],[0,(i-5)*w*0.052,h*0.22],metal);
    for(let i=0;i<3;i++)box([l*0.13,w*0.15,h*0.42],[l*0.40,(i-1)*w*0.25,-h*0.18],metal);
  }else if(componentId.startsWith('converter')){
    box([l*0.94,w*0.94,h*0.10],[0,0,-h*0.40],board);
    const coil=new THREE.Mesh(new THREE.TorusGeometry(w*0.23,w*0.055,12,32),material(0xb87835,0.8,0.28));
    coil.position.set(0,0,h*0.05);mesh.add(coil);
    box([l*0.20,w*0.70,h*0.38],[-l*0.34,0,-h*0.10],black);
    box([l*0.16,w*0.70,h*0.38],[l*0.36,0,-h*0.10],metal);
  }else{
    box([l*0.96,w*0.96,h*0.94],[0,0,0],black);
    box([l*0.48,w*0.68,0.0005],[0,0,h*0.475],material(0x1f8e91,0.1));
    for(const sign of [-1,1])box([l*0.04,w*0.88,h*0.96],[sign*l*0.31,0,0],material(0x343e4d));
  }
}
