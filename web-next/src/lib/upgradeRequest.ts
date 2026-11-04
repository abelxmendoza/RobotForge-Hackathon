/** Only explicit making requests enter the supported Pi 5 upgrade workflow. */
export function parseUpgradeRequest(text:string,robots:{id:string;name:string;archivedAt?:string}[],selectedRobotId?:string):{robotId:string}|null {
  const q=text.trim().replace(/[.!?]+$/,'').replace(/^(?:please\s+|can you\s+|could you\s+)/i,'');
  const m=q.match(/^(?:add|install) (?:a |an )?(raspberry pi(?: 5)?|rpi ?5|pi ?5)(?: to (.+))?$/i)
    ?? q.match(/^plan (?:a |an )?(raspberry pi(?: 5)?|rpi ?5|pi ?5) upgrade(?: for (.+))?$/i);
  if(!m)return null;
  if(!/5/.test(m[1]))throw new Error('Specify the exact board. Coordinated upgrades currently support Raspberry Pi 5.');
  const active=robots.filter(r=>!r.archivedAt);
  const target=m[2]?.trim();
  if(!target||/^(?:this|my|the) (?:robot|rover)$/i.test(target)) {
    if(selectedRobotId&&active.some(r=>r.id===selectedRobotId))return {robotId:selectedRobotId};
    throw new Error('Select a robot in the Workshop or name one explicitly in quotes.');
  }
  const name=target.replace(/^"|"$/g,'');
  const matches=active.filter(r=>r.name.toLowerCase()===name.toLowerCase());
  if(matches.length!==1)throw new Error('Use one unique saved robot name in quotes.');
  return {robotId:matches[0].id};
}

/** Explicit facts for the currently open proposal; free prose is not interpreted as measurements. */
export function parseUpgradeFacts(text:string):{supplyMinV?:number;supplyMaxV?:number;loadCurrentA?:number;qualifiedConverterCurrentA?:number;loadMinV?:number;loadMaxV?:number}|null {
  const q=text.trim().replace(/[.!]$/,'');
  const range=q.match(/^(battery(?: voltage)?|pi input(?: voltage)?) (?:is |range is |range )?([\d.]+)\s*(?:to|[-–])\s*([\d.]+)\s*v(?:olts)?$/i);
  if(range){const lo=Number(range[2]),hi=Number(range[3]);return /^battery/i.test(range[1])?{supplyMinV:lo,supplyMaxV:hi}:{loadMinV:lo,loadMaxV:hi};}
  const current=q.match(/^(load|pi load|converter continuous current) (?:is )?([\d.]+)\s*a(?:mps)?$/i);
  if(current)return /^converter/i.test(current[1])?{qualifiedConverterCurrentA:Number(current[2])}:{loadCurrentA:Number(current[2])};
  return null;
}
