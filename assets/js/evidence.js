'use strict';
/* Evidence: the gate's own recorded reports (catalog/gate-reports.json):
   every check with its meter, raw measurements, the ground-truth path,
   and the suspects the gate named. */

const f3 = (n, d) => Number(n).toFixed(d == null ? 3 : d);

function reportHTML(r, i) {
  const d = r.doc, m = d.measurements;
  const [title, sub] = r.title.split(' — ');
  const head = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : title;
  const injected = m.injected_wheel_radius_scale && m.injected_wheel_radius_scale !== 1
    ? '<tr><th>Injected fault</th><td>physical wheels × ' + m.injected_wheel_radius_scale + ' (odometry keeps the spec size)</td></tr>' : '';
  const suspects = (d.suspects || []).length
    ? '<div class="suspects">' + d.suspects.map(s =>
        '<div class="callout bad"><span><strong>Suspect: <code>' + esc(s.field) + '</code></strong><br>' + esc(s.reason) + '</span></div>').join('') + '</div>'
    : '<div class="callout good" style="margin-top:12px"><span>No suspects. Odometry and ground truth agree inside tolerance on every check.</span></div>';
  return '<article class="card report" id="run-' + esc(r.id) + '">' +
    '<div class="card-head"><div><div class="eyebrow">' + esc(title) + '</div>' +
    '<h3 style="margin-top:6px">' + esc(head) + '</h3></div>' + verdict(d.verdict, 'lg') + '</div>' +
    '<p class="story">' + esc(r.story) + '</p>' +
    '<div class="report-grid"><div><div class="checks">' + d.checks.map(meter).join('') + '</div>' +
    '<table class="kv" style="margin-top:12px">' +
    '<tr><th>Drive: truth / odometry</th><td>' + f3(m.drive.truth_m) + ' m / ' + f3(m.drive.measured_m) + ' m</td></tr>' +
    '<tr><th>Turn: truth / odometry</th><td>' + f3(m.turn.truth_deg, 1) + '° / ' + f3(Math.abs(m.turn.measured_deg), 1) + '°</td></tr>' +
    injected + '</table></div>' +
    '<div><canvas class="traj" id="traj-' + i + '"></canvas>' +
    '<p class="legend">White dot: start. Amber dot: where the robot actually ended up (ground truth).</p>' + suspects + '</div></div>' +
    '</article>';
}

(async function boot() {
  let data;
  try { data = await fetchJSON('catalog/gate-reports.json'); }
  catch (err) {
    $('#report-list').innerHTML = '<div class="state-box">The recorded reports could not be loaded from this site. Nothing is shown in their place.</div>';
    return;
  }
  const runs = data.runs;
  $('#report-strip').innerHTML = runs.map(r => {
    const [title, sub] = r.title.split(' — ');
    return '<a class="report-chip" href="#run-' + esc(r.id) + '">' + verdict(r.doc.verdict) +
      '<b>' + esc(title) + '</b><span>' + esc(sub || '') + '</span></a>';
  }).join('');
  $('#report-list').innerHTML = runs.map(reportHTML).join('');
  const draw = () => runs.forEach((r, i) => drawTraj($('#traj-' + i), r.traj));
  draw();
  let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  if (location.hash) { const el = $(location.hash); if (el) el.scrollIntoView(); }
})();
