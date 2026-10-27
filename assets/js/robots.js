'use strict';
/* Robots page: verdict + class filter chips and parts search. The
   cards and parts are server-rendered by `robotforge site`; this only
   hides. The two chip rows are independent filters — a card shows
   only when it matches both. Class chips come from the Robodex
   taxonomy (catalog.MOBILITY_TAXONOMY); classes with no robots are
   rendered disabled server-side and never reach this handler. */

const rfFilters = { status: 'all', mobility: 'all' };
function rfApplyFilters() {
  $$('#robot-grid .robot-card').forEach(card => {
    card.hidden =
      (rfFilters.status !== 'all' && card.dataset.status !== rfFilters.status) ||
      (rfFilters.mobility !== 'all' && card.dataset.mobility !== rfFilters.mobility);
  });
}

$$('[data-filter]').forEach(chip => chip.addEventListener('click', () => {
  rfFilters.status = chip.dataset.filter;
  $$('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
  rfApplyFilters();
}));

$$('[data-cfilter]').forEach(chip => chip.addEventListener('click', () => {
  rfFilters.mobility = chip.dataset.cfilter;
  $$('[data-cfilter]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
  rfApplyFilters();
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
