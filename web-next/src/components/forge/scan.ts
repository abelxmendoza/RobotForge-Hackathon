/* Scan (.ply) support for the Forge — a port of assets/js/scan.js's
 * pure core. Everything here is LOCAL: the file is parsed in the
 * visitor's browser and measured; it is never uploaded.
 *
 * Measurement honesty: the only measurement is the axis-aligned
 * bounding box of the uploaded points, and the unit rule is visible
 * on the card — metres assumed; a largest extent over 20 is treated
 * as millimetres and converted, SAYING SO; extents that are
 * implausible either way are reported raw instead of rescaled in
 * silence. A scan gives shape and size only: mass, motors and
 * voltage cannot come from a point cloud, and the UI says that too.
 */

const PLY_TYPES: Record<string, [number, string]> = {
  char: [1, 'i8'], int8: [1, 'i8'],
  uchar: [1, 'u8'], uint8: [1, 'u8'],
  short: [2, 'i16'], int16: [2, 'i16'],
  ushort: [2, 'u16'], uint16: [2, 'u16'],
  int: [4, 'i32'], int32: [4, 'i32'],
  uint: [4, 'u32'], uint32: [4, 'u32'],
  float: [4, 'f32'], float32: [4, 'f32'],
  double: [8, 'f64'], float64: [8, 'f64'],
};

function plyRead(dv: DataView, off: number, kind: string, le: boolean): number {
  switch (kind) {
    case 'i8': return dv.getInt8(off);
    case 'u8': return dv.getUint8(off);
    case 'i16': return dv.getInt16(off, le);
    case 'u16': return dv.getUint16(off, le);
    case 'i32': return dv.getInt32(off, le);
    case 'u32': return dv.getUint32(off, le);
    case 'f32': return dv.getFloat32(off, le);
    case 'f64': return dv.getFloat64(off, le);
    default: throw new Error('unknown PLY type kind ' + kind);
  }
}

export interface ParsedPly {
  count: number;
  positions: Float32Array;
  format: string;
}

export type Measure =
  | {
      ok: true;
      count: number;
      extentsM: [number, number, number];
      unitNote: string;
      center: [number, number, number];
      scale: number;
    }
  | {
      ok: false;
      count?: number;
      reason: string;
      rawExtents?: [number, number, number];
    };

/* Parse a PLY file (ascii or binary, vertex element first — the
 * layout RealSense Viewer, Scaniverse, Polycam and Meshroom all
 * export). Returns { count, positions (Float32Array, raw file
 * units), format }. Throws a plain-language Error on anything else:
 * an unsupported layout must fail loudly, never measure wrong. */
