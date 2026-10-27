'use strict';
/* Robots page: verdict filter chips and parts search. The cards and
   parts are server-rendered by `robotforge site`; this only hides. */

$$('[data-filter]').forEach(chip => chip.addEventListener('click', () => {
  const f = chip.dataset.filter;
  $$('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
  $$('#robot-grid .robot-card').forEach(card => {
    card.hidden = f !== 'all' && card.dataset.status !== f;
  });
}));

const search = $('#part-search');
if (search) search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  $$('#parts-list .parts-group').forEach(g => {
    let any = false;
    $$('.part', g).forEach(p => {
      const hit = !q || p.dataset.q.includes(q) || p.textContent.toLowerCase().includes(q);
      p.hidden = !hit; if (hit) { any = true; shown++; }
    });
    g.hidden = !any;
  });
  $('#parts-empty').hidden = shown > 0;
});
