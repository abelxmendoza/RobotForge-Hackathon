"use client";
import {preparePhoto} from './image';
import {INVENTORY_KEY,categoryHint,mergeUpdate,type InventoryPart} from './inventory';
import {readStore,writeStore,uid} from './store';
import {saveInventoryPhoto,removeInventoryPhoto} from './inventoryPhotos';
import {liveHealth,postJSON,routeOn} from '@/components/forge/live';
/* Shared intake for Inventory and the Forge photo attachment flow. Save before
 * identification so a failed model request never discards the photo record. */
export async function intakePartPhoto(file:File,robotId:string|null):Promise<{id:string;warning:string}> {
  const {full,thumb}=await preparePhoto(file);
  const id=uid('part');let warning='',photoAssetId:string|null=null;
  try{await saveInventoryPhoto(id,full);photoAssetId=id;}catch{warning='Only the thumbnail was saved; larger-photo storage is unavailable.';}
  const part:InventoryPart={id,name:file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ')||'Unidentified part',category:categoryHint(file.name),quantity:1,catalog_part_id:null,specs:{},read_from_label:[],condition:'unknown',confidence:'low',status:'needs_confirmation',question:'',photo:thumb,photo_asset_id:photoAssetId,filename:file.name,robot_id:robotId,stock_location:'',notes:'',chat:[],createdAt:new Date().toISOString(),source:'photo'};
  const failure=writeStore(INVENTORY_KEY,[part,...readStore<InventoryPart[]>(INVENTORY_KEY,[])]);
  if(failure){if(photoAssetId)await removeInventoryPhoto(photoAssetId).catch(()=>{});throw new Error(failure);}
  let found:Partial<InventoryPart>|null=null,reply='Photo saved. Live identification is unavailable; the category is only a filename hint. Name/classify the part and confirm its label details.';
  try{
    if(routeOn(await liveHealth(),'part')){
      const response=await postJSON<{part:InventoryPart}>('/part',{image_data_url:full});
      found=response.part;
      reply=`Suggested identification: ${found.name}. ${found.question||'Check the model and label, then confirm.'}`;
    }
  }catch(e){reply='Photo saved, but identification failed: '+(e as Error).message;}
  const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]);
  const next=current.map(p=>p.id!==id?p:{...mergeUpdate(p,part,found),...(found?{catalog_part_id:found.catalog_part_id??null,read_from_label:(found.read_from_label??[]).filter(k=>p.specs[k]===part.specs[k]||p.specs[k]===found?.specs?.[k]),question:found.question??''}:{}),chat:[...p.chat,{role:'assistant' as const,text:reply,live:Boolean(found)}]});
  const updateFailure=writeStore(INVENTORY_KEY,next);
  if(updateFailure)warning=[warning,'Photo record saved, but the identification update could not be saved.'].filter(Boolean).join(' ');
  return{id,warning};
}