export function parsePly(buffer: ArrayBuffer): ParsedPly {
  const bytes = new Uint8Array(buffer);
  const headText = new TextDecoder('ascii').decode(
    bytes.subarray(0, Math.min(bytes.length, 1 << 16)),
  );
  let format: string | null = null;
  let vertexCount = -1;
  let props: { type: string; name: string }[] | null = null;
  let inVertex = false;
  let headerDone = false;
  let headerBytes = 0;
  let pos = 0;
  let firstLine = true;
  while (pos < headText.length) {
    const nl = headText.indexOf('\n', pos);
    if (nl < 0) break;
    const line = headText.slice(pos, nl).trim();
    pos = nl + 1;
    if (firstLine) {
      firstLine = false;
      if (line !== 'ply') {
        throw new Error('this does not look like a PLY file (no ply header)');
      }
    }
    if (line === 'end_header') {
      headerDone = true;
      headerBytes = pos;
      break;
    }
    const tok = line.split(/\s+/);
    if (tok[0] === 'format') {
      format = tok[1];
    } else if (tok[0] === 'element') {
      if (props === null && tok[1] !== 'vertex') {
        throw new Error(
          'this PLY layout is not supported yet: the vertex element is not first (found "' +
            tok[1] +
            '" first)',
        );
      }
      inVertex = tok[1] === 'vertex';
      if (inVertex) {
        vertexCount = parseInt(tok[2], 10);
        props = [];
      }
    } else if (tok[0] === 'property' && inVertex) {
      if (tok[1] === 'list') {
        throw new Error('this PLY layout is not supported yet: the vertex element carries a list property');
      }
      if (!PLY_TYPES[tok[1]]) {
        throw new Error('unknown PLY property type "' + tok[1] + '"');
      }
      if (props) props.push({ type: tok[1], name: tok[2] });
    }
  }
  if (!headerDone) throw new Error('the PLY header never ends');
  if (!format) throw new Error('the PLY header names no format');
  if (!props || vertexCount < 0) {
    throw new Error('the PLY file has no vertex element');
  }
  const xi = props.findIndex((p) => p.name === 'x');
  const yi = props.findIndex((p) => p.name === 'y');
  const zi = props.findIndex((p) => p.name === 'z');
  if (xi < 0 || yi < 0 || zi < 0) {
    throw new Error('the PLY vertices have no x/y/z coordinates');
  }
  const positions = new Float32Array(vertexCount * 3);
  if (format === 'ascii') {
    const body = new TextDecoder('ascii').decode(bytes.subarray(headerBytes));
    const toks = body.split(/\s+/).filter((t) => t.length);
    const stride = props.length;
    if (toks.length < vertexCount * stride) {
      throw new Error('the PLY body ends before all vertices are read');
    }
    for (let v = 0; v < vertexCount; v++) {
      const base = v * stride;
      positions[v * 3] = parseFloat(toks[base + xi]);
      positions[v * 3 + 1] = parseFloat(toks[base + yi]);
      positions[v * 3 + 2] = parseFloat(toks[base + zi]);
    }
  } else if (format === 'binary_little_endian' || format === 'binary_big_endian') {
    const le = format === 'binary_little_endian';
    const dv = new DataView(buffer, headerBytes);
    const stride = props.reduce((a, p) => a + PLY_TYPES[p.type][0], 0);
    const offsets: number[] = [];
    let off = 0;
    for (const p of props) {
      offsets.push(off);
      off += PLY_TYPES[p.type][0];
    }
    if (dv.byteLength < vertexCount * stride) {
      throw new Error('the PLY body ends before all vertices are read');
    }
    const kinds = props.map((p) => PLY_TYPES[p.type][1]);
    for (let v = 0; v < vertexCount; v++) {
      const base = v * stride;
      positions[v * 3] = plyRead(dv, base + offsets[xi], kinds[xi], le);
      positions[v * 3 + 1] = plyRead(dv, base + offsets[yi], kinds[yi], le);
      positions[v * 3 + 2] = plyRead(dv, base + offsets[zi], kinds[zi], le);
    }
  } else {
    throw new Error('unsupported PLY format "' + format + '"');
  }
  return { count: vertexCount, positions, format };
}

/* Axis-aligned bounding box with the visible unit rule. Returns
 * { ok, count, extentsM: [x, y, z], unitNote } or { ok: false,
 * reason, rawExtents } when the extents are implausible either way —
 * reported raw, never silently rescaled. */
export function measureCloud(positions: Float32Array): Measure {
  const n = Math.floor(positions.length / 3);
  if (!n) return { ok: false, reason: 'the cloud has no points' };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const raw: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const maxExt = Math.max(raw[0], raw[1], raw[2]);
  if (!Number.isFinite(maxExt)) {
    return { ok: false, reason: 'the cloud coordinates are not finite numbers' };
  }
  let scale = 1;
  let unitNote = '';
  if (maxExt > 20) {
    scale = 0.001;
    unitNote = 'file appears to be in millimetres — converted to metres';
  }
  const extentsM = raw.map((e) => e * scale) as [number, number, number];
  if (maxExt * scale < 0.001) {
    return {
      ok: false,
      count: n,
      rawExtents: raw,
      reason:
        'the largest extent is under a millimetre in the file’s own units — too small to be a robot scan; check what the file really holds',
    };
  }
  return {
    ok: true,
    count: n,
    extentsM,
    unitNote,
    center: [
      ((min[0] + max[0]) / 2) * scale,
      ((min[1] + max[1]) / 2) * scale,
      ((min[2] + max[2]) / 2) * scale,
    ],
    scale,
  };
}
