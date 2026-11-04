/* Live browser sandbox: proxy collision geometry, bounded motor torque, real contact.
 * An uploaded visual shell is not used as a measured collision definition. */
import type {Spec} from './garage';
import {simulationIssues,type Scenario,type SimPose} from './simulation';
export async function createDriveWorld(spec:Spec,scenario:Scenario){
 const issues=simulationIssues(spec);if(issues.length)throw new Error('Physics needs: '+issues.join(', '));
 const R=await import('@dimforge/rapier3d-compat');await R.init();
 const world=new R.World({x:0,y:0,z:-9.81});world.timestep=1/60;
 const L=spec.length_m,W=spec.width_m,H=spec.height_m,r=spec.wheel.diameter_m/2,ww=spec.wheel.width_m,mass=spec.mass_kg;
 const floor=world.createRigidBody(R.RigidBodyDesc.fixed());world.createCollider(R.ColliderDesc.cuboid(12,12,.1).setTranslation(0,0,-.1).setFriction(.85),floor);
 if(scenario==='ramp'){const a=10*Math.PI/180;world.createCollider(R.ColliderDesc.cuboid(1,.8,.05).setTranslation(1.7,0,Math.sin(a)).setRotation({x:0,y:-Math.sin(a/2),z:0,w:Math.cos(a/2)}).setFriction(.85),floor);}
 if(scenario==='obstacle')world.createCollider(R.ColliderDesc.cuboid(.15,.7,.015).setTranslation(.9,0,.015).setFriction(.85),floor);
 const bodyH=Math.max(.01,H-spec.ground_clearance_m),bodyZ=spec.ground_clearance_m+bodyH/2;
 const body=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,0,0).setCanSleep(false));
 world.createCollider(R.ColliderDesc.cuboid(L/2,W/2,bodyH/2).setTranslation(0,0,bodyZ).setMass(mass*.8).setFriction(.4),body);
 const wheels:{joint:import('@dimforge/rapier3d-compat').RevoluteImpulseJoint;y:number}[]=[];
 for(let i=0;i<spec.wheel.count;i++){
  const side=i%2===0?1:-1;const x=spec.wheel.count===2?0:(i<2?1:-1)*(L/2-r),y=side*(W/2+ww/2);
  const wheel=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x,y,r).setCanSleep(false));
  world.createCollider(R.ColliderDesc.cylinder(ww/2,r).setMass(mass*.2/spec.wheel.count).setFriction(.85),wheel);
  const joint=world.createImpulseJoint(R.JointData.revolute({x,y,z:r},{x:0,y:0,z:0},{x:0,y:1,z:0}),body,wheel,true) as import('@dimforge/rapier3d-compat').RevoluteImpulseJoint;
  joint.setContactsEnabled(false);if(i>=spec.motor.count)continue;
  joint.configureMotorModel(R.MotorModel.ForceBased);joint.configureMotorVelocity(0,20);joint.setMotorMaxForce(spec.motor.stall_torque_nm*.6);wheels.push({joint,y});
 }
 if(spec.wheel.count===2){const cr=Math.min(spec.ground_clearance_m,r)*.8;for(const x of [-L/2+cr,L/2-cr])world.createCollider(R.ColliderDesc.ball(cr).setTranslation(x,0,cr).setMass(.001).setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min),body);}
 let t=0;
 return {step(throttle:number,turn:number):SimPose{for(const w of wheels)w.joint.configureMotorVelocity((.3*throttle-1.2*turn*w.y)/r,20);world.step();t+=1/60;const p=body.translation(),q=body.rotation();return {t,x:p.x,y:p.y,z:p.z,qx:q.x,qy:q.y,qz:q.z,qw:q.w};},free(){world.free();}};
}
