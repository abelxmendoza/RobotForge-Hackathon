import type {RoverCadSettings} from '@/lib/roverPackage';
/** Dimensioned orthographic preview of the same box, cavity and openings as OpenSCAD. */
export default function EnclosureDrawing({settings:e}:{settings:NonNullable<RoverCadSettings['enclosure']>}){
 const scale=Math.min(240/e.length_mm,100/e.width_mm,85/e.height_mm);
 const l=e.length_mm*scale,w=e.width_mm*scale,h=e.height_mm*scale,t=e.wall_mm*scale;
 return <figure><svg viewBox="0 0 320 310" role="img" aria-label={`Enclosure drawing: ${e.length_mm} by ${e.width_mm} by ${e.height_mm} millimetres, ${e.cable_count} cable openings`} style={{width:'100%',background:'#0b1420',borderRadius:12}}>
  <g transform="translate(35 35)" stroke="#5eead4" strokeWidth="1.4" fill="none">
   <rect width={l} height={w} fill="#244a50"/><rect x={t} y={t} width={l-2*t} height={w-2*t} fill="#0b1420"/>
   <text y={-12} stroke="none" fill="#e2eeee" fontSize="12">Top: box and open cavity</text>
   <text x={l/2} y={w+18} textAnchor="middle" stroke="none" fill="#b5c9d3" fontSize="11">{e.length_mm} × {e.width_mm} mm</text>
  </g>
  <g transform="translate(35 190)" stroke="#5eead4" strokeWidth="1.4" fill="none">
   <rect width={l} height={h} fill="#244a50"/>
   {Array.from({length:e.cable_count},(_,i)=><circle key={i} cx={(e.wall_mm+(i+1)*(e.length_mm-2*e.wall_mm)/(e.cable_count+1))*scale} cy={(e.height_mm-e.wall_mm)/2*scale} r={e.cable_dia_mm/2*scale} fill="#0b1420"/>)}
   <text y={-12} stroke="none" fill="#e2eeee" fontSize="12">Front: circular cable openings</text>
   <text y={h+19} stroke="none" fill="#b5c9d3" fontSize="11">Height {e.height_mm} mm · wall {e.wall_mm} mm</text>
  </g>
 </svg><figcaption className="faint g-small">Dimensions match the saved enclosure parameters. Separate locating-lip lid; {e.clearance_mm} mm clearance per side. Check fit in OpenSCAD before printing.</figcaption></figure>;
}
