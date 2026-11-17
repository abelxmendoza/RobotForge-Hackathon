'use client';
import TwinView from './TwinView';
import {assetPath} from '@/components/home/asset';
import type {GeneratedRobotAsset} from '@/lib/generatedRobotAssets';
export default function GeneratedRobotModel({asset,onClose}:{asset:GeneratedRobotAsset;onClose?:()=>void}){
 return <section className="studio-task-view" style={{overflow:'auto',padding:16}} aria-label={`${asset.name} generated reference`}><div className="studio-task-head"><h2>{asset.name}</h2>{onClose&&<button className="btn btn-sm" onClick={onClose}>Back to workspace</button>}</div><p className="faint g-small">ProjectSim visual reconstruction · estimated shape and scale · no validated robot controller</p><TwinView subject={{id:asset.slug,name:asset.name,role:'Generated visual reference',basis:'Authored text; manufacturer geometry and hardware measurements were not used.',generatedFrom:'an authored text description.',model:asset.model,preview:'',physics:[]}}/><a href={assetPath(asset.receipt)}>Generation receipt</a> · <a href={assetPath(asset.model)} download>Download GLB</a></section>;
}
