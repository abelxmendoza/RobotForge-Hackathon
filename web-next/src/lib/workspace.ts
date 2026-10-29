/** Small, deterministic table/query layer. No model-generated arithmetic. */
export type Cell = string | number | boolean | null;
export interface DataTable { id: string; name: string; source: string; columns: string[]; rows: Record<string, Cell>[]; imported?: boolean; }
export function parseCSV(text: string, name = 'Imported spreadsheet'): DataTable {
  if (text.length > 2_000_000) throw Error('Use a CSV smaller than 2 MB.');
  const grid: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const finishField = () => { row.push(field); field = ''; closed = false; if (row.length > 100) throw Error('At most 100 columns are supported.'); };
  const finishRow = () => { finishField(); if (row.some(v => v.trim())) grid.push(row); row = []; if (grid.length > 10001) throw Error('At most 10,000 data rows are supported.'); };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; }
    else if (c === ',' ) finishField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i+1] === '\n') i++; finishRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed && c.trim()) throw Error('Unexpected text after a quoted CSV field.'); if (c === '"') throw Error('Quote the entire CSV field.'); if (!closed) field += c; }
  }
  if (quoted) throw Error('An opening quote has no closing quote.');
  if (field || row.length || closed) finishRow();
  if (grid.length < 2) throw Error('Include a header and at least one data row.');
  const columns = grid.shift()!.map(h => h.trim());
  if (columns.some(h => !h || ['__proto__','constructor','prototype'].includes(h)) || new Set(columns).size !== columns.length) throw Error('Column names must be unique and nonempty.');
  const rows = grid.map((values, index) => { if (values.length !== columns.length) throw Error(`Row ${index+2} has ${values.length} cells; expected ${columns.length}.`); return Object.fromEntries(columns.map((c,i) => [c, values[i].trim() === '' ? null : numeric(values[i]) ?? values[i]])); });
  return {id: 'import-'+name.replace(/[^a-z0-9]/gi,'-').slice(0,70), name, source: 'User CSV: '+name, columns, rows, imported:true};
}
export function numeric(value: Cell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function checkUnits(table:DataTable,column:string){
 if(!table.columns.includes('unit')||!['error','measured','reference'].includes(column))return;
 const units=new Set(table.rows.filter(r=>numeric(r[column])!==null).map(r=>r.unit).filter(v=>v!==null&&v!==undefined&&v!==''));
 if(units.size>1)throw Error('Mixed units in '+column+'. Search for one unit, then use “Analyze matching rows” to create a separate table.');
}
export function columnStats(table: DataTable, column: string) {
  checkUnits(table,column);
  if (!table.columns.includes(column)) throw Error('Choose a column in this table.');
  const values = table.rows.map(row => numeric(row[column])).filter((x): x is number => x !== null).sort((a,b)=>a-b);
  if (!values.length) throw Error(`No numeric observations in ${column}. Missing cells and text are excluded.`);
  const n=values.length, mean=values.reduce((a,b)=>a+b,0)/n;
  if(!Number.isFinite(mean))throw Error("Values overflowed the calculation; check units and magnitude.");
  const variance=n>1 ? values.reduce((s,v)=>s+(v-mean)**2,0)/(n-1) : null;
  if(variance!==null&&!Number.isFinite(variance))throw Error("Values overflowed the variance calculation.");
  const mid=Math.floor(n/2), median=n%2 ? values[mid] : (values[mid-1]+values[mid])/2;
  return {n, excluded:table.rows.length-n, mean, median, min:values[0], max:values[n-1], sampleStdDev:variance===null?null:Math.sqrt(variance)};
}
export function empiricalProbability(table: DataTable, column: string, operator: string, target: string) {
  if (!table.columns.includes(column)) throw Error('Unknown column.');
  if (!['=','>','<','>=','<='].includes(operator)) throw Error('Use =, >, <, >= or <=.');
  const numericTarget=numeric(target), ordered=operator!=='=';
  if(numericTarget!==null)checkUnits(table,column);
  if (ordered && numericTarget===null) throw Error('Inequalities require a numeric threshold.');
  let count=0,n=0;
  for (const row of table.rows) {
    const raw=row[column]; if (raw===null || raw===undefined || raw==='') continue;
    if (ordered) { const value=numeric(raw); if(value===null)continue;n++;if(operator==='>'?value>numericTarget!:operator==='<'?value<numericTarget!:operator==='>='?value>=numericTarget!:value<=numericTarget!) count++; }
    else { if(numericTarget!==null){const value=numeric(raw);if(value===null)continue;n++;if(value===numericTarget)count++;}else{n++;if(String(raw).toLowerCase()===target.toLowerCase())count++;} }
  }
  if (!n) throw Error('No eligible observations for this condition.');
  const p=count/n,z=1.95996398454,d=1+z*z/n,center=(p+z*z/(2*n))/d,half=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;
  return {count,n,excluded:table.rows.length-n,rate:p,interval95:[Math.max(0,center-half),Math.min(1,center+half)]};
}
export function association(table: DataTable, x: string, y: string) {
  checkUnits(table,x);checkUnits(table,y);
  if (!table.columns.includes(x)||!table.columns.includes(y)||x===y) throw Error('Choose two different numeric columns.');
  const pairs=table.rows.map(row=>[numeric(row[x]),numeric(row[y])]).filter((p):p is [number,number]=>p[0]!==null&&p[1]!==null);
  if(pairs.length<3)throw Error('Association needs at least three complete numeric pairs.');
  const n=pairs.length,mx=pairs.reduce((s,p)=>s+p[0],0)/n,my=pairs.reduce((s,p)=>s+p[1],0)/n;
  const xx=pairs.reduce((s,p)=>s+(p[0]-mx)**2,0),yy=pairs.reduce((s,p)=>s+(p[1]-my)**2,0),xy=pairs.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0);
  if(![xx,yy,xy,mx,my].every(Number.isFinite))throw Error('Values overflowed the association calculation.');
  if(xx===0||yy===0)throw Error('Both columns must vary.');
  return {n,excluded:table.rows.length-n,slope:xy/xx,intercept:my-xy/xx*mx,correlation:xy/Math.sqrt(xx*yy),rSquared:xy*xy/(xx*yy)};
}
export function exportCSV(table: DataTable): string {
  const quote=(v: Cell | undefined) => { let s=String(v??''); if(/^[\s]*[=+@-]/.test(s) && numeric(v)===null)s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
  return [table.columns,...table.rows.map(r=>table.columns.map(c=>r[c]))].map(row=>row.map(quote).join(',')).join('\r\n');
}
export function validTable(value: unknown): value is DataTable {
  if(!value || typeof value!=='object')return false; const t=value as DataTable;
  return typeof t.id==='string'&&typeof t.name==='string'&&typeof t.source==='string'&&Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=100&&t.columns.every(c=>typeof c==='string'&&!['__proto__','constructor','prototype'].includes(c))&&new Set(t.columns).size===t.columns.length&&Array.isArray(t.rows)&&t.rows.length<=10000&&t.rows.every(r=>r&&typeof r==='object'&&t.columns.every(c=>r[c]===null||typeof r[c]==='string'||typeof r[c]==='boolean'||(typeof r[c]==='number'&&Number.isFinite(r[c]))));
}
export interface RobotRecord { id:string; name:string; relationship:'owned'|'research'|'sighting'; category:string; notes:string; location:string; observedAt:string; sources:string[]; spec:Record<string,unknown>; photo?:string; updatedAt:string; }
export function validRecord(value:unknown):value is RobotRecord {
  if(!value||typeof value!=='object')return false;const r=value as RobotRecord;
  return ['id','name','category','notes','location','observedAt','updatedAt'].every(k=>typeof (r as unknown as Record<string,unknown>)[k]==='string')&&['owned','research','sighting'].includes(r.relationship)&&Array.isArray(r.sources)&&r.sources.length<=30&&r.sources.every(s=>typeof s==='string'&&/^https:\/\//.test(s))&&r.spec!==null&&typeof r.spec==='object'&&!Array.isArray(r.spec)&&(!r.photo||typeof r.photo==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(r.photo)&&r.photo.length<400000);
}
