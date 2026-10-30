/* Illustrative 3D harness geometry, not a physical cable-route solver. */
export type Point3 = [number, number, number];
export function cableControlPoints(a: Point3, b: Point3, lane = 0): Point3[] {
  if (![...a,...b].every(Number.isFinite)) throw new Error('Cable endpoints must be finite.');
  const rise = Math.max(0.025, Math.hypot(...a.map((n,i)=>n-b[i]))*0.25) + Math.max(0,lane)*0.006;
  const z = Math.max(a[2],b[2])+rise;
  const loop = Math.hypot(...a.map((n,i)=>n-b[i])) < 1e-6 ? 0.025 : 0;
  return [[...a],[a[0]+loop,a[1],z],[b[0]-loop,b[1],z],[...b]];
}
export function animationPhase(seconds: number, index = 0): number {
  return ((seconds*0.35+index*0.23)%1+1)%1;
}
