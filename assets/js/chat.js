'use strict';
/* Forge Guide widget — the chat UI. All answering is done by
 * chat-engine.js from the site's recorded data (catalog/*.json).
 *
 * Live-model hook: ForgeGuide.CONFIG.endpoint is empty in v1. If a
 * deployment ever sets it, questions are POSTed there first and the
 * local engine is only the fallback — the UI does not change. No API
 * keys ever live in this file or any page: a static site cannot keep
 * one secret.
 */
(function () {
  var FG = window.ForgeGuide;
  var box = document.getElementById('forge-chat');
  if (!FG || !box) return;

  var launcher = document.getElementById('fc-launcher');
  var panel = document.getElementById('fc-panel');
  var closeBtn = document.getElementById('fc-close');
  var msgs = document.getElementById('fc-msgs');
  var chipsRow = document.getElementById('fc-chips');
  var form = document.getElementById('fc-form');
  var input = document.getElementById('fc-input');

  /* Fetch base: this script's own URL, so data loads at any depth.
   * Link root: the app shell stamps data-root on <html>; the landing
   * page is at the root, where '' is correct. */
  var script = document.currentScript;
  var BASE = script && script.src
    ? script.src.replace(/assets\/js\/chat\.js(\?.*)?$/, '') : '';
  var ROOT = document.documentElement.dataset.root || '';

  var DEFAULT_CHIPS = ['Which robots passed the gate?',
    'What are the gate thresholds?', 'Tell me about Andino',
    'How does RobotForge work?'];

  var engine = null;
  var loading = null;
  var greeted = false;

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetchJSON(BASE + 'catalog/robots.json').catch(function () { return null; }),
      fetchJSON(BASE + 'catalog/parts.json').catch(function () { return null; }),
      fetchJSON(BASE + 'catalog/gate-reports.json').catch(function () { return null; }),
      fetchJSON(BASE + 'assets/js/chat-intents.json').catch(function () { return null; })
    ]).then(function (got) {
      var robots = got[0], parts = got[1], reports = got[2], intents = got[3];
      engine = FG.createEngine({
        robots: robots && robots.robots ? robots.robots : [],
        parts: parts && parts.parts ? parts.parts : [],
        templates: parts && parts.templates ? parts.templates.length : 0,
        reports: reports,
        intents: intents,
        root: ROOT
      });
      return engine;
    });
    return loading;
  }

  function bubble(who, html) {
    var d = document.createElement('div');
    d.className = 'fc-msg ' + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function userBubble(text) {
    var d = document.createElement('div');
    d.className = 'fc-msg user';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setChips(list) {
    chipsRow.innerHTML = '';
    (list && list.length ? list : DEFAULT_CHIPS).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = q;
      b.addEventListener('click', function () { ask(q); });
      chipsRow.appendChild(b);
    });
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    bubble('bot', '<p>Hello — I&rsquo;m the <strong>Forge Guide</strong>. I answer ' +
      'from RobotForge&rsquo;s recorded data (the Robodex, the parts catalogue ' +
      'and the recorded gate reports), not from a live AI.</p>' +
      '<p>Ask about a robot by name or number, a catalogue part, or how the ' +
      'gate works — or tap a suggestion.</p>');
    setChips(engine ? engine.suggestions : null);
  }

  /* A real in-page action, not just an answer: on the Robots page,
   * "find lidar" / "show servos" drives the catalogue's own search
   * box, so the page itself responds to the conversation. */
  function filterPartsHere(q) {
    var ps = document.getElementById('part-search');
    if (!ps) return;
    var m = q.match(/^(?:find|search|show(?: me)?|filter)\s+(.+)$/i);
    if (!m) return;
    ps.value = m[1].trim();
    ps.dispatchEvent(new Event('input', { bubbles: true }));
    var note = document.createElement('div');
    note.className = 'fc-msg bot';
    var p = document.createElement('p');
    p.textContent = 'I filtered the parts catalogue on this page for \u201c' +
      m[1].trim() + '\u201d — it is just below.';
    note.appendChild(p);
    msgs.appendChild(note);
    msgs.scrollTop = msgs.scrollHeight;
    var sec = document.getElementById('parts');
    if (sec) sec.scrollIntoView({ behavior: 'smooth' });
  }

  function localAnswer(question) {
    return engine.answer(question);
  }

  function ask(question) {
    var q = String(question || '').trim();
    if (!q) return;
    userBubble(q);
    input.value = '';
    var wait = bubble('bot', '<p class="fc-dim">Checking the recorded data&hellip;</p>');
    var done = function (ans) {
      wait.innerHTML = ans.html;
      msgs.scrollTop = msgs.scrollHeight;
      setChips(ans.chips || (engine ? engine.suggestions : null));
      filterPartsHere(q);
    };
    load().then(function () {
      if (FG.CONFIG.endpoint) {
        fetch(FG.CONFIG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        }).then(function (r) {
          if (!r.ok) throw new Error('endpoint -> ' + r.status);
          return r.json();
        }).then(function (body) {
          done({ html: body.html || ('<p>' + body.answer + '</p>'), chips: body.chips });
        }).catch(function () { done(localAnswer(q)); });
      } else {
        done(localAnswer(q));
      }
    });
  }

  /* Docked mode (app pages, wide screens): the panel is a fixed
   * left rail and is simply open — there is nothing to toggle. The
   * media query mirrors the one in chat.css / app.css. */
  var dockMQ = window.matchMedia('(min-width: 1280px)');
  function isDocked() {
    return box.classList.contains('docked') && dockMQ.matches;
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      load().then(function () {
        greet();
        if (!isDocked()) input.focus();
      });
    }
  }

  function applyMode() {
    if (box.classList.contains('docked')) setOpen(isDocked());
  }
  if (dockMQ.addEventListener) dockMQ.addEventListener('change', applyMode);
  applyMode();

  launcher.addEventListener('click', function () {
    if (!isDocked()) setOpen(panel.hidden);
  });
  closeBtn.addEventListener('click', function () {
    if (!isDocked()) setOpen(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !panel.hidden && !isDocked()) setOpen(false);
  });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ask(input.value);
  });
})();
