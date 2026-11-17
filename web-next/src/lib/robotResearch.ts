/** Public-source discovery. Results are candidates, never verified identities or imported CAD. */
export const ROBOT_RESEARCH_KEY='rf.robot-research.v1';
export interface ResearchHit {url:string;title?:string;description?:string;markdown?:string}
export interface RobotResearchReport {name:string;retrievedAt:string;resources:{url:string;title:string;excerpt:string;kind:string;assetStatus:'discovered link';license:'Not verified'}[];coverage:{category:string;status:'searched'|'unavailable'}[]}
export function robotResearchName(text:string):string|null {
 const m=text.trim().replace(/[.!?]+$/,'').match(/^(?:research|identify(?: the)? robot|identify|look up(?: the)? robot|find (?:all )?(?:open[- ]source )?(?:data|repos|cad|models) (?:for|about))\s+["“]?(.+?)["”]?$/i);
 if(!m||m[1].length>100||/\b(this|that|my|our|your|it|photo|picture)\b/i.test(m[1])||/https?:/i.test(m[1]))return null;
 return m[1].replace(/\s+/g,' ').trim();
}
function resourceKind(url:string,title:string):string {
 const q=(url+' '+title).toLowerCase();
 if(/\b(urdf|xacro|mjcf|sdf)\b/.test(q))return 'Robot description';
 if(/\b(cad|step|stp|stl|obj|glb|gltf|onshape|3d model)\b/.test(q))return 'CAD / 3D model';
 if(/github\.com|gitlab\.com|codeberg\.org/.test(q))return 'Source repository';
 return 'Documentation / reference';
}
export async function collectRobotResearch(name:string,search:(query:string)=>Promise<ResearchHit[]>,at:string):Promise<RobotResearchReport>{
 const categories=[['Specifications and assembly',`"${name}" robot manufacturer specifications assembly manual`],['Repositories',`"${name}" robot open source GitHub firmware ROS URDF license`],['CAD and models',`"${name}" robot CAD STEP STL Onshape 3D model download license`]];
 const report:RobotResearchReport={name,retrievedAt:at,resources:[],coverage:[]};const seen=new Set<string>();
 // Bounded to three provider searches. One unavailable category does not erase the others.
 for(const [category,query] of categories){try{const hits=await search(query);report.coverage.push({category,status:'searched'});for(const hit of hits.slice(0,5)){
  let u:URL;try{u=new URL(hit.url);}catch{continue;}
  if(u.protocol!=='https:'||u.username||u.password||seen.has(u.href))continue;seen.add(u.href);
  report.resources.push({url:u.href,title:(hit.title||u.hostname).slice(0,200),excerpt:(hit.description||hit.markdown||'').slice(0,600),kind:resourceKind(u.href,hit.title||''),assetStatus:'discovered link',license:'Not verified'});
 }}catch{report.coverage.push({category,status:'unavailable'});}}
 return report;
}
