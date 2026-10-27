// RobotForge motion pack: scroll-reveal for cards, heads and sections.
// Auto-tags existing components so generated pages need no markup hooks.
(function () {
  var targets = document.querySelectorAll(
    '.robot-card, .step-card, .page-head, .dex-strip figure, main article, .report-card, .forge-top');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  targets.forEach(function (el, i) {
    el.classList.add('rv');
    if (i % 4 === 1) el.classList.add('rv-d1');
    if (i % 4 === 2) el.classList.add('rv-d2');
    if (i % 4 === 3) el.classList.add('rv-d3');
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  targets.forEach(function (el) { io.observe(el); });
})();
