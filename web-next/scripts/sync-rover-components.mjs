// Keep the standalone component input table aligned with the source catalogue.
import {readFile,writeFile} from 'node:fs/promises';
const catalogue=JSON.parse(await readFile(new URL('../../catalog/parts.json',import.meta.url),'utf8'));
const target=new URL('../src/lib/components.ts',import.meta.url);
const text=await readFile(target,'utf8');
const start=text.indexOf('const CATALOGUE_ENVELOPE_ROWS: CatalogueEnvelopeRow[] = ');
const end=text.indexOf('export const CATALOGUE_COMPONENTS:',start);
if(start<0||end<0||!Array.isArray(catalogue.parts))throw new Error('Missing catalogue or component table boundaries.');
const rows=catalogue.parts.map(p=>[p.id,p.name||p.id,p.part_class||'',p.image||'assets/img/parts/tools.svg',typeof p.source==='string'?p.source:'',p.specs||{}]);
if(new Set(rows.map(r=>r[0])).size!==rows.length)throw new Error('Duplicate catalogue component IDs.');
const next=text.slice(0,start)+'const CATALOGUE_ENVELOPE_ROWS: CatalogueEnvelopeRow[] = '+JSON.stringify(rows)+';\n'+text.slice(end);
if(next!==text)await writeFile(target,next);
console.log(`sync-rover-components: ${rows.length} catalogue envelopes`);
