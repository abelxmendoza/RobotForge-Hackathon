/* Parametric CAD generation for the chat — pure, zero imports, no
 * DOM, so a node-driven pin test can compile and run it standalone
 * (same convention as lib/webIntent.ts and lib/wavEncode.ts).
 *
 * The chat can turn stated dimensions ("make a mounting plate
 * 80x60, 3mm thick, M3 holes") into an OpenSCAD file in the
 * RobotForge CAD-kit style: a plain-language parameter section,
 * then simple geometry built only from those parameters.
 *
 * Honesty rules, same as everywhere else in RobotForge:
 * - Generated geometry is ESTIMATED / PLANNED. It comes from
 *   dimensions someone typed in chat — it is NOT measured from a
 *   real part, and the generated file says so in its header.
 * - Anything the user did not state falls back to a template
 *   default, and that parameter's generated comment is labelled
 *   with the DEFAULT marker so nobody mistakes a guess for a
 *   stated size. defaultsUsed and the summary name them too.
 * - parseCadRequest is deliberately conservative: it only fires
 *   on a clear making ask (or the word scad/openscad) for one of
 *   the four known templates, and it only records a parameter
 *   when the text actually states it. Anything else is null. */

export type CadTemplateId = 'mounting_plate' | 'l_bracket' | 'wheel_disc' | 'spacer';

export interface CadParam { key: string; label: string; value: number; unit: string; specified: boolean }

export interface CadRequest { template: CadTemplateId; params: Record<string, number>; }

export interface CadResult {
  template: CadTemplateId;
  filename: string;           // e.g. 'mounting_plate.scad'
  source: string;              // full .scad text
  params: CadParam[];          // every parameter, in header order, with specified flags
  defaultsUsed: string[];      // labels of params that fell back to defaults
  summary: string;             // 2-4 plain sentences for a chat reply
}

/* One parameter of a template, in header order. `def` is the
 * template default used (and labelled as a default) when the user
 * did not state the size; `desc` becomes the plain-language
 * comment above the parameter in the generated file. Some
 * parameters may legitimately be 0 (no holes, no bolt circle);
 * the rest must be positive to be accepted. */
interface ParamDef {
  key: string; label: string; def: number; unit: string; desc: string;
  integer?: boolean; zeroOk?: boolean;
}

interface TemplateDef { id: CadTemplateId; partName: string; filename: string; params: ParamDef[]; }

