/* The parts inventory: one record per kind of part on the shelf.
 * A photo-identified part starts as "needs confirmation"; it becomes
 * "confirmed" only when its owner says so (in the part's chat or with
 * the Confirm button). The model's guess never confirms itself. */

export const PART_CATEGORIES = ['battery', 'motor', 'motor_driver', 'controller', 'computer', 'sensor', 'wheel', 'servo', 'power', 'radio', 'frame', 'cable', 'tool', 'other'] as const;
export const PART_SPEC_KEYS = ['voltage_v', 'capacity_mah', 'current_a', 'stall_torque_nm', 'rpm', 'diameter_mm', 'width_mm', 'mass_g', 'cells', 'chemistry', 'interface', 'range_m', 'model_number'] as const;

export const SPEC_KEY_LABEL: Record<string, string> = {
  voltage_v: 'Voltage (V)', capacity_mah: 'Capacity (mAh)', current_a: 'Current (A)',
  stall_torque_nm: 'Stall torque (N·m)', rpm: 'Speed (rpm)', diameter_mm: 'Diameter (mm)',
  width_mm: 'Width (mm)', mass_g: 'Mass (g)', cells: 'Cells', chemistry: 'Chemistry',
  interface: 'Interface', range_m: 'Range (m)', model_number: 'Model number',
};

export interface ChatLine { role: 'user' | 'assistant'; text: string; live?: boolean }

export interface InventoryPart {
  robot_id?: string | null;
  stock_location?: string;
  notes?: string;
  last_counted_at?: string;
  photo_asset_id?: string | null;
  filename?: string;
  id: string;
  name: string;
  category: string;
  quantity: number;
  catalog_part_id: string | null;
  specs: Record<string, string | number>;
  read_from_label: string[];
  condition: 'new' | 'used' | 'damaged' | 'unknown';
  confidence: 'low' | 'medium' | 'high' | 'owner';
  status: 'needs_confirmation' | 'confirmed';
  question: string;
  photo: string | null;
  chat: ChatLine[];
  createdAt: string;
  source: 'photo' | 'manual';
}

export const INVENTORY_KEY = 'rf.inventory.v1';

export function applyUpdate(part: InventoryPart, u: Partial<InventoryPart> | null): InventoryPart {
  if (!u) return part;
  return {
    ...part,
    ...(u.name ? { name: u.name } : {}),
    ...(u.category ? { category: u.category } : {}),
    ...(typeof u.quantity === 'number' && Number.isInteger(u.quantity) && u.quantity >= 0 ? { quantity: u.quantity } : {}),
    ...(u.condition ? { condition: u.condition } : {}),
    specs: { ...part.specs, ...(u.specs || {}) },
  };
}

/* Apply a model reply that was computed from `snapshot` onto the
 * record as it is NOW. Conflict policy: the owner wins — a field the
 * owner changed while the request was in flight keeps the owner's
 * value; only fields still equal to the snapshot take the update. */
export function mergeUpdate(latest: InventoryPart, snapshot: InventoryPart, u: Partial<InventoryPart> | null): InventoryPart {
  if (!u) return latest;
  const next = { ...latest, specs: { ...latest.specs } };
  for (const k of ['name', 'category', 'quantity', 'condition'] as const) {
    if (u[k] !== undefined && latest[k] === snapshot[k]) (next as Record<string, unknown>)[k] = u[k];
  }
  for (const [k, v] of Object.entries(u.specs || {})) {
    if (latest.specs[k] === snapshot.specs[k]) next.specs[k] = v;
  }
  return next;
}

/* Offline helper for the part chat when the live endpoint is down:
 * understands "yes"/"confirm" and simple "<number> <unit>" facts. */
