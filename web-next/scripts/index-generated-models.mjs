// Only completed, local GLBs with provider receipts enter the web catalogue.
import {existsSync,readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function indexGeneratedModels(repo){
 const dir=path.join(repo,'assets','robot-twins');if(!existsSync(dir))return [];
 const records=[];
 for(const file of readdirSync(dir).sort()){
  if(!/^[a-z0-9-]+\.json$/.test(file))continue;
  const slug=file.slice(0,-5);let record;try{record=JSON.parse(readFileSync(path.join(dir,file),'utf8'));}catch{continue;}
  const model=`assets/robot-twins/${slug}.glb`,local=path.join(repo,model);
  if(record.glb!==model||!record.asset_id||!record.robot||!existsSync(local))continue;
  const bytes=readFileSync(local);if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)continue;
  records.push({slug,catalogSlug:typeof record.catalog_slug==='string'?record.catalog_slug:slug,name:String(record.robot),model,receipt:`assets/robot-twins/${file}`,assetId:String(record.asset_id),generatedAt:record.generated_at,bytes:bytes.length});
 }
 return records;
}
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const records=indexGeneratedModels(repo),dest=path.join(repo,'web-next/src/data/robot-twins.json');mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,JSON.stringify(records,null,2)+'\n');console.log(`generated-models: ${records.length} completed GLBs indexed`);
}
