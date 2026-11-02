"use client";
import {useRef} from 'react';
import {applyInventory,INVENTORY_KEY,type InventoryPart,type InventoryOperation} from '@/lib/inventory';
import {GARAGE_KEY,type GarageRobot} from '@/lib/garage';
import {readStore,writeStore} from '@/lib/store';
import {setRobot} from '@/lib/partsTree';
export default function InventoryProposal({operation,onDone,onCancel}:{operation:InventoryOperation;onDone:(text:string)=>void;onCancel:()=>void}){
  const consumed=useRef(false);
  return <div className="fc-msg bot" role="region" aria-label="Inventory change preview"><strong>{operation.description}</strong><p>Updates your saved stock record; robot assignment does not install or consume a part.</p><button type="button" className="btn btn-primary btn-sm" onClick={()=>{
    if(consumed.current)return;consumed.current=true;
    try{
      if(operation.robotId&&!readStore<GarageRobot[]>(GARAGE_KEY,[]).some(r=>r.id===operation.robotId))throw new Error('That robot no longer exists.');
      const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]);
      let next=applyInventory(current,operation,new Date().toISOString());
      // A robot move goes through the parts tree, so parts mounted on
      // this one move with it and a nested part leaves its old parent.
      if(typeof operation.robotId==='string')next=setRobot(current,operation.partId,operation.robotId);
      const error=writeStore(INVENTORY_KEY,next);if(error)throw new Error(error);
      onDone('Inventory saved: '+operation.description);
    }catch(e){onDone((e as Error).message);}
  }}>Apply inventory change</button>{' '}<button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button></div>;
}
