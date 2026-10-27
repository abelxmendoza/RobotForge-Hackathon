'use strict';
/* Shared helpers for the app pages. Every number shown comes from a
   file in this repository (catalog/, examples/); where data is missing
   the page says so instead of inventing it. */

const ROOT = document.documentElement.dataset.root || '';
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const mm = m => Math.round(m * 1000);

async function fetchJSON(path) {
  const r = await fetch(ROOT + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}
async function fetchText(path) {
  const r = await fetch(ROOT + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.text();
}

/* ---------- verdicts + meters (locked thresholds: pass <= 5, fail > 10) ---------- */
const VCLS = { PASS: 'pass', MARGINAL: 'marginal', FAIL: 'fail', NOT_GATED: 'norun' };
const VLABEL = { PASS: 'Pass', MARGINAL: 'Marginal', FAIL: 'Fail', NOT_GATED: 'Not gated' };
function verdict(status, extra) {
  return '<span class="verdict ' + VCLS[status] + (extra ? ' ' + extra : '') + '">' + VLABEL[status] + '</span>';
}
const CHECK_LABEL = {
  drive_distance: 'Drive vs ground truth',
  turn_heading: 'Turn vs ground truth',
  odometry_distance: 'Odometry distance vs truth',
  odometry_heading: 'Odometry heading vs truth'
};
function meter(check) {
  const max = 15, pct = v => Math.min(100, Math.abs(v) / max * 100);
  const unit = check.unit === 'deg' ? '°' : check.unit;
  return '<div class="metric">' +
    '<div class="metric-top"><span class="metric-label">' + esc(CHECK_LABEL[check.name] || check.name) + '</span>' +
    verdict(check.verdict) + '</div>' +
    '<div class="metric-value">' + Number(check.error).toFixed(3) + '<small>' + esc(unit) + '</small></div>' +
    '<div class="meter" role="img" aria-label="' + Number(check.error).toFixed(2) + unit + ' against pass 5' + unit + ' and fail 10' + unit + '">' +
      '<span class="z-pass" style="width:' + pct(5) + '%"></span>' +
      '<span class="z-marg" style="left:' + pct(5) + '%;width:' + (pct(10) - pct(5)) + '%"></span>' +
      '<span class="fill ' + VCLS[check.verdict] + '" style="width:' + pct(check.error).toFixed(1) + '%"></span></div>' +
    '<div class="meter-scale"><span>0</span><span>pass ≤5' + esc(unit) + '</span><span>fail &gt;10' + esc(unit) + '</span><span>15</span></div>' +
    '</div>';
}

/* ---------- spec as a plain-words table ---------- */
function specTable(spec) {
  const rows = [
    ['Drivetrain', spec.drivetrain],
    ['Size (L × W × H)', mm(spec.length_m) + ' × ' + mm(spec.width_m) + ' × ' + mm(spec.height_m) + ' mm'],
    ['Mass', spec.mass_kg + ' kg'],
    ['Ground clearance', mm(spec.ground_clearance_m) + ' mm'],
    ['Wheels', spec.wheel.count + ' × ' + mm(spec.wheel.diameter_m) + ' mm, ' + mm(spec.wheel.width_m) + ' mm wide' + (spec.wheel.driven ? ', driven' : '')],
    ['Motors', spec.motor.count + ' × ' + (spec.motor.kind || '').replace(/_/g, ' ') + ', ' + spec.motor.voltage_v + ' V' + (spec.motor.stall_torque_nm != null ? ', stall ' + spec.motor.stall_torque_nm + ' N·m' : '')],
    ['Battery', (spec.battery.chemistry || '') + ' ' + spec.battery.voltage_v + ' V, ' + spec.battery.capacity_mah + ' mAh'],
    ['Sensors', (spec.sensors || []).map(s => s.kind.replace(/_/g, ' ') + ' (' + s.position + ')').join(', ') || 'none']
  ];
  return '<table class="kv">' + rows.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('') + '</table>';
}
function rawJSON(obj, label) {
  return '<details class="raw"><summary>' + esc(label || 'Raw JSON') + '</summary><pre>' + esc(JSON.stringify(obj, null, 2)) + '</pre></details>';
}

/* ---------- validator findings ([SEVERITY] check: message) ---------- */
function findings(lines) {
  return '<ul class="findings">' + lines.map(l => {
    const m = /^\[(\w+)\]\s+([^:]+):\s*(.*)$/.exec(l);
    if (!m) return '<li class="finding"><span></span><span class="msg">' + esc(l) + '</span></li>';
    return '<li class="finding"><span class="sev ' + m[1].toLowerCase() + '">' + esc(m[1]) + '</span>' +
      '<span class="check">' + esc(m[2]) + '</span><span class="msg">' + esc(m[3]) + '</span></li>';
  }).join('') + '</ul>';
}

/* ---------- ground-truth trajectory ---------- */
function drawTraj(cv, pts) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 480, H = 240;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.font = '12px ui-monospace, Menlo, monospace';
  if (!pts || !pts.length) { ctx.fillStyle = '#9aa3ae'; ctx.fillText('no trajectory recorded', 12, 20); return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 0.2);
  const miny = Math.min(...ys, -0.2), maxy = Math.max(...ys, 0.2);
  const pad = 22, sc = Math.min((W - 2 * pad) / (maxx - minx || 1), (H - 2 * pad) / (maxy - miny || 1));
  const X = x => pad + (x - minx) * sc, Y = y => H - pad - (y - miny) * sc;
  ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(X(minx), Y(0)); ctx.lineTo(X(maxx), Y(0)); ctx.stroke();
  ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
  ctx.stroke();
  ctx.fillStyle = '#eceef2'; ctx.beginPath(); ctx.arc(X(pts[0][0]), Y(pts[0][1]), 4, 0, 7); ctx.fill();
  const last = pts[pts.length - 1];
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(X(last[0]), Y(last[1]), 5, 0, 7); ctx.fill();
  ctx.fillStyle = '#6f7884'; ctx.fillText('ground-truth path, metres', 10, 16);
}

/* ---------- copy buttons ---------- */
function wireCopy(scope) {
  $$('[data-copy]', scope).forEach(b => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => {
      const t = b.parentNode.querySelector('code').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
        () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); },
        () => { b.textContent = 'Select & copy'; });
    });
  });
}
function codeBlock(text) {
  return '<div class="codeblock"><pre><code>' + esc(text) + '</code></pre>' +
    '<button class="btn btn-sm copy" type="button" data-copy>Copy</button></div>';
}
document.addEventListener('DOMContentLoaded', () => wireCopy(document));
