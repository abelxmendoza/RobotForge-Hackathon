'use strict';
/* Wiring & cabling view: a schematic of a spec's `wiring` block —
   battery on the left, loads on the right, every cable drawn once
   and labelled from the data. Cable facts (gauge, connector,
   length) come only from the spec's cable records; a field the data
   does not name renders as "not specified", never as a guess.
   Solid line = power, dashed line = data (colour is the second
   channel: amber power, steel blue data, red reserved for a
   recorded over-voltage). */

/* == wiring-logic:start == */
/* Pure logic over a wiring block. No DOM: the test suite extracts
   this block and runs it in Node against fixtures and the real
   spec files. */
function wvNodeMap(w) {
  const m = {};
  (w.nodes || []).forEach(n => { m[n.id] = n; });
  return m;
}
function wvDepths(w) {
  /* Supply depth of each node, BFS from the battery following
     connections in their from -> to direction (all kinds — the
     layout layers by wiring reach, like the electrical overlay).
     Unreached nodes sit one column past the deepest reached one. */
  const depth = {};
  (w.nodes || []).forEach(n => { depth[n.id] = Infinity; });
  if (!Object.prototype.hasOwnProperty.call(depth, 'battery')) return depth;
  depth.battery = 0;
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach(c => {
      if (depth[c.from] !== Infinity && depth[c.to] === Infinity) {
        depth[c.to] = depth[c.from] + 1; grew = true;
      }
    });
  }
  return depth;
}
function wvStage(w, depth, i) {
  const d = depth[w.connections[i].from];
  return d === Infinity ? Infinity : d + 1;
}
function wvBad(w) {
  /* Recorded over-voltage only: fixed-voltage power connection
     above the target's recorded rated maximum. Null volts or an
     unrated target can never be flagged. */
  const nodes = wvNodeMap(w), bad = new Set();
  (w.connections || []).forEach((c, i) => {
    const t = nodes[c.to];
    if (c.kind === 'power' && c.volts != null && t &&
        t.rated_max_v != null && c.volts > t.rated_max_v) bad.add(i);
  });
  return bad;
}
function wvVolts(v) {
  return v == null ? 'not specified' : (Math.round(v * 10) / 10) + ' V';
}
function wvShortLabel(node) {
  return node.label.split(' \u2014 ')[0].split(' (')[0];
}
function wvPowered(w, excludeId) {
  /* Node ids with a power path from the battery, over POWER edges
     only, optionally with one node removed from the graph. */
  const powered = new Set();
  if (excludeId === 'battery') return powered;
  if (!wvNodeMap(w).battery) return powered;
  powered.add('battery');
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach(c => {
      if (c.kind !== 'power') return;
      if (c.from === excludeId || c.to === excludeId) return;
      if (powered.has(c.from) && !powered.has(c.to)) {
        powered.add(c.to); grew = true;
      }
    });
  }
  return powered;
}
function wvFailure(w, deadId) {
  /* If this part dies: the nodes that had a power path and lose it
     (reverse reachability over power edges only — data links do not
     keep a part alive). Excludes the dead node itself. Sorted by
     node order in the spec. */
  const before = wvPowered(w, null), after = wvPowered(w, deadId);
  return (w.nodes || []).map(n => n.id)
    .filter(id => id !== deadId && before.has(id) && !after.has(id));
}
function wvTrace(w, id) {
  /* The paths through one node: ancestors (everything that can
     reach it) and descendants (everything it can reach), over all
     edges. A connection is on a through-path when its source can
     reach the node and its target is reachable from the node. */
  const anc = new Set([id]), desc = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach(c => {
      if (anc.has(c.to) && !anc.has(c.from)) { anc.add(c.from); grew = true; }
      if (desc.has(c.from) && !desc.has(c.to)) { desc.add(c.to); grew = true; }
    });
  }
  const conns = [], nodes = new Set([id]);
  (w.connections || []).forEach((c, i) => {
    if (anc.has(c.from) && desc.has(c.to)) {
      conns.push(i); nodes.add(c.from); nodes.add(c.to);
    }
  });
  return { nodes: [...nodes], conns };
}
function wvLayout(w) {
  /* Deterministic schematic layout: columns are BFS supply depth,
     rows keep the spec's node order within a column. */
  const depth = wvDepths(w);
  let maxDepth = 0;
  (w.nodes || []).forEach(n => {
    if (depth[n.id] !== Infinity) maxDepth = Math.max(maxDepth, depth[n.id]);
  });
  const cols = {};
  (w.nodes || []).forEach(n => {
    const d = depth[n.id] === Infinity ? maxDepth + 1 : depth[n.id];
    (cols[d] = cols[d] || []).push(n.id);
  });
  const BW = 170, BH = 54, GX = 208, GY = 94, X0 = 24, Y0 = 24;
  const pos = {};
  let maxRows = 0, maxCol = 0;
  Object.keys(cols).forEach(d => {
    maxCol = Math.max(maxCol, Number(d));
    maxRows = Math.max(maxRows, cols[d].length);
    cols[d].forEach((id, row) => {
      pos[id] = { col: Number(d), row,
                  x: X0 + Number(d) * GX, y: Y0 + row * GY };
    });
  });
  const width = X0 * 2 + maxCol * GX + BW;
  const height = Y0 * 2 + Math.max(0, maxRows - 1) * GY + BH;
  /* one entry per connection, endpoints offset so parallel cables
     between the same pair separate vertically */
  const pairCount = {}, pairSeen = {};
  (w.connections || []).forEach(c => {
    const k = [c.from, c.to].sort().join('|');
    pairCount[k] = (pairCount[k] || 0) + 1;
  });
  const edges = (w.connections || []).map((c, i) => {
    const a = pos[c.from], b = pos[c.to];
    if (!a || !b) return null;
    const k = [c.from, c.to].sort().join('|');
    const seen = pairSeen[k] || 0; pairSeen[k] = seen + 1;
    const off = (seen - (pairCount[k] - 1) / 2) * 13;
    const x1 = a.x + BW, y1 = a.y + BH / 2 + off;
    const x2 = b.x, y2 = b.y + BH / 2 + off;
    let d, mx, my;
    if (x2 > x1) {
      d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + 46) + ' ' + y1 + ', ' +
          (x2 - 46) + ' ' + y2 + ', ' + x2 + ' ' + y2;
      mx = (x1 + 3 * (x1 + 46) + 3 * (x2 - 46) + x2) / 8;
      my = (y1 + 3 * y1 + 3 * y2 + y2) / 8;
    } else {
      const lift = Math.min(y1, y2) - 40;
      d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + 52) + ' ' + lift + ', ' +
          (x2 - 52) + ' ' + lift + ', ' + x2 + ' ' + y2;
      mx = (x1 + x2) / 2; my = lift + 16;
    }
    return { i, d, mx, my, stage: wvStage(w, depth, i) };
  });
  return { pos, width, height, edges, depth,
           box: { w: BW, h: BH } };
}
function wvCableField(cable, field) {
  if (!cable || cable[field] == null) return 'not specified';
  if (field === 'gauge_awg') return cable.gauge_awg + ' AWG';
  if (field === 'length_mm') return cable.length_mm + ' mm';
  return String(cable[field]);
}
function wvConnectorShort(connector) {
  if (!connector) return null;
  const s = String(connector).split(' (')[0];
  return s.length > 24 ? s.slice(0, 23) + '\u2026' : s;
}
function wvBusName(label) {
  const words = ['Dynamixel', 'CSI', 'I2C', 'UART', 'USB', 'TTL',
                 'serial', 'PWM', 'encoder'];
  const low = ' ' + String(label || '').toLowerCase() + ' ';
  for (const word of words) {
    if (low.includes(word.toLowerCase())) return word;
  }
  return null;
}
function wvRole(w, id) {
  /* Plain-language role for a node, from its id and recorded label
     — names the part family, never an unsourced specific. */
  const n = wvNodeMap(w)[id];
  const label = n ? wvShortLabel(n).toLowerCase() : id;
  const has = s => label.includes(s) || id === s;
  if (id === 'battery') return 'the battery';
  if (has('regulator') || has('buck')) return 'the voltage regulator';
  if (has('distribution') || id === 'pdb') return 'the power distribution board';
  if (has('driver') && !has('dynamixel')) return 'the motor driver';
  if (has('dynamixel')) return 'the Dynamixel bus driver';
  if (has('esc') || id === 'esc') return 'the motor controllers (ESCs)';
  if (has('flight controller') || id === 'fc') return 'the flight controller';
  if (has('pixhawk')) return 'the flight controller';
  if (has('nano') || has('microcontroller') || has('arduino')) return 'the microcontroller';
  if (has('opencr')) return 'the OpenCR controller';
  if (has('raspberry') || has('computer') || has('controller board') ||
      id === 'controller') return 'the computer';
  if (has('control board')) return 'the control board';
  if (has('flight board')) return 'the flight board';
  if (has('lidar')) return 'the lidar';
  if (has('camera')) return 'the camera';
  if (has('imu')) return 'the IMU';
  if (has('ultrasonic')) return 'the ultrasonic ranger';
  if (has('servo') || has('motor')) return 'the motors';
  if (has('power supply')) return 'the power supply';
  return 'the ' + (n ? wvShortLabel(n).toLowerCase() : id);
}
function wvCallout(w, i) {
  /* One plain-language sentence about a connection, authored from
     its kind, its recorded voltage and its recorded label only. */
  const c = w.connections[i];
  const a = wvRole(w, c.from), b = wvRole(w, c.to);
  const bus = wvBusName(c.label);
  if (c.kind === 'power') {
    if (c.volts != null) {
      return 'Carries ' + wvVolts(c.volts) + ' power from ' + a +
             ' to ' + b + '.';
    }
    if (/pwm/i.test(c.label || '')) {
      return 'Sends power from ' + a + ' to ' + b + ' as PWM \u2014 ' +
             'switched on and off, not a steady voltage, so it is ' +
             'never voltage-checked.';
    }
    return 'Carries power from ' + a + ' to ' + b +
           '; the rail voltage is not specified.';
  }
  if (bus) {
    return 'Carries ' + bus + ' data between ' + a + ' and ' + b + '.';
  }
  return 'Carries data between ' + a + ' and ' + b + '.';
}
function wvEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function wvChipText(w, i, mode) {
  /* The label chip on a cable. Simple: the kind, plus the voltage
     on power cables. Full: also the recorded connector, gauge and
     length — each only when the data names it. */
  const c = w.connections[i];
  if (mode !== 'full') {
    return c.kind + (c.kind === 'power' ? ' \u00b7 ' + wvVolts(c.volts) : '');
  }
  const parts = [c.kind === 'power' ? wvVolts(c.volts) : 'data'];
  const conn = wvConnectorShort(c.cable && c.cable.connector);
  if (conn) parts.push(conn);
  if (c.cable && c.cable.gauge_awg != null) {
    parts.push(c.cable.gauge_awg + ' AWG');
  }
  if (c.cable && c.cable.length_mm != null) {
    parts.push(c.cable.length_mm + ' mm');
  }
  return parts.join(' \u00b7 ');
}
function wvDiagramSVG(w, mode) {
  /* The whole schematic as an SVG string: every connection drawn
     exactly once, every node drawn once, labels from the data. */
  const layout = wvLayout(w), bad = wvBad(w);
  let s = '';
  layout.edges.forEach(e => {
    if (!e) return;
    const c = w.connections[e.i];
    const text = wvChipText(w, e.i, mode);
    const tw = Math.max(34, text.length * 6.1 + 12);
    s += '<g class="wv-cable' + (bad.has(e.i) ? ' bad' : '') +
      '" data-conn="' + e.i + '" data-stage="' +
      (e.stage === Infinity ? 'inf' : e.stage) + '">' +
      '<path class="wv-hit" d="' + e.d + '"/>' +
      '<path class="wv-line ' + c.kind + '" d="' + e.d + '"/>' +
      (bad.has(e.i) ? '<text class="wv-badtag" x="' + e.mx + '" y="' +
        (e.my - 12) + '" text-anchor="middle">\u26a0 over-voltage</text>' : '') +
      '<g class="wv-chip"><rect x="' + (e.mx - tw / 2) + '" y="' +
      (e.my - 9) + '" width="' + tw + '" height="17" rx="8"/>' +
      '<text x="' + e.mx + '" y="' + (e.my + 3.5) +
      '" text-anchor="middle">' + wvEsc(text) + '</text></g></g>';
  });
  (w.nodes || []).forEach(n => {
    const p = layout.pos[n.id];
    if (!p) return;
    const label = wvShortLabel(n);
    s += '<g class="wv-node" data-node="' + n.id + '" data-depth="' +
      (layout.depth[n.id] === Infinity ? 'inf' : layout.depth[n.id]) +
      '" tabindex="0" role="button" aria-label="' + wvEsc(n.label) + '">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + layout.box.w +
      '" height="' + layout.box.h + '" rx="8"/>' +
      '<text class="wv-nl" x="' + (p.x + layout.box.w / 2) + '" y="' +
      (p.y + 23) + '" text-anchor="middle">' +
      wvEsc(label.length > 27 ? label.slice(0, 26) + '\u2026' : label) +
      '</text>' +
      '<text class="wv-req" x="' + (p.x + layout.box.w / 2) + '" y="' +
      (p.y + 40) + '" text-anchor="middle">' + wvEsc(n.req_label) +
      '</text></g>';
  });
  return '<svg viewBox="0 0 ' + layout.width + ' ' + layout.height +
    '" width="100%" role="img" style="display:block;max-width:' +
    Math.min(layout.width, 980) + 'px">' + s + '</svg>';
}
function wvNodeStatus(w, id) {
  /* Mirror of the electrical overlay's node status: 'bad' when a
     recorded feed provably exceeds the node's rated maximum, 'ok'
     when a fixed-voltage feed is recorded and within rating, else
     'unchecked' with the reason. */
  const nodes = wvNodeMap(w), node = nodes[id];
  const bad = wvBad(w), feeds = [];
  let state = 'unchecked', reason = 'no feed is recorded for it';
  (w.connections || []).forEach((c, i) => {
    if (c.to !== id || c.kind !== 'power') return;
    feeds.push(c);
    if (bad.has(i)) state = 'bad';
    else if (c.volts != null && node && node.rated_max_v != null &&
             state === 'unchecked') state = 'ok';
  });
  if (feeds.length && state === 'unchecked') {
    reason = feeds.every(c => c.volts == null)
      ? 'its feed carries no fixed voltage (PWM or an unspecified rail)'
      : 'the part has no recorded rated maximum to check against';
  }
  return { state, feeds, reason };
}
/* == wiring-logic:end == */