const TEMPLATES: Record<CadTemplateId, TemplateDef> = {
  mounting_plate: {
    id: 'mounting_plate', partName: 'Mounting plate', filename: 'mounting_plate.scad',
    params: [
      { key: 'length_mm', label: 'Length', def: 100, unit: 'mm', desc: 'Length of the plate, along the X axis' },
      { key: 'width_mm', label: 'Width', def: 80, unit: 'mm', desc: 'Width of the plate, along the Y axis' },
      { key: 'thickness_mm', label: 'Thickness', def: 3, unit: 'mm', desc: 'Thickness of the plate' },
      { key: 'hole_dia_mm', label: 'Hole diameter', def: 3.2, unit: 'mm', desc: 'Diameter of each mounting hole (3.2 mm is M3 clearance)' },
      { key: 'hole_count', label: 'Hole count', def: 4, unit: '', desc: 'Number of holes: 0 for none, 2 along the length centreline, or 4 at the corners', integer: true, zeroOk: true },
      { key: 'hole_inset_mm', label: 'Hole inset', def: 8, unit: 'mm', desc: 'How far each corner hole centre sits in from the plate edges; also sets the corner radius' },
    ],
  },
  l_bracket: {
    id: 'l_bracket', partName: 'L bracket', filename: 'l_bracket.scad',
    params: [
      { key: 'leg_a_mm', label: 'Leg A length', def: 50, unit: 'mm', desc: 'Length of leg A, the vertical leg' },
      { key: 'leg_b_mm', label: 'Leg B length', def: 40, unit: 'mm', desc: 'Length of leg B, the horizontal leg' },
      { key: 'width_mm', label: 'Width', def: 30, unit: 'mm', desc: 'Width of the bracket, the same for both legs' },
      { key: 'thickness_mm', label: 'Thickness', def: 3, unit: 'mm', desc: 'Wall thickness of both legs' },
      { key: 'hole_dia_mm', label: 'Hole diameter', def: 3.2, unit: 'mm', desc: 'Diameter of the hole in each leg (3.2 mm is M3 clearance)' },
      { key: 'holes_per_leg', label: 'Holes per leg', def: 1, unit: '', desc: 'Holes drilled in each leg, spaced evenly along the leg and centred across its width', integer: true, zeroOk: true },
    ],
  },
  wheel_disc: {
    id: 'wheel_disc', partName: 'Wheel disc', filename: 'wheel_disc.scad',
    params: [
      { key: 'diameter_mm', label: 'Diameter', def: 100, unit: 'mm', desc: 'Outside diameter of the disc' },
      { key: 'thickness_mm', label: 'Thickness', def: 6, unit: 'mm', desc: 'Thickness of the disc itself, not counting the raised hub' },
      { key: 'bore_dia_mm', label: 'Centre bore diameter', def: 6, unit: 'mm', desc: 'Centre bore, sized for the axle that passes through it' },
      { key: 'hub_dia_mm', label: 'Hub diameter', def: 24, unit: 'mm', desc: 'Diameter of the raised hub ring on one face' },
      { key: 'hub_height_mm', label: 'Hub height', def: 4, unit: 'mm', desc: 'How far the hub ring stands proud of the disc face', zeroOk: true },
      { key: 'bolt_circle_dia_mm', label: 'Bolt circle diameter', def: 0, unit: 'mm', desc: 'Bolt circle for 4 lightening/bolt holes; 0 means no bolt holes', zeroOk: true },
      { key: 'bolt_hole_dia_mm', label: 'Bolt hole diameter', def: 3.2, unit: 'mm', desc: 'Diameter of each bolt hole on the bolt circle (3.2 mm is M3 clearance)' },
    ],
  },
  spacer: {
    id: 'spacer', partName: 'Spacer (standoff)', filename: 'spacer.scad',
    params: [
      { key: 'length_mm', label: 'Length', def: 20, unit: 'mm', desc: 'Length of the spacer, which sets the gap it holds open' },
      { key: 'outer_dia_mm', label: 'Outer diameter', def: 10, unit: 'mm', desc: 'Outside diameter of the spacer body' },
      { key: 'bore_dia_mm', label: 'Bore diameter', def: 3.2, unit: 'mm', desc: 'Through bore, sized for the screw or shaft that passes through it (3.2 mm is M3 clearance)' },
    ],
  },
};

/* The exact label a defaulted parameter carries in the generated
 * comments. A parameter the user actually stated never gets it. */
const DEFAULT_MARKER = '(DEFAULT — not specified, change if needed)';

/* Format a number the way a person would write it in a .scad
 * file: no trailing zeros, no floating-point noise. */
function fmt(n: number): string { return String(parseFloat(n.toFixed(3))); }

/* A stated size is only believable inside a sane range. Anything
 * outside it is ignored rather than baked into geometry. */
function sane(n: number): boolean { return isFinite(n) && n > 0 && n <= 2000; }

/* Resolve a request against its template: stated values win,
 * everything else falls back to the template default and is
 * flagged as unspecified. Out-of-range or non-finite stated
 * values are treated as unstated rather than trusted. The plate
 * only knows how to lay out 0, 2 or 4 holes, so any other stated
 * count clamps to the 4-corner layout — and the generated file
 * says so in a comment instead of quietly doing something else. */
function resolveParams(def: TemplateDef, req: CadRequest): { params: CadParam[]; clampedHoleCount: number | null } {
  let clampedHoleCount: number | null = null;
  const params: CadParam[] = def.params.map((p) => {
    const raw = req.params ? req.params[p.key] : undefined;
    const specified = typeof raw === 'number' && isFinite(raw) && raw <= 2000 && (p.zeroOk ? raw >= 0 : raw > 0);
    let value = specified ? (raw as number) : p.def;
    if (specified && p.integer) value = Math.floor(value);
    if (def.id === 'mounting_plate' && p.key === 'hole_count' && specified && value !== 0 && value !== 2 && value !== 4) {
      clampedHoleCount = value;
      value = 4;
    }
    return { key: p.key, label: p.label, value, unit: p.unit, specified: Boolean(specified) };
  });
  return { params, clampedHoleCount };
}

function paramValue(params: CadParam[], key: string): number {
  for (const p of params) if (p.key === key) return p.value;
  return 0;
}

/* The geometry block for each template. It references ONLY the
 * named parameters above it in the file — no stated size is ever
 * hard-coded a second time down here, so editing a parameter in
 * OpenSCAD really does resize the part. */
