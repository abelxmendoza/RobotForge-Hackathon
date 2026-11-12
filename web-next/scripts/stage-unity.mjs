// Stage a real Unity Web build. Never generate placeholder engine binaries.
import {readFile,writeFile,mkdir,readdir,lstat,cp,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const args=process.argv.slice(2);const option=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const source=option('--source'),buildId=option('--build-id'),dest=path.resolve(option('--dest')??'public/unity');
if(!source||!buildId||!/^[-a-zA-Z0-9]{1,80}$/.test(buildId))throw new Error('Usage: node scripts/stage-unity.mjs --source <Unity Web folder> --build-id <ID> [--dest public/unity]');
const root=path.resolve(source);const files=[];
async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);const info=await lstat(full);if(info.isSymbolicLink())throw new Error('Symlinks are not allowed in Unity build artifacts');if(entry.isDirectory())await walk(full);else if(entry.isFile())files.push(full);}}
await walk(root);
const receipt=JSON.parse(await readFile(path.join(root,'robotforge-build.json'),'utf8'));if(receipt.buildId!==buildId||receipt.protocolVersion!==1)throw new Error('Compiled build identity does not match staging ID');
for(const license of ['Licenses/Unitree-G1-LICENSE.txt','Licenses/Unitree-G1-provenance.json'])if(!files.includes(path.join(root,license)))throw new Error('Missing license receipt: '+license);
const find=expression=>{const found=files.filter(f=>expression.test(f));if(found.length!==1)throw new Error('Expected one build file matching '+expression);return found[0];};
const roles={loader:find(/\.loader\.js$/),data:find(/\.data(?:\.br)?$/),framework:find(/\.framework\.js(?:\.br)?$/),wasm:find(/\.wasm(?:\.br)?$/)};
const compression=roles.wasm.endsWith('.br')?'brotli':'disabled';
if(['data','framework','wasm'].some(role=>roles[role].endsWith('.br')!==(compression==='brotli')))throw new Error('Mixed compression types');
const records={};let total=0;
for(const file of files){const bytes=await readFile(file);total+=bytes.length;if(bytes.length===0||bytes.length>=100_000_000||total>200_000_000)throw new Error('Empty or oversized Unity build');records[`/unity/${buildId}/${path.relative(root,file).split(path.sep).join('/')}`]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
await mkdir(dest,{recursive:true});const target=path.join(dest,buildId);await mkdir(target); // fail if ID already exists
try{for(const file of files){const output=path.join(target,path.relative(root,file));await mkdir(path.dirname(output),{recursive:true});await cp(file,output,{errorOnExist:true,force:false});}}catch(error){await rm(target,{recursive:true,force:true});throw error;}
const manifest={protocolVersion:1,buildId,compression,files:records};for(const [role,file]of Object.entries(roles))manifest[role]=`/unity/${buildId}/${path.relative(root,file).split(path.sep).join('/')}`;
const temporary=path.join(dest,`.current-${process.pid}.json`);await writeFile(temporary,JSON.stringify(manifest,null,2)+'\n');await rename(temporary,path.join(dest,'current.json'));
console.log(`Staged Unity ${buildId}: ${files.length} files, ${total} bytes. Runtime behavior has not been verified by staging.`);
