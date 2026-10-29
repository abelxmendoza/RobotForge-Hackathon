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
    ...(u.quantity ? { quantity: u.quantity } : {}),
    ...(u.condition ? { condition: u.condition } : {}),
    specs: { ...part.specs, ...(u.specs || {}) },
  };
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
  const confirmed = /\b(yes|yep|yeah|correct|confirm(ed)?|that'?s right|right)\b/.test(m);
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