function geometryLines(id: CadTemplateId): string[] {
  if (id === 'mounting_plate') {
    return [
      '// Plate body: a hull of four corner cylinders makes a rectangle',
      '// with rounded corners in one step. Holes are subtracted',
      '// afterwards, so hole_count 0 leaves a plain plate.',
      'difference() {',
      '  hull() {',
      '    for (x = [hole_inset_mm, length_mm - hole_inset_mm])',
      '      for (y = [hole_inset_mm, width_mm - hole_inset_mm])',
      '        translate([x, y, 0]) cylinder(h = thickness_mm, r = hole_inset_mm);',
      '  }',
      '  if (hole_count == 4) {',
      '    for (x = [hole_inset_mm, length_mm - hole_inset_mm])',
      '      for (y = [hole_inset_mm, width_mm - hole_inset_mm])',
      '        translate([x, y, -thickness_mm / 2]) cylinder(h = thickness_mm * 2, d = hole_dia_mm);',
      '  } else if (hole_count == 2) {',
      '    for (x = [hole_inset_mm, length_mm - hole_inset_mm])',
      '      translate([x, width_mm / 2, -thickness_mm / 2]) cylinder(h = thickness_mm * 2, d = hole_dia_mm);',
      '  }',
      '}',
    ];
  }
  if (id === 'l_bracket') {
    return [
      '// Two legs unioned at the corner: leg B lies flat along X, leg A',
      '// stands up along Z, and they overlap at the corner so the union',
      '// is one solid piece. Holes are subtracted afterwards, one set',
      '// per leg, each drilled straight through that leg.',
      'difference() {',
      '  union() {',
      '    cube([leg_b_mm, width_mm, thickness_mm]);',
      '    cube([thickness_mm, width_mm, leg_a_mm]);',
      '  }',
      '  if (holes_per_leg > 0) {',
      '    for (i = [0 : holes_per_leg - 1])',
      '      translate([(i + 1) * leg_b_mm / (holes_per_leg + 1), width_mm / 2, -thickness_mm / 2])',
      '        cylinder(h = thickness_mm * 2, d = hole_dia_mm);',
      '    for (i = [0 : holes_per_leg - 1])',
      '      translate([-thickness_mm / 2, width_mm / 2, (i + 1) * leg_a_mm / (holes_per_leg + 1)])',
      '        rotate([0, 90, 0]) cylinder(h = thickness_mm * 2, d = hole_dia_mm);',
      '  }',
      '}',
    ];
  }
  if (id === 'wheel_disc') {
    return [
      '// Disc plus a raised hub ring on the top face, unioned. The centre',
      '// bore is subtracted through both, and the bolt holes are',
      '// subtracted only when a bolt circle diameter greater than 0 is set.',
      'difference() {',
      '  union() {',
      '    cylinder(h = thickness_mm, d = diameter_mm);',
      '    translate([0, 0, thickness_mm]) cylinder(h = hub_height_mm, d = hub_dia_mm);',
      '  }',
      '  translate([0, 0, -(thickness_mm + hub_height_mm) / 2])',
      '    cylinder(h = (thickness_mm + hub_height_mm) * 2, d = bore_dia_mm);',
      '  if (bolt_circle_dia_mm > 0) {',
      '    for (i = [0 : 3])',
      '      rotate([0, 0, i * 360 / 4])',
      '        translate([bolt_circle_dia_mm / 2, 0, -thickness_mm / 2])',
      '          cylinder(h = thickness_mm * 2, d = bolt_hole_dia_mm);',
      '  }',
      '}',
    ];
  }
  return [
    '// A plain cylinder with the bore subtracted through it —',
    '// the simplest part in the kit.',
    'difference() {',
    '  cylinder(h = length_mm, d = outer_dia_mm);',
    '  translate([0, 0, -length_mm / 2]) cylinder(h = length_mm * 2, d = bore_dia_mm);',
    '}',
  ];
}

/* The chat summary: what was made with its key sizes, that it is
 * estimated/planned rather than measured, and which parameters
 * fell back to defaults. */
