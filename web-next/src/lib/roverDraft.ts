/** A pending local draft wins over a link to a saved robot, avoiding silent loss. */
export function shouldRecoverRoverDraft(cached:{format?:string;dirty?:boolean;robotId?:string}|null,requestedId:string|null):boolean {
  return cached?.format==='robotforge-rover-draft-v1' && (cached.dirty===true || !requestedId || cached.robotId===requestedId);
}