export function offlinePartReply(part: InventoryPart, message: string): { reply: string; update: Partial<InventoryPart> | null; confirmed: boolean } {
  const m = message.toLowerCase();
  const specs: Record<string, number> = {};
  const grab = (re: RegExp, key: string) => {
    const x = m.match(re);
    if (x) specs[key] = parseFloat(x[1]);
  };
  grab(/(\d+(?:\.\d+)?)\s*v\b/, 'voltage_v');
  grab(/(\d+(?:\.\d+)?)\s*mah\b/, 'capacity_mah');
  grab(/(\d+(?:\.\d+)?)\s*mm\b/, 'diameter_mm');
  grab(/(\d+(?:\.\d+)?)\s*a\b/, 'current_a');
  const qty = m.match(/\b(?:i have|got|x)\s*(\d+)\b|\b(\d+)\s*(?:of them|pcs|pieces)\b/);
  const update: Partial<InventoryPart> = {};
  if (Object.keys(specs).length) update.specs = specs;
  if (qty) update.quantity = parseInt(qty[1] || qty[2], 10);
  /* A negation anywhere ("no, that's not right", "don't confirm")
   * wins: the helper only confirms an unambiguous yes. */
  const negated = /\b(no|nope|not|don'?t|do not|never|wrong|incorrect|isn'?t|nah)\b/.test(m);
  const confirmed = !negated && /\b(yes|yep|yeah|correct|confirm(ed)?|that'?s right)\b/.test(m);
  const bits = [] as string[];
  if (update.specs) bits.push('noted ' + Object.entries(update.specs).map(([k, v]) => `${SPEC_KEY_LABEL[k] ?? k} ${v}`).join(', '));
  if (update.quantity) bits.push(`quantity ${update.quantity}`);
  if (confirmed) bits.push(`marked “${part.name}” as confirmed`);
  return {
    reply: bits.length ? 'Offline helper: ' + bits.join('; ') + '.' : 'Offline helper: the live model isn’t reachable, so I can only record numbers with units (like “12 V” or “5200 mAh”) and a “yes” to confirm.',
    update: Object.keys(update).length ? update : null,
    confirmed,
  };
}


/* Filename classification is a hint only; photo drafts remain unconfirmed. */
export function categoryHint(name: string): string {
  const n=name.toLowerCase().replace(/[_-]/g,' ');
  const rules: [string,RegExp][]=[['motor_driver',/motor driver|tb6612|l298/],['computer',/jetson|raspberry|rpi/],['battery',/battery|lipo|li ion|lifepo/],['power',/buck|boost|converter|regulator|bms/],['servo',/servo/],['motor',/motor/],['sensor',/lidar|camera|realsense|imu|ultrasonic|sensor/],['wheel',/wheel/],['controller',/esp32|arduino|pico/],['cable',/cable|harness|connector/],['frame',/frame|chassis|mount/]];
  return rules.find(([,re])=>re.test(n))?.[0]??'other';
}
export function matchesInventory(part: InventoryPart, query: string, category: string, robot: string): boolean {
  const text=[part.name,part.category,part.stock_location,part.notes,part.filename,...Object.values(part.specs)].join(' ').toLowerCase();
  return (!query.trim()||query.toLowerCase().trim().split(/\s+/).every(t=>text.includes(t))) &&
    (category==='all'||part.category===category) && (robot==='all'||(robot==='unassigned'?!part.robot_id:part.robot_id===robot));
}
export function countedPart(part: InventoryPart, quantity: number, at: string): InventoryPart {
  if(!Number.isSafeInteger(quantity)||quantity<0)throw new Error('Quantity must be a whole number, zero or more.');
  return {...part,quantity,last_counted_at:at};
}

export function importedPart(raw: unknown): InventoryPart {
  if(!raw||typeof raw!=='object')throw new Error('Invalid inventory record.');
  const p=raw as Partial<InventoryPart>;
  if(typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!Number.isSafeInteger(p.quantity)||p.quantity!<0||!PART_CATEGORIES.includes(p.category as typeof PART_CATEGORIES[number]))throw new Error('Inventory records need an ID, name, valid category and whole nonnegative quantity.');
  const safe={...p};delete (safe as Record<string,unknown>).photo_full;
  const image=(v:unknown)=>typeof v==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(v)?v:null;
  const specs=Object.fromEntries(Object.entries(p.specs??{}).filter(([,v])=>typeof v==='string'||(typeof v==='number'&&Number.isFinite(v))));
  return {...safe,id:p.id,name:p.name,category:p.category!,quantity:p.quantity!,specs,photo:image(p.photo),photo_asset_id:null,catalog_part_id:typeof p.catalog_part_id==='string'?p.catalog_part_id:null,read_from_label:Array.isArray(p.read_from_label)?p.read_from_label.filter(x=>typeof x==='string'):[],condition:['new','used','damaged','unknown'].includes(p.condition??'')?p.condition!:'unknown',confidence:'owner',status:p.status==='confirmed'?'confirmed':'needs_confirmation',question:typeof p.question==='string'?p.question:'',chat:Array.isArray(p.chat)?p.chat.filter(c=>c&&(c.role==='user'||c.role==='assistant')&&typeof c.text==='string'):[],createdAt:typeof p.createdAt==='string'?p.createdAt:new Date().toISOString(),source:p.source==='photo'?'photo':'manual',robot_id:typeof p.robot_id==='string'?p.robot_id:null,stock_location:typeof p.stock_location==='string'?p.stock_location:'',notes:typeof p.notes==='string'?p.notes:''};
}

export type InventoryCommand = {kind:'list';robotName?:string}|{kind:'quantity';name:string;quantity:number}|{kind:'assign';name:string;robotName:string};
export function parseInventoryCommand(text:string):InventoryCommand|null{
  const q=text.trim();
  const list=q.match(/^(?:list|show) my (?:inventory|parts)(?: for "([^"\n]+)")?$/i);
  if(list)return{kind:'list',robotName:list[1]};
  const count=q.match(/^set inventory "([^"\n]+)" quantity to (\d+)$/i);
  if(count)return{kind:'quantity',name:count[1],quantity:Number(count[2])};
  const assign=q.match(/^assign inventory "([^"\n]+)" to "([^"\n]+)"$/i);
  return assign?{kind:'assign',name:assign[1],robotName:assign[2]}:null;
}
export interface InventoryOperation{partId:string;expected:string;quantity?:number;robotId?:string;description:string}
export function proposeInventory(parts:InventoryPart[],robots:{id:string;name:string}[],command:Exclude<InventoryCommand,{kind:'list'}>):InventoryOperation{
  const matches=parts.filter(p=>p.name.toLowerCase()===command.name.toLowerCase()||p.id===command.name);
  if(matches.length!==1)throw new Error('Use a unique inventory part name or its ID.');
  const p=matches[0];
  if(command.kind==='quantity'){
    countedPart(p,command.quantity,'preview');
    return{partId:p.id,expected:JSON.stringify(p),quantity:command.quantity,description:`Count ${p.name}: ${p.quantity} → ${command.quantity}`};
  }
  const targets=robots.filter(r=>r.name.toLowerCase()===command.robotName.toLowerCase());
  if(targets.length!==1)throw new Error('Use a unique saved robot name.');
  return{partId:p.id,expected:JSON.stringify(p),robotId:targets[0].id,description:`Assign ${p.name} to ${targets[0].name}`};
}
export function applyInventory(parts:InventoryPart[],op:InventoryOperation,at:string):InventoryPart[]{
  const p=parts.find(p=>p.id===op.partId);
  if(!p||JSON.stringify(p)!==op.expected)throw new Error('Inventory changed. Ask for a fresh preview.');
  const next=op.quantity!==undefined?countedPart(p,op.quantity,at):typeof op.robotId==='string'?{...p,robot_id:op.robotId}:null;
  if(!next)throw new Error('Invalid inventory operation.');
  return parts.map(p=>p.id===op.partId?next:p);
}