function buildSummary(def: TemplateDef, params: CadParam[], defaultsUsed: string[]): string {
  const v = (k: string) => fmt(paramValue(params, k));
  let made = '';
  if (def.id === 'mounting_plate') {
    const count = paramValue(params, 'hole_count');
    made = 'Generated a mounting plate, ' + v('length_mm') + ' x ' + v('width_mm') + ' mm and ' + v('thickness_mm') +
      ' mm thick, with ' + (count === 0 ? 'no holes' : count + ' holes of ' + v('hole_dia_mm') + ' mm') + '.';
  } else if (def.id === 'l_bracket') {
    made = 'Generated an L bracket with legs of ' + v('leg_a_mm') + ' mm and ' + v('leg_b_mm') + ' mm, ' + v('width_mm') +
      ' mm wide and ' + v('thickness_mm') + ' mm thick, with ' + v('hole_dia_mm') + ' mm holes in each leg.';
  } else if (def.id === 'wheel_disc') {
    const bc = paramValue(params, 'bolt_circle_dia_mm');
    made = 'Generated a wheel disc, ' + v('diameter_mm') + ' mm in diameter and ' + v('thickness_mm') + ' mm thick, with a ' +
      v('bore_dia_mm') + ' mm centre bore' + (bc > 0 ? ' and 4 bolt holes of ' + v('bolt_hole_dia_mm') + ' mm on a ' +
      v('bolt_circle_dia_mm') + ' mm bolt circle' : ' and no bolt holes') + '.';
  } else {
    made = 'Generated a spacer, ' + v('length_mm') + ' mm long with a ' + v('outer_dia_mm') +
      ' mm outer diameter and a ' + v('bore_dia_mm') + ' mm bore.';
  }
  const status = 'This is ESTIMATED / PLANNED geometry generated from the stated dimensions, not a measurement of a real part.';
  const defaults = defaultsUsed.length
    ? 'Defaults used for anything not stated: ' + defaultsUsed.join(', ') + '.'
    : 'No defaults were used — every parameter was stated.';
  return made + ' ' + status + ' ' + defaults;
}

/* Build the full .scad source plus the parameter record for a
 * request. Stated values are trusted only after the sanity checks
 * in resolveParams; everything else is a labelled default. */
export function generateCad(req: CadRequest): CadResult {
  const def = TEMPLATES[req.template];
  const { params, clampedHoleCount } = resolveParams(def, req);
  const defByKey: Record<string, ParamDef> = {};
  for (const p of def.params) defByKey[p.key] = p;
  const lines: string[] = [
    '// RobotForge CAD kit — GENERATED part',
    '// Part: ' + def.partName,
    '// Status: ESTIMATED / PLANNED geometry, generated from chat-stated dimensions — not measured from a real part.',
    '// Print material, orientation and fit must be confirmed before printing.',
  ];
  if (clampedHoleCount !== null) {
    lines.push('// Note: a hole count of ' + fmt(clampedHoleCount) +
      ' was requested, but this template lays out 0, 2 or 4 holes — clamped to 4.');
  }
  lines.push('', '// Parameters — every size used by the geometry below is', '// named here. Change a value here and the part resizes.');
  for (const p of params) {
    const pd = defByKey[p.key];
    lines.push('// ' + pd.desc + (p.specified ? '' : ' ' + DEFAULT_MARKER), p.key + ' = ' + fmt(p.value) + ';');
  }
  lines.push('', '$fn = 64;', '');
  for (const l of geometryLines(def.id)) lines.push(l);
  lines.push('');
  const defaultsUsed = params.filter((p) => !p.specified).map((p) => p.label);
  return { template: def.id, filename: def.filename, source: lines.join('\n'), params, defaultsUsed, summary: buildSummary(def, params, defaultsUsed) };
}

/* A making ask: a making verb, or the word scad/openscad. The
 * third way in — a template noun with dimensions present — is
 * checked in parseCadRequest itself. */
const MAKING_VERB_RE = /\b(make|generate|design|create|print|cad)\b/i;
const SCAD_RE = /\b(openscad|scad)\b/i;

/* True when the text carries at least one recognisable size: an
 * "80x60" pair, an mm figure, a diameter/radius/thickness word,
 * or the diameter symbol. Used to gate the weak template nouns
 * ("plate", "wheel") that are too ambiguous on their own. */
function hasDimension(text: string): boolean {
  return /\d\s*(?:x|×)\s*\d/.test(text) || /\d+(?:\.\d+)?\s*mm\b/i.test(text) ||
    text.indexOf('Ø') >= 0 || text.indexOf('ø') >= 0 || /\b(diameter|dia|radius|thick|thickness|bore)\b/i.test(text);
}

function hasDiameterLanguage(text: string): boolean {
  return /\b(diameter|dia|radius)\b/i.test(text) || text.indexOf('Ø') >= 0 || text.indexOf('ø') >= 0 ||
    /\d+(?:\.\d+)?\s*mm\s*(?:wheel|disc|disk)\b/i.test(text);
}

