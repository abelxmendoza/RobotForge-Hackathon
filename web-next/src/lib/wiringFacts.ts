import type { Wiring } from './wiring';
export const NODE_FACTS = ['rated_min_v','rated_max_v','output_min_v','output_max_v','current_a','output_current_a'] as const;
export const CONNECTION_FACTS = ['volts','volts_min_v','volts_max_v','current_a','gauge_awg','length_mm','from_pin','to_pin'] as const;
export function saveWiringFacts(w: Wiring, target: 'node' | 'connection', index: number, values: Record<string,string>): Wiring {
  const allowed: readonly string[] = target === 'node' ? NODE_FACTS : CONNECTION_FACTS;
  const patch: Record<string,unknown> = {};
  for (const [key,raw] of Object.entries(values)) {
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
    const value = raw.trim();
    if (key.endsWith('_pin')) { patch[key] = value || undefined; continue; }
    if (!value) { patch[key] = undefined; continue; }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (key !== 'current_a' && key !== 'output_current_a' && key !== 'gauge_awg' && number === 0) || (key === 'gauge_awg' && (number > 40 || !Number.isInteger(number)))) throw new Error(`${key}: enter a finite ${key === 'gauge_awg' ? 'integer from 0 to 40' : key.includes('current') ? 'number ≥ 0' : 'number > 0'}.`);
    patch[key] = number;
  }
  if (target === 'node') {
    if (!w.nodes[index]) throw new Error('Unknown node');
    return {...w,nodes:w.nodes.map((n,i)=>i===index ? {...n,...patch,electrical_facts_source:'user-entered; unverified'} : n)};
  }
  if (!w.connections[index]) throw new Error('Unknown connection');
  return {...w,connections:w.connections.map((c,i)=> {
    if (i!==index) return c;
    const {gauge_awg,length_mm,...fields} = patch;
    const cable = {...c.cable};
    if ('gauge_awg' in patch) cable.gauge_awg = gauge_awg as number | undefined;
    if ('length_mm' in patch) cable.length_mm = length_mm as number | undefined;
    return {...c,...fields,cable,electrical_facts_source:'user-entered; unverified'};
  })};
}
