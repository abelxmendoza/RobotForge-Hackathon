/** Offline checks on recorded quantities. Coverage and severity are independent. */
type RecordData = { [key: string]: unknown };
interface NodeData { id: string; label: string }
interface ConnectionData { from: string; to: string; kind: string; cable?: unknown }
export interface HarnessData { nodes: NodeData[]; connections: ConnectionData[] }
export interface HarnessCheck { check: string; subject: string; coverage: 'CHECKED' | 'PARTIAL' | 'NOT_CHECKED'; severity: 'INFO' | 'WARN' | 'ERROR'; detail: string; missing: string[]; values?: Record<string, number> }
const record = (v: unknown): RecordData => v && typeof v === 'object' ? v as RecordData : {};
const num = (v: unknown, positive = false): number | undefined => typeof v === 'number' && Number.isFinite(v) && (positive ? v > 0 : v >= 0) ? v : undefined;
const text = (v: unknown): string => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
export function harnessPlan(w: HarnessData) {
  const checks: HarnessCheck[] = [];
  const nodes = new Map(w.nodes.map(n => [n.id, record(n)]));
  const power = w.connections.filter(c => c.kind === 'power');
  const draw = (c: ConnectionData, seen = new Set<string>()): number | undefined => {
    const direct = record(c).current_a;
    if (direct != null) return num(direct);
    if (seen.has(c.to) || power.filter(e => e.to === c.to).length > 1) return undefined;
    const children = power.filter(e => e.from === c.to);
    const own = num(nodes.get(c.to)?.current_a);
    if (!children.length) return own;
    if (own === undefined) return undefined;
    // Do not sum amperes across a voltage converter without efficiency/input-current data.
    const inV = num(record(c).volts, true);
    if (children.some(e => num(record(e).volts, true) !== inV) || inV === undefined) return undefined;
    const values = children.map(e => draw(e, new Set([...seen, c.to])));
    return values.some(v => v === undefined) ? undefined : values.reduce<number>((a, b) => a + b!, own);
  };
  for (const c of power) {
    const d = record(c), target = nodes.get(c.to), source = nodes.get(c.from), subject = `${c.from} → ${c.to}`;
    const fixed = num(d.volts, true);
    const lo = num(d.volts_min_v, true) ?? num(source?.output_min_v, true) ?? fixed;
    const hi = num(d.volts_max_v, true) ?? num(source?.output_max_v, true) ?? fixed;
    const min = num(target?.rated_min_v, true), max = num(target?.rated_max_v, true);
    const missing = [...(lo === undefined ? ['volts_min_v or fixed volts'] : []), ...(hi === undefined ? ['volts_max_v or fixed volts'] : []), ...(min === undefined ? [`${c.to}.rated_min_v`] : []), ...(max === undefined ? [`${c.to}.rated_max_v`] : [])];
    const invalidVoltage = [[d, ['volts','volts_min_v','volts_max_v']], [source, ['output_min_v','output_max_v']], [target, ['rated_min_v','rated_max_v']]].some(([obj,keys]) => (keys as string[]).some(k => { const v = (obj as RecordData | undefined)?.[k]; return v != null && num(v,true) === undefined; }));
    if (invalidVoltage) missing.push('invalid voltage quantity: finite number > 0 required; correct recorded values');
    const invalid = invalidVoltage || (lo !== undefined && hi !== undefined && lo > hi) || (min !== undefined && max !== undefined && min > max) || !target || !source;
    const bad = invalid || (lo !== undefined && min !== undefined && lo < min) || (hi !== undefined && max !== undefined && hi > max);
    checks.push({check:'voltage_range',subject,coverage:invalid ? 'NOT_CHECKED' : missing.length ? (lo !== undefined || hi !== undefined) && (min !== undefined || max !== undefined) ? 'PARTIAL' : 'NOT_CHECKED' : 'CHECKED',severity:bad ? 'ERROR':'INFO',missing,detail:invalid ? 'Invalid range or unknown endpoint; correct the record.' : bad ? 'Recorded supply extends outside the recorded operating range.' : missing.length ? 'Only recorded voltage bounds can be compared.' : 'Recorded supply is inside both operating bounds.'});
    const cable = record(c.cable), gauge = num(cable.gauge_awg ?? cable.awg), length = num(cable.length_mm, true), amps = draw(c);
    const dropMissing = [...(gauge === undefined || gauge > 40 || !Number.isInteger(gauge) ? ['cable.gauge_awg (0–40)'] : []), ...(length === undefined ? ['cable.length_mm (>0)'] : []), ...(amps === undefined ? ['connection.current_a or unambiguous downstream currents at the same voltage'] : []), ...(fixed === undefined ? ['fixed connection.volts (>0)'] : [])];
    const area = gauge === undefined ? 0 : Math.PI / 4 * (0.127 * 92 ** ((36 - gauge) / 39)) ** 2;
    if (invalidVoltage) dropMissing.push('invalid recorded voltage quantity');
    const drop = dropMissing.length ? undefined : 0.01724 * 2 * length! / 1000 / area * amps!;
    const pct = drop === undefined ? undefined : 100 * drop / fixed!;
    checks.push({check:'voltage_drop',subject,coverage:dropMissing.length ? 'NOT_CHECKED':'CHECKED',severity:pct !== undefined && pct > 3 ? 'WARN':'INFO',missing:dropMissing,detail:'Copper loop estimate at 20°C; warning above 3%. Does not check ampacity, temperature or connector resistance.',...(drop === undefined ? {} : {values:{drop_v:drop,drop_pct:pct!}})});
  }
  for (const n of w.nodes) {
    const branches = power.filter(c => c.from === n.id);
    if (!branches.length) continue;
    const d = record(n), rating = num(d.output_current_a ?? d.rated_output_a ?? d.max_output_a);
    const currents = branches.map(c => draw(c, new Set([n.id])));
    const missing = [...(rating === undefined ? [`${n.id}.output_current_a`] : []), ...branches.filter((_, i) => currents[i] === undefined).map(c => `${c.from} → ${c.to}: current_a (cycles, shared feeds or voltage conversion require explicit branch current)`)];
    const total = currents.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    checks.push({check:'rail_budget',subject:`${n.id} rail`,coverage:rating === undefined || currents.every(v=>v===undefined) ? 'NOT_CHECKED' : missing.length ? 'PARTIAL':'CHECKED',severity:rating !== undefined && total > rating ? 'ERROR':'INFO',missing,detail:rating !== undefined && total > rating ? 'Known branch current already exceeds rated output.' : 'Sum of recorded/resolvable outgoing branch currents; separate voltage rails require separate source nodes.',values:{known_load_a:total,...(rating === undefined ? {}:{rated_output_a:rating})}});
  }
  return { checks, converterAdvice:'No converter selected. A sourced exact SKU, input operating range, regulated output range, continuous output current at the recorded input/output and thermal conditions, and load current are required. Nominal voltage or a product name alone is insufficient.' };
}
const csvCell = (v: unknown) => '"' + text(v).replaceAll('"','""') + '"';
export function harnessCSV(w: HarnessData): string {
  const fields = ['from','from_pin','to','to_pin','kind','volts','current_a','gauge_awg','length_mm','connector_from','connector_to'];
  return [fields.join(','), ...w.connections.map(c => { const d = record(c), cable = record(c.cable); return fields.map(k=>csvCell(d[k] ?? cable[k])).join(','); })].join('\n');
}
export function wirevizYAML(w: HarnessData): {yaml: string | null; missing: string[]} {
  const missing: string[] = [];
  if (!w.connections.length) missing.push('at least one documented connection');
  w.connections.forEach((c,i) => { const d = record(c); for (const k of ['from_pin','to_pin']) if (!text(d[k])) missing.push(`connection ${i+1} ${c.from} → ${c.to}: ${k}`); for (const id of [c.from,c.to]) if (!w.nodes.some(n=>n.id===id)) missing.push(`connection ${i+1}: node ${id}`); });
  if (missing.length) return {yaml:null,missing};
  // JSON is a YAML 1.2 subset. Dedicated one-wire cable per recorded connection;
  // connector groupings and pin numbers are never inferred from labels.
  const connectors: Record<string,{pins:string[]}> = {};
  for (const c of w.connections) for (const [id,pin] of [[c.from,text(record(c).from_pin)],[c.to,text(record(c).to_pin)]]) { connectors[id] ??= {pins:[]}; if (!connectors[id].pins.includes(pin)) connectors[id].pins.push(pin); }
  const cables = Object.fromEntries(w.connections.map((_,i)=>[`W${i+1}`,{wirecount:1}]));
  const connections = w.connections.map((c,i)=>[{[c.from]:[text(record(c).from_pin)]},{[`W${i+1}`]:[1]},{[c.to]:[text(record(c).to_pin)]}]);
  return {yaml:JSON.stringify({connectors,cables,connections},null,2),missing:[]};
}