/* Which template a message is asking for, or null. Strong noun
 * phrases ("mounting plate", "l bracket", "spacer") match on
 * their own; the weak nouns "wheel" and "plate" only count with
 * the extra evidence noted beside them. More specific phrases
 * are checked before the generic ones. */
function detectTemplate(text: string): CadTemplateId | null {
  const t = text.toLowerCase();
  if (/\b(spacer|standoff)\b/.test(t)) return 'spacer';
  if (/\b(wheel\s+disc|wheel\s+disk|disc\s+wheel)\b/.test(t)) return 'wheel_disc';
  if (/\b(mounting\s+plate|mount\s+plate|base\s+plate)\b/.test(t)) return 'mounting_plate';
  if (/\b(l-bracket|l\s+bracket|angle\s+bracket|bracket)\b/.test(t)) return 'l_bracket';
  if (/\bwheel\b/.test(t) && hasDiameterLanguage(text)) return 'wheel_disc';
  if (/\bplate\b/.test(t) && hasDimension(text)) return 'mounting_plate';
  return null;
}

/* The first number captured by any of the patterns, or null.
 * Patterns are tried in order, so list the most specific first. */
function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] !== undefined) { const n = parseFloat(m[1]); if (isFinite(n)) return n; }
  }
  return null;
}

function setIfSane(params: Record<string, number>, key: string, n: number | null): void {
  if (n !== null && sane(n)) params[key] = n;
}

/* Pull every stated size for one template out of the text. Only
 * sizes the text actually states land in the result — that is
 * what the specified/default labelling in generateCad stands on,
 * so this function must never invent a value. */
