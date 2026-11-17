import records from '@/data/robot-twins.json';
export interface GeneratedRobotAsset {slug:string;name:string;model:string;receipt:string;assetId:string;generatedAt?:string;bytes:number}
export const generatedRobotAssets=records as GeneratedRobotAsset[];
export function generatedRobotAsset(name:string):GeneratedRobotAsset|undefined {
 const value=name.trim().toLowerCase();return generatedRobotAssets.find(r=>r.slug===value||r.name.toLowerCase()===value);
}
