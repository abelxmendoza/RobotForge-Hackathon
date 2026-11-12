// Fetch the pinned public player; the Editor is not needed on the web builder.
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=JSON.parse(await readFile(path.join(web,'unity-release.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!/^[-a-zA-Z0-9]{1,80}$/.test(release.buildId)||!/^https:\/\/github\.com\/abelxmendoza\/RobotForge-Hackathon\/releases\/download\//.test(release.url)||! /^[a-f0-9]{64}$/.test(release.sha256))throw new Error('Invalid Unity release pin');
const dest=path.resolve(process.env.RF_UNITY_STAGE_DEST||path.join(web,'public/unity'));
let existing;
try{existing=JSON.parse(await readFile(path.join(dest,'current.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(existing?.buildId===release.buildId){
 if(existing.protocolVersion!==1||!existing.files||!['loader','data','framework','wasm'].every(role=>existing.files[existing[role]]))throw new Error('Invalid existing Unity manifest');
 for(const [url,receipt] of Object.entries(existing.files)){
  const prefix='/unity/'+release.buildId+'/';
  if(!url.startsWith(prefix)||url.includes('..')||url.includes('\\'))throw new Error('Invalid existing Unity path');
  const bytes=await readFile(path.join(dest,release.buildId,url.slice(prefix.length)));
  if(bytes.length!==receipt.bytes||hash(bytes)!==receipt.sha256)throw new Error('Existing Unity artifact integrity failed: '+url);
 }
 console.log('Verified staged Unity '+release.buildId);
}else{
 const temp=await mkdtemp(path.join(tmpdir(),'robotforge-unity-'));
 try{
  const response=await fetch(release.url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error('Unity release download failed: '+response.status);
  if(Number(response.headers.get('content-length'))>60000000)throw new Error('Unity archive too large');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>60000000||hash(bytes)!==release.sha256)throw new Error('Unity archive integrity failed');
  const archive=path.join(temp,'player.tar.gz'),source=path.join(temp,'player');
  await writeFile(archive,bytes);await mkdir(source);
  await run('tar',['-xzf',archive,'-C',source]); // Pinned hash is checked before extraction.
  const result=await run(process.execPath,[path.join(web,'scripts/stage-unity.mjs'),'--source',source,'--build-id',release.buildId,'--dest',dest]);
  process.stdout.write(result.stdout);
 }finally{await rm(temp,{recursive:true,force:true});}
}