function extractParams(id: CadTemplateId, text: string): Record<string, number> {
  const params: Record<string, number> = {};
  const t = text.toLowerCase();

  /* "80x60" or "80 x 60 x 3": the first two sizes are the face
   * dimensions of the plate / the two legs of the bracket, and a
   * third size, when present, is the thickness. Other templates
   * state their sizes by name instead, so pairs do not apply. */
  if (id === 'mounting_plate' || id === 'l_bracket') {
    const pair = t.match(/(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)(?:\s*(?:x|×)\s*(\d+(?:\.\d+)?))?/);
    if (pair) {
      if (id === 'mounting_plate') { setIfSane(params, 'length_mm', parseFloat(pair[1])); setIfSane(params, 'width_mm', parseFloat(pair[2])); }
      else { setIfSane(params, 'leg_a_mm', parseFloat(pair[1])); setIfSane(params, 'leg_b_mm', parseFloat(pair[2])); }
      if (pair[3] !== undefined) setIfSane(params, 'thickness_mm', parseFloat(pair[3]));
    }
  }

  /* Named lengths and widths ("length 120", "20mm long",
   * "30mm wide") — only for templates that have the parameter. */
  if (id === 'mounting_plate' || id === 'spacer') {
    setIfSane(params, 'length_mm', firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*long\b/, /\blength\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*long\b/]));
  }
  if (id === 'mounting_plate' || id === 'l_bracket') {
    setIfSane(params, 'width_mm', firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*wide\b/, /\bwidth\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
  }
  if (id === 'l_bracket') {
    setIfSane(params, 'leg_a_mm', firstNumber(t, [/\bleg\s*a\s*(?:is\s*)?(\d+(?:\.\d+)?)/, /\bvertical\s*leg\s*(?:is\s*)?(\d+(?:\.\d+)?)/]));
    setIfSane(params, 'leg_b_mm', firstNumber(t, [/\bleg\s*b\s*(?:is\s*)?(\d+(?:\.\d+)?)/, /\bhorizontal\s*leg\s*(?:is\s*)?(\d+(?:\.\d+)?)/]));
  }

  /* Thickness, for the templates that have one. */
  if (id === 'mounting_plate' || id === 'l_bracket' || id === 'wheel_disc') {
    setIfSane(params, 'thickness_mm', firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*thick\b/, /\bthickness\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /\bthick\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
  }

  /* Diameter and radius. For a wheel this is the disc diameter;
   * for a spacer a stated diameter is its outer diameter. A
   * radius is doubled — "radius 50" is a 100 mm disc. */
  if (id === 'wheel_disc' || id === 'spacer') {
    const diaKey = id === 'wheel_disc' ? 'diameter_mm' : 'outer_dia_mm';
    setIfSane(params, diaKey, firstNumber(t, [/[øØ]\s*(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*mm\s*(?:in\s*)?(?:diameter|dia\b)/, /\bouter\s*(?:diameter|dia)\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /\b(?:diameter|dia)\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
    const radius = firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*radius\b/, /\bradius\s*(?:of\s*)?(\d+(?:\.\d+)?)/]);
    if (radius !== null && params[diaKey] === undefined && sane(radius * 2)) params[diaKey] = radius * 2;
  }
  if (id === 'spacer') {
    setIfSane(params, 'outer_dia_mm', firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*outer\b/, /\bouter\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
  }

  /* Bores, for the wheel and the spacer. */
  if (id === 'wheel_disc' || id === 'spacer') {
    setIfSane(params, 'bore_dia_mm', firstNumber(t, [/(\d+(?:\.\d+)?)\s*mm\s*bore\b/, /\bbore\s*(?:diameter|dia)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
  }

  /* Screw-size holes: M3/M4/M5 map to their standard clearance
   * diameters. Only counted when the text is actually talking
   * about holes, screws, bolts or a bore — a stray "M3" naming
   * something else must not resize anything. */
  const screw = t.match(/\bm([345])\b/);
  if (screw && /\b(holes?|screws?|bolts?|bore)\b/.test(t)) {
    const clearance = screw[1] === '3' ? 3.2 : screw[1] === '4' ? 4.2 : 5.2;
    if (id === 'mounting_plate' || id === 'l_bracket') params.hole_dia_mm = clearance;
    if (id === 'spacer') params.bore_dia_mm = clearance;
    if (id === 'wheel_disc' && /\bbolt/.test(t)) params.bolt_hole_dia_mm = clearance;
  }

  /* Explicit hole sizes and counts. The count pattern must not
   * swallow the digit of an "M3 holes" phrase, so the digit run
   * may not be preceded by a letter or another digit. */
  if (id === 'mounting_plate' || id === 'l_bracket') {
    setIfSane(params, 'hole_dia_mm', firstNumber(t, [/\bholes?\s*(?:diameter|dia)\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*mm\s*holes?\b/]));
  }
  if (id === 'mounting_plate') {
    if (/\bno\s+holes?\b/.test(t)) params.hole_count = 0;
    else { const c = firstNumber(t, [/(?:^|[^a-z0-9])(\d+)\s*holes?\b/]); if (c !== null && sane(c)) params.hole_count = Math.floor(c); }
    setIfSane(params, 'hole_inset_mm', firstNumber(t, [/\binset\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*mm\s*inset\b/]));
  }
  if (id === 'l_bracket') {
    if (/\bno\s+holes?\b/.test(t)) params.holes_per_leg = 0;
    else { const c = firstNumber(t, [/(?:^|[^a-z0-9])(\d+)\s*holes?\s*per\s*leg\b/]); if (c !== null && sane(c)) params.holes_per_leg = Math.floor(c); }
  }

  /* Wheel extras: hub and bolt circle, each stated by name. */
  if (id === 'wheel_disc') {
    setIfSane(params, 'hub_dia_mm', firstNumber(t, [/\bhub\s*(?:diameter|dia)\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*mm\s*hub\s*(?:diameter|dia)\b/]));
    setIfSane(params, 'hub_height_mm', firstNumber(t, [/\bhub\s*height\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
    setIfSane(params, 'bolt_circle_dia_mm', firstNumber(t, [/\bbolt\s*circle\s*(?:diameter|dia)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/]));
    setIfSane(params, 'bolt_hole_dia_mm', firstNumber(t, [/\bbolt\s*holes?\s*(?:diameter|dia)\s*(?:of\s*)?(\d+(?:\.\d+)?)/, /\bbolt\s*holes?\s*(\d+(?:\.\d+)?)\s*mm\b/]));
  }
  return params;
}

/* Parse a chat message into a CAD request, or null when it is not
 * a clear making ask for a known template. The gate is: a making
 * verb, OR the word scad/openscad, OR a template noun phrase with
 * dimensions present. */
export function parseCadRequest(text: string): CadRequest | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const template = detectTemplate(t);
  if (!template) return null;
  if (!MAKING_VERB_RE.test(t) && !SCAD_RE.test(t) && !hasDimension(t)) return null;
  return { template, params: extractParams(template, t) };
}

/* Parse and generate in one step — the shape the chat wants. */
export function cadFromText(text: string): CadResult | null {
  const req = parseCadRequest(text);
  return req ? generateCad(req) : null;
}
