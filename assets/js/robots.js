'use strict';
/* Robots page: source tabs, verdict + class filter chips, and parts search. The
   cards and parts are server-rendered by `robotforge site`; this only
   hides. The two chip rows are independent filters — a card shows
   only when it matches all three. Class chips come from the Robodex
   taxonomy (catalog.MOBILITY_TAXONOMY); classes with no robots are
   rendered disabled server-side and never reach this handler. */

const rfFilters = { source: 'researched', status: 'all', mobility: 'all' };
function rfApplyFilters() {
  let shown = 0;
  $$('#robot-grid .robot-card').forEach(card => {
    card.hidden =
      card.dataset.source !== rfFilters.source ||
      (rfFilters.status !== 'all' && card.dataset.status !== rfFilters.status) ||
      (rfFilters.mobility !== 'all' && card.dataset.mobility !== rfFilters.mobility);
    if (!card.hidden) shown++;
  });
  const empty = $('#robots-empty');
  if (empty) empty.hidden = shown > 0;
}

$$('[data-sfilter]').forEach(tab => tab.addEventListener('click', () => {
  rfFilters.source = tab.dataset.sfilter;
  $$('[data-sfilter]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
  const summary = $('#source-summary');
  if (summary) summary.textContent = tab.dataset.description;
  rfApplyFilters();
}));

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

/* Query Cards: the Forge Guide's part buttons land here. Focus one
 * catalogue part by id — set the search to its name (which unhides
 * its group), highlight the card, and scroll it into view. Also
 * honours ?part=<id> so a chat on any other page can deep-link
 * straight to a part. */
function rfFocusPart(id) {
  const card = document.querySelector('.part[data-part-id="' + id + '"]');
  if (!card) return false;
  if (search) {
    const name = card.querySelector('h4');
    search.value = name ? name.textContent : id;
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  $$('#parts-list .part.fc-highlight').forEach(p2 =>
    p2.classList.remove('fc-highlight'));
  card.classList.add('fc-highlight');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}
window.rfFocusPart = rfFocusPart;
const rfWant = new URLSearchParams(window.location.search).get('part');
if (rfWant) rfFocusPart(rfWant);