/* ---------------- Glossary ----------------
   Terms are wrapped in place and defined from assets/js/
   glossary.json; the reader never leaves the page. */
let wvGlossary = null, wvTermRe = null;
function wvLoadGlossary() {
  if (wvGlossary) return Promise.resolve(wvGlossary);
  return fetch(ROOT + 'assets/js/glossary.json', { cache: 'force-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d && d.terms) {
        wvGlossary = d.terms;
        const terms = Object.keys(wvGlossary)
          .sort((a, b) => b.length - a.length)
          .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        wvTermRe = new RegExp('\\b(' + terms.join('|') + ')\\b', 'gi');
      }
      return wvGlossary;
    })
    .catch(() => null);
}
function wvMark(escapedText) {
  if (!wvGlossary || !wvTermRe) return escapedText;
  return escapedText.replace(wvTermRe, m =>
    '<button type="button" class="wv-term" data-term="' +
    esc(m.toLowerCase()) + '">' + m + '</button>');
}

/* ---------------- The view ---------------- */
function createWiringView(spec, container, opts) {
  opts = opts || {};
  const w = spec.wiring;
  const layout = wvLayout(w);
  const bad = wvBad(w);
  const state = {
    mode: 'simple',            // 'simple' | 'full'
    sel: null,                 // {type:'node', id} | {type:'conn', i}
    trace: null,               // wvTrace result while active
    dead: null,                // node id under the failure finder
    lost: [],                  // nodes losing power if `dead` dies
    power: false, stage: 0, timers: []
  };
  container.innerHTML =
    '<div class="wv">' +
    '<div class="wv-tools">' +
      '<div class="tabs wv-mode" role="tablist" aria-label="Wiring detail level">' +
        '<button class="tab" type="button" data-wvmode="simple" role="tab" aria-selected="true">Simple</button>' +
        '<button class="tab" type="button" data-wvmode="full" role="tab" aria-selected="false">Full</button>' +
      '</div>' +
      (opts.externalPower ? '' :
        '<button class="btn btn-sm wv-power" type="button" aria-pressed="false">Power on</button>') +
      '<button class="btn btn-sm wv-showall" type="button" hidden>Show all</button>' +
      '<button class="btn btn-sm wv-print" type="button">Print harness sheet</button>' +
    '</div>' +
    '<p class="wv-note">' + wvMark(esc(w.note || '')) + '</p>' +
    '<div class="wv-stage">' +
      '<div class="wv-diagram"></div>' +
      '<aside class="card ta-detail wv-detail"></aside>' +
    '</div>' +
    '<div class="wv-pop" hidden></div>' +
    '<h3 class="wv-table-title">Harness \u2014 the cut list</h3>' +
    '<div class="wv-tablewrap"></div>' +
    '</div>';
  const root = container.querySelector('.wv');
  root.dataset.mode = state.mode;
  const diagramEl = root.querySelector('.wv-diagram');
  const detailEl = root.querySelector('.wv-detail');
  const popEl = root.querySelector('.wv-pop');
  const showAllBtn = root.querySelector('.wv-showall');

  function renderDiagram() {
    diagramEl.innerHTML = wvDiagramSVG(w, state.mode) +
      '<p class="cap">Solid line is power, dashed line is data \u2014 ' +
      'colour is the second channel (amber power, blue data) so the ' +
      'diagram still reads in grayscale. Power lights the cables in ' +
      'supply order, battery first. Red is only ever a recorded ' +
      'over-voltage.</p>';
    paint();
  }
  function paint() {
    const traceNodes = state.trace ? new Set(state.trace.nodes) : null;
    const traceConns = state.trace ? new Set(state.trace.conns) : null;
    const lost = new Set(state.lost);
    root.querySelectorAll('.wv-cable').forEach(g => {
      const i = Number(g.dataset.conn);
      const st = g.dataset.stage === 'inf' ? Infinity : Number(g.dataset.stage);
      g.classList.toggle('on', state.power && st <= state.stage);
      g.classList.toggle('sel', !!state.sel && state.sel.type === 'conn' &&
                         state.sel.i === i);
      g.classList.toggle('dim', !!traceConns && !traceConns.has(i));
      g.classList.toggle('dead', state.dead != null &&
                         (w.connections[i].from === state.dead ||
                          w.connections[i].to === state.dead ||
                          lost.has(w.connections[i].to)));
      const line = g.querySelector('.wv-line');
      if (line) line.classList.toggle('on',
        state.power && st <= state.stage);
    });
    root.querySelectorAll('.wv-node').forEach(g => {
      const d = g.dataset.depth === 'inf' ? Infinity : Number(g.dataset.depth);
      g.classList.toggle('on', state.power && d <= state.stage);
      g.classList.toggle('sel', !!state.sel && state.sel.type === 'node' &&
                         state.sel.id === g.dataset.node);
      g.classList.toggle('dim', !!traceNodes && !traceNodes.has(g.dataset.node));
      g.classList.toggle('dead', state.dead === g.dataset.node ||
                         lost.has(g.dataset.node));
    });
    showAllBtn.hidden = !(state.trace || state.dead);
  }
  function statusHTML(st) {
    if (st.state === 'bad') return '<span class="elec-bad">Over-voltage ' +
      '\u2014 a recorded feed exceeds this part\u2019s rated maximum.</span>';
    if (st.state === 'ok') return '<span class="elec-ok">Within rating ' +
      'on the recorded values.</span>';
    return '<span class="elec-unchecked">Not checked \u2014 ' +
      esc(st.reason) + '.</span>';
  }
  function showDefault() {
    state.sel = null;
    detailEl.innerHTML =
      '<h3>Wiring &amp; cabling</h3>' +
      '<p class="muted" style="font-size:var(--fs-sm);margin-top:8px">' +
      'Click a component to trace everything it connects to; click a ' +
      'cable to read it. Fields the documentation does not name read ' +
      '\u201cnot specified\u201d \u2014 nothing here is guessed.</p>' +
      '<dl><dt>Components</dt><dd class="m">' + w.nodes.length + '</dd>' +
      '<dt>Cables</dt><dd class="m">' + w.connections.length + '</dd></dl>' +
      '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">' +
      'Voltages and cable facts are the recorded ones \u2014 the ' +
      'spec\u2019s own fields, its documented harness and the parts ' +
      'catalog\u2019s datasheet specs.</p>';
    paint();
  }
  function showNode(id) {
    const nodes = wvNodeMap(w), node = nodes[id];
    if (!node) return;
    state.sel = { type: 'node', id };
    const st = wvNodeStatus(w, id);
    const feed = st.feeds.map(c =>
      esc(wvShortLabel(nodes[c.from])) + ' \u00b7 ' +
      (c.volts != null ? wvVolts(c.volts)
                       : esc(c.label || 'no fixed voltage'))).join('<br>');
    const conns = w.connections
      .map((c, i) => (c.from === id || c.to === id) ? i : null)
      .filter(x => x != null)
      .map(i => {
        const c = w.connections[i];
        const other = c.from === id ? c.to : c.from;
        return esc((c.from === id ? '\u2192 ' : '\u2190 ') +
          wvShortLabel(nodes[other]) + ' \u00b7 ' + c.kind +
          (c.kind === 'power' ? ' \u00b7 ' + wvVolts(c.volts) : ''));
      }).join('<br>');
    let fail = '';
    if (state.dead === id) {
      fail = '<dt>If this part dies</dt><dd>' +
        (state.lost.length
          ? 'These lose power: <strong>' +
            state.lost.map(x => esc(wvShortLabel(nodes[x]))).join(', ') +
            '</strong>.'
          : 'Nothing else loses power \u2014 no other part is fed ' +
            'only through this one.') +
        '<br><span class="faint">Counted over power cables only; ' +
        'data links do not keep a part alive.</span></dd>';
    }
    detailEl.innerHTML =
      '<span class="qty">Electrical component</span>' +
      '<h3>' + wvMark(esc(node.label)) + '</h3>' +
      '<dl>' +
      '<dt>Electrical requirement</dt><dd class="m">' +
        wvMark(esc(node.req_label)) + '</dd>' +
      '<dt>Supplied by</dt><dd>' + (feed || '\u2014 (it is a source)') + '</dd>' +
      '<dt>Status</dt><dd>' + statusHTML(st) + '</dd>' +
      '<dt>Connections</dt><dd>' + conns + '</dd>' + fail +
      '</dl>' +
      '<p style="margin-top:12px"><button class="btn btn-sm wv-die" ' +
      'type="button">' + (state.dead === id ? 'Clear the failure test'
        : 'If this part dies\u2026') + '</button> ' +
      '<button class="btn btn-sm wv-all2" type="button">Show all</button></p>' +
      '<p class="faint" style="margin-top:10px;font-size:var(--fs-xs)">' +
      'Showing only the paths through this part \u2014 Show all ' +
      'brings the whole harness back.</p>';
    detailEl.querySelector('.wv-die').addEventListener('click', () => {
      if (state.dead === id) { clearFailure(); }
      else {
        state.dead = id;
        state.lost = wvFailure(w, id);
      }
      showNode(id);
    });
    detailEl.querySelector('.wv-all2').addEventListener('click', showAll);
    paint();
  }
  function showConn(i) {
    const c = w.connections[i];
    if (!c) return;
    state.sel = { type: 'conn', i };
    state.trace = null; state.dead = null; state.lost = [];
    const nodes = wvNodeMap(w);
    const row = (k, v) => '<dt>' + k + '</dt><dd class="m">' + v + '</dd>';
    detailEl.innerHTML =
      '<span class="qty">' + (c.kind === 'power' ? 'Power cable' : 'Data cable') + '</span>' +
      '<h3>' + esc(wvShortLabel(nodes[c.from])) + ' \u2192 ' +
        esc(wvShortLabel(nodes[c.to])) + '</h3>' +
      '<p style="font-size:var(--fs-sm);margin:10px 0">' +
        wvMark(esc(wvCallout(w, i))) + '</p>' +
      '<dl>' +
      row('Type', esc(c.kind)) +
      row('Volts', wvVolts(c.volts)) +
      row('Gauge', wvCableField(c.cable, 'gauge_awg')) +
      row('Connector', wvMark(esc(wvCableField(c.cable, 'connector')))) +
      row('Length', wvCableField(c.cable, 'length_mm')) +
      (c.label ? row('Recorded label', wvMark(esc(c.label))) : '') +
      (bad.has(i) ? '<dt>Status</dt><dd><span class="elec-bad">' +
        'Over-voltage \u2014 above the target\u2019s recorded rated ' +
        'maximum.</span></dd>' : '') +
      '</dl>' +
      '<p style="margin-top:12px"><button class="btn btn-sm wv-all2" ' +
      'type="button">Show all</button></p>';
    detailEl.querySelector('.wv-all2').addEventListener('click', showAll);
    paint();
  }
  function clearFailure() { state.dead = null; state.lost = []; }
  function showAll() {
    state.trace = null; clearFailure();
    showDefault();
  }
  function renderTable() {
    const nodes = wvNodeMap(w);
    const cell = v => '<td class="m">' + v + '</td>';
    let rows = '';
    w.connections.forEach((c, i) => {
      rows += '<tr data-conn="' + i + '"' +
        (bad.has(i) ? ' class="wv-badrow"' : '') + '>' +
        '<td>' + wvMark(esc(wvShortLabel(nodes[c.from]))) + '</td>' +
        '<td>' + wvMark(esc(wvShortLabel(nodes[c.to]))) + '</td>' +
        cell(esc(c.kind)) + cell(wvVolts(c.volts)) +
        cell(wvCableField(c.cable, 'gauge_awg')) +
        '<td>' + wvMark(esc(wvCableField(c.cable, 'connector'))) + '</td>' +
        cell(wvCableField(c.cable, 'length_mm')) + '</tr>';
    });
    const known = w.connections.filter(
      c => c.cable && c.cable.length_mm != null);
    let foot = '';
    if (known.length === w.connections.length && known.length) {
      const total = known.reduce((s, c) => s + c.cable.length_mm, 0);
      foot = '<p class="faint" style="font-size:var(--fs-xs);margin-top:8px">' +
        'Total documented cable: ' + total + ' mm across ' + known.length +
        ' connections \u2014 every length here is recorded.</p>';
    } else {
      foot = '<p class="faint" style="font-size:var(--fs-xs);margin-top:8px">' +
        'Lengths are recorded for ' + known.length + ' of ' +
        w.connections.length + ' connections, so no total is shown ' +
        '\u2014 a partial sum would lie.</p>';
    }
    root.querySelector('.wv-tablewrap').innerHTML =
      '<table class="wv-table"><thead><tr><th>From</th><th>To</th>' +
      '<th>Type</th><th>Volts</th><th>Gauge</th><th>Connector</th>' +
      '<th>Length</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      foot;
    root.querySelectorAll('.wv-table tbody tr').forEach(tr => {
      tr.addEventListener('click', () => showConn(Number(tr.dataset.conn)));
    });
  }
  /* power sequencing (standalone views drive their own; the robot
     page's Power button drives through applyPower) */
  function setPower(on) {
    state.timers.forEach(clearTimeout); state.timers = [];
    state.power = on; state.stage = 0; paint();
    const btn = root.querySelector('.wv-power');
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'Power off' : 'Power on';
    }
    if (!on) return;
    const stages = [...new Set(
      w.connections.map((c, i) => wvStage(w, layout.depth, i))
        .filter(Number.isFinite))].sort((a, b) => a - b);
    stages.forEach((s, k) => {
      state.timers.push(setTimeout(() => {
        state.stage = s; paint();
      }, 80 + k * 190));
    });
  }
  /* toolbar + diagram events */
  root.querySelectorAll('[data-wvmode]').forEach(b => {
    b.addEventListener('click', () => {
      state.mode = b.dataset.wvmode;
      root.dataset.mode = state.mode;
      root.querySelectorAll('[data-wvmode]').forEach(x =>
        x.setAttribute('aria-selected', String(x === b)));
      renderDiagram();
      if (state.sel) {
        if (state.sel.type === 'node') showNode(state.sel.id);
        else showConn(state.sel.i);
      }
    });
  });
  const powerBtn = root.querySelector('.wv-power');
  if (powerBtn) powerBtn.addEventListener('click', () => setPower(!state.power));
  showAllBtn.addEventListener('click', showAll);
  root.querySelector('.wv-print').addEventListener('click', () => {
    root.classList.add('wv-printing');
    const clear = () => root.classList.remove('wv-printing');
    window.addEventListener('afterprint', clear, { once: true });
    setTimeout(clear, 1500);
    window.print();
  });
  diagramEl.addEventListener('click', ev => {
    const cg = ev.target.closest('.wv-cable');
    const ng = ev.target.closest('.wv-node');
    if (cg) showConn(Number(cg.dataset.conn));
    else if (ng) {
      state.trace = wvTrace(w, ng.dataset.node);
      clearFailure();
      showNode(ng.dataset.node);
    }
  });
  root.addEventListener('click', ev => {
    const t = ev.target.closest('.wv-term');
    if (t) {
      const def = wvGlossary && wvGlossary[t.dataset.term];
      if (!def) return;
      popEl.innerHTML = '<strong>' + esc(t.dataset.term) + '</strong> ' +
        esc(def);
      const r = t.getBoundingClientRect(), rr = root.getBoundingClientRect();
      popEl.style.left = Math.max(0, r.left - rr.left - 10) + 'px';
      popEl.style.top = (r.bottom - rr.top + 6) + 'px';
      popEl.hidden = false;
      ev.stopPropagation();
      return;
    }
    if (!ev.target.closest('.wv-pop')) popEl.hidden = true;
  });
  wvLoadGlossary().then(() => {
    const note = root.querySelector('.wv-note');
    if (note) note.innerHTML = wvMark(esc(w.note || ''));
    renderTable();
    if (state.sel && state.sel.type === 'node') showNode(state.sel.id);
    else if (state.sel) showConn(state.sel.i);
  });
  renderDiagram();
  renderTable();
  showDefault();
  return {
    el: root,
    applyPower(on, stage) {
      state.power = on; state.stage = stage; paint();
    },
    setPower
  };
}

/* ---------------- Page glue ---------------- */
let wvPageView = null;
window.RFWiring = {
  /* robot.js calls this once the page's spec has loaded */
  onSpecReady(spec) {
    const host = document.querySelector('#ta-wiring');
    if (!host || !spec || !spec.wiring || wvPageView) return;
    wvPageView = createWiringView(spec, host, { externalPower: true });
  },
  /* robot.js's Power sequencing drives the page view */
  applyPower(on, stage) {
    if (wvPageView) wvPageView.applyPower(on, stage);
  },
  /* the Forge thread mounts a standalone view per spec card */
  mountInto(container, spec) {
    if (!spec || !spec.wiring) return null;
    return createWiringView(spec, container, {});
  }
};
